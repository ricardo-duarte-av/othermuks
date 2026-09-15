import { create } from 'zustand'
import {
  clearStoredBackend,
  consumeBackendPickerRequest,
  forgetPassword,
  loadStoredBackend,
  probeSameOrigin,
  requestBackendPicker,
  saveRemoteBackend,
  type ProbeSuccess,
} from '@/api/backend'
import { client, type ReceivedEvent } from '@/api/client'
import { formatMs, formatSize, log } from '@/lib/log'
import { markOnce } from '@/lib/perf'
import { handleRPCEvent, useChat } from './chat'
import { getPreference, useLocalPrefs } from './preferences'
import { applyTheme, codeblockStyleFor, setCodeblockCSS, useUI } from './ui'

type Phase = 'checking' | 'backend' | 'login' | 'ready' | 'error'

interface SessionState {
  phase: Phase
  error: string | null
  /** The remote backend being used or signed in to; null means this site's own gomuks. */
  backendURL: string | null
  /** Whether this page's own origin has a gomuks behind /_gomuks/. */
  sameOriginAvailable: boolean
  rememberedUsername: string
}

/** Applying a single event for longer than this gets a warning, since it blocks rendering. */
const SLOW_APPLY_MS = 50

export const useSession = create<SessionState>()(() => ({
  phase: 'checking',
  error: null,
  backendURL: null,
  sameOriginAvailable: false,
  rememberedUsername: '',
}))

let syncCount = 0

function logEvent({ evt, bytes, parseMs }: ReceivedEvent, applyMs: number) {
  const cost = `${formatSize(bytes)}, parse ${formatMs(parseMs)}, apply ${formatMs(applyMs)}`
  if (applyMs > SLOW_APPLY_MS) log.warn(`slow ${evt.command}: ${cost}`)

  switch (evt.command) {
    case 'sync_complete': {
      const rooms = Object.values(evt.data.rooms ?? {})
      const events = rooms.reduce((count, room) => count + (room.events?.length ?? 0), 0)
      const flags = [evt.data.clear_state && 'clear_state', evt.data.catchup && 'catchup'].filter(Boolean)
      const extras = [
        evt.data.invited_rooms?.length && `${evt.data.invited_rooms.length} invites`,
        evt.data.left_rooms?.length && `${evt.data.left_rooms.length} left`,
        evt.data.space_edges && Object.keys(evt.data.space_edges).length && `${Object.keys(evt.data.space_edges).length} space edge lists`,
      ].filter(Boolean)
      log.info(
        `sync #${++syncCount}: ${rooms.length} rooms, ${events} events${extras.length ? `, ${extras.join(', ')}` : ''} (${cost})${flags.length ? ` [${flags.join(', ')}]` : ''}`,
      )
      log.debug(`sync #${syncCount} payload`, evt.data)
      break
    }
    case 'init_complete': {
      const s = useChat.getState()
      markOnce(
        'initial sync complete',
        `${Object.keys(s.rooms).length} rooms (${s.spaces.length} spaces), ${Object.keys(s.events).length} events in store`,
      )
      break
    }
    case 'run_id':
      log.info(`backend run ${evt.data.run_id}, listener ${evt.data.listener_id}`)
      break
    case 'client_state':
      if (evt.data.is_logged_in) {
        log.info(`client state: ${evt.data.user_id} on ${evt.data.device_id}, verified: ${evt.data.is_verified}`)
      } else {
        log.warn('client state: gomuks is not logged in to a Matrix account', evt.data)
      }
      break
    case 'sync_status':
      if (evt.data.type === 'ok' || evt.data.type === 'waiting') log.debug(`homeserver sync ${evt.data.type}`)
      else log.warn(`homeserver sync ${evt.data.type} (${evt.data.error_count} errors): ${evt.data.error ?? ''}`)
      break
    case 'send_complete':
      if (evt.data.error) log.warn(`send failed: ${evt.data.error}`, evt.data.event)
      else log.debug(`sent ${evt.data.event.event_id} in ${evt.data.event.room_id}`)
      break
    case 'events_decrypted':
      log.debug(`${evt.data.events.length} events decrypted in ${evt.data.room_id} (${cost})`)
      break
    default:
      log.debug(`← ${evt.command} (${cost})`, evt.data)
  }
}

let codeblockStyle = ''

/** Loads the code highlighting CSS for the code_block_theme preference ("auto" follows the app theme). */
function refreshCodeblockStyle() {
  if (useSession.getState().phase !== 'ready') return
  const pref = getPreference('code_block_theme')
  const style = pref === 'auto' ? codeblockStyleFor(useUI.getState().theme) : pref
  if (style === codeblockStyle) return
  codeblockStyle = style
  client.fetchText(`codeblock/${style}.css`).then(
    css => {
      if (codeblockStyle === style) setCodeblockCSS(css)
    },
    err => {
      if (codeblockStyle === style) codeblockStyle = ''
      log.debug(`couldn't load code highlighting style ${style}`, err)
    },
  )
}

useChat.subscribe((state, prev) => {
  if (state.accountData !== prev.accountData) refreshCodeblockStyle()
})
useLocalPrefs.subscribe(refreshCodeblockStyle)

let wired = false

function wireClient() {
  if (wired) return
  wired = true
  client.events.on(received => {
    const started = performance.now()
    handleRPCEvent(received.evt)
    logEvent(received, performance.now() - started)
  })
  client.connection.on(connection => useChat.setState({ connection }))
  client.unauthorized.on(() => {
    client.stop()
    if (client.backend.mode === 'remote') forgetPassword()
    useSession.setState({ phase: 'login', error: 'Your session expired. Sign in again.' })
  })
}

function startSession() {
  wireClient()
  useSession.setState({ phase: 'ready', error: null })
  client.start()
  codeblockStyle = ''
  refreshCodeblockStyle()
}

export async function bootstrap() {
  markOnce('app started')
  applyTheme(useUI.getState().theme)
  useUI.subscribe((state, prev) => {
    if (state.theme === prev.theme) return
    applyTheme(state.theme)
    refreshCodeblockStyle()
  })

  try {
    const pickerRequested = consumeBackendPickerRequest()
    const stored = loadStoredBackend()
    const sameOrigin = await probeSameOrigin()
    log.info(`this site's own gomuks: ${sameOrigin === 'none' ? 'not available' : sameOrigin}`)
    useSession.setState({
      sameOriginAvailable: sameOrigin !== 'none',
      backendURL: stored?.baseURL ?? null,
      rememberedUsername: stored?.username ?? '',
    })

    if (pickerRequested) {
      useSession.setState({ phase: 'backend' })
      return
    }

    if (stored) {
      if (stored.authDisabled || stored.password !== undefined) {
        client.configure({
          mode: 'remote',
          baseURL: stored.baseURL,
          username: stored.username ?? '',
          password: stored.authDisabled ? undefined : stored.password,
        })
        const auth = await client.checkAuth()
        markOnce('auth checked', auth)
        if (auth !== 'unauthorized') {
          startSession()
          return
        }
        forgetPassword()
        useSession.setState({ error: 'The saved password was rejected. Sign in again.' })
      }
      useSession.setState({ phase: 'login' })
      return
    }

    if (sameOrigin !== 'none') {
      client.configure({ mode: 'same-origin' })
      markOnce('auth checked', sameOrigin)
      if (sameOrigin === 'login') useSession.setState({ phase: 'login' })
      else startSession()
      return
    }

    useSession.setState({ phase: 'backend' })
  } catch (err) {
    log.error('startup failed', err)
    useSession.setState({ phase: 'error', error: err instanceof Error ? err.message : String(err) })
  }
}

/** Continues with a backend that passed probeBackend(). */
export function chooseBackend(result: ProbeSuccess) {
  useSession.setState({ backendURL: result.baseURL, error: null })
  if (result.authDisabled) {
    saveRemoteBackend({ baseURL: result.baseURL, authDisabled: true })
    client.configure({ mode: 'remote', baseURL: result.baseURL, username: '' })
    startSession()
  } else {
    useSession.setState({ phase: 'login' })
  }
}

/** Switches to the gomuks behind this site's own /_gomuks/. */
export async function useThisSiteBackend() {
  clearStoredBackend()
  client.configure({ mode: 'same-origin' })
  useSession.setState({ backendURL: null, error: null, phase: 'checking' })
  const status = await probeSameOrigin()
  if (status === 'none') useSession.setState({ phase: 'backend', error: "This site's gomuks isn't reachable anymore." })
  else if (status === 'login') useSession.setState({ phase: 'login' })
  else startSession()
}

export function showBackendPicker() {
  if (useSession.getState().phase === 'ready') {
    // Start from a clean slate rather than mixing another account's rooms into the store.
    requestBackendPicker()
    location.reload()
  } else {
    useSession.setState({ phase: 'backend', error: null })
  }
}

export async function signIn(username: string, password: string, remember: boolean) {
  const { backendURL } = useSession.getState()
  client.configure(backendURL ? { mode: 'remote', baseURL: backendURL, username } : { mode: 'same-origin' })
  await client.login(username, password)
  if (backendURL) saveRemoteBackend({ baseURL: backendURL, username, password, remember })
  startSession()
}

/** Remote mode: forgets the stored password and returns to the sign-in screen. */
export function signOut() {
  forgetPassword()
  location.reload()
}
