// Transport for the gomuks backend: SSE for events, POST /_gomuks/exec for commands.
// HTTP spec: https://spec.mau.fi/gomuks/http.html  RPC spec: https://spec.mau.fi/gomuks/rpc.html
import { formatMs, formatSize, log } from '@/lib/log'
import { markOnce } from '@/lib/perf'
import { basicAuthHeader, type BackendConfig } from './backend'
import { setImageAuthToken, setMediaBackend } from './media'
import { createSSEParser } from './sse'
import type {
  EventContextResponse,
  EventID,
  MessageEventContent,
  PaginationResponse,
  RawDBEvent,
  RoomID,
  RPCEvent,
  SendMessageParams,
} from './types'

const PING_INTERVAL = 15_000

type Listener<T> = (value: T) => void

class Emitter<T> {
  #listeners = new Set<Listener<T>>()

  on(fn: Listener<T>): () => void {
    this.#listeners.add(fn)
    return () => {
      this.#listeners.delete(fn)
    }
  }

  emit(value: T) {
    for (const fn of this.#listeners) fn(value)
  }
}

export interface ConnectionState {
  connected: boolean
  reconnecting: boolean
  error: string | null
  nextAttempt?: number
}

/** An RPC event plus the cost of receiving it, for logging. */
export interface ReceivedEvent {
  evt: RPCEvent
  bytes: number
  parseMs: number
}

export type AuthResult = 'ok' | 'disabled' | 'unauthorized'

export class ExecError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function responseError(res: Response): Promise<string> {
  const body = (await res.text().catch(() => '')).trim()
  return `${res.status} ${res.statusText}${body ? ` - ${body}` : ''}`
}

function parseJSON(text: string, status: number, what: string): unknown {
  try {
    return text ? JSON.parse(text) : null
  } catch {
    throw new ExecError(`${what}: non-JSON response (${status})`, status)
  }
}

function errorMessage(payload: unknown, fallback: string) {
  const err = (payload as { error?: unknown } | null)?.error
  return typeof err === 'string' ? err : fallback
}

interface EventStream {
  close(): void
}

export class GomuksClient {
  readonly events = new Emitter<ReceivedEvent>()
  readonly connection = new Emitter<ConnectionState>()
  readonly unauthorized = new Emitter<void>()
  vapidKey?: string

  #backend: BackendConfig = { mode: 'same-origin' }
  #stream: EventStream | null = null
  #pingTimer: ReturnType<typeof setInterval> | null = null
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null
  #stopped = true
  #failures = 0
  #everConnected = false
  #connectStarted = 0

  // Resume state: see "Session resumption" in the RPC spec.
  #runID?: string
  #listenerID?: number
  #lastReceived?: number
  #lastAcked?: number
  #serverTS?: number

  get backend(): BackendConfig {
    return this.#backend
  }

  configure(backend: BackendConfig) {
    if (!this.#stopped) this.stop()
    this.#backend = backend
    this.#runID = undefined
    this.#listenerID = undefined
    this.#lastReceived = undefined
    this.#lastAcked = undefined
    this.#serverTS = undefined
    setMediaBackend(backend.mode === 'remote' ? backend.baseURL : null)
    log.info(backend.mode === 'remote' ? `backend: ${backend.baseURL} (remote, basic auth)` : 'backend: this site (same origin, cookie auth)')
  }

  url(path: string): string {
    return this.#backend.mode === 'remote' ? `${this.#backend.baseURL}/_gomuks/${path}` : `/_gomuks/${path}`
  }

  /** Request options for the current backend: cookies on the same origin, Basic auth when remote. */
  #request(init: RequestInit = {}, headers: Record<string, string> = {}): RequestInit {
    const backend = this.#backend
    if (backend.mode === 'same-origin') return { ...init, headers }
    const auth: Record<string, string> =
      backend.password !== undefined ? { Authorization: basicAuthHeader(backend.username, backend.password) } : {}
    return { ...init, credentials: 'omit', headers: { ...headers, ...auth } }
  }

  #authQuery() {
    // Remote backends get the token as JSON so gomuks doesn't try to set a (third-party) cookie.
    return this.#backend.mode === 'remote' ? 'no_prompt=true&output=json' : `no_prompt=true&secure=${window.isSecureContext}`
  }

  /** Re-validates the session: refreshes the cookie on the same origin, checks the password when remote. */
  async checkAuth(): Promise<AuthResult> {
    const started = performance.now()
    const res = await fetch(this.url(`auth?${this.#authQuery()}`), this.#request({ method: 'POST', cache: 'no-store' }))
    const result: AuthResult | null = res.status === 204 ? 'disabled' : res.ok ? 'ok' : res.status === 401 ? 'unauthorized' : null
    if (!result) throw new Error(`Auth check failed: ${await responseError(res)}`)
    log.info(`auth check: ${result} (${res.status}) in ${formatMs(performance.now() - started)}`)
    return result
  }

  /** Verifies gomuks credentials. Same origin: exchanges them for the HttpOnly cookie. Remote: keeps them for Basic auth. */
  async login(username: string, password: string): Promise<void> {
    const backend = this.#backend
    const res = await fetch(this.url(`auth?${this.#authQuery()}`), {
      method: 'POST',
      cache: 'no-store',
      credentials: backend.mode === 'remote' ? 'omit' : 'same-origin',
      headers: { Authorization: basicAuthHeader(username, password) },
    })
    if (res.ok) {
      if (backend.mode === 'remote') this.#backend = { ...backend, username, password }
      log.info(`logged in as ${username}`)
      return
    }
    log.warn(`login failed with status ${res.status}`)
    if (res.status === 401) throw new Error('Invalid username or password')
    if (res.status === 403) throw new Error('gomuks refuses to set a secure cookie outside HTTPS or localhost')
    throw new Error(`Login failed: ${await responseError(res)}`)
  }

  start() {
    if (!this.#stopped) return
    this.#stopped = false
    window.addEventListener('focus', this.#onFocus)
    this.#connect()
  }

  stop() {
    this.#stopped = true
    window.removeEventListener('focus', this.#onFocus)
    this.#clearTimers()
    this.#stream?.close()
    this.#stream = null
    log.info('event stream stopped')
  }

  #clearTimers() {
    if (this.#pingTimer !== null) clearInterval(this.#pingTimer)
    if (this.#reconnectTimer !== null) clearTimeout(this.#reconnectTimer)
    this.#pingTimer = null
    this.#reconnectTimer = null
  }

  #onFocus = () => {
    if (this.#reconnectTimer === null) return
    log.info('window focused, reconnecting now')
    clearTimeout(this.#reconnectTimer)
    this.#reconnectTimer = null
    this.#connect()
  }

  #connect() {
    const params = new URLSearchParams()
    if (this.#runID && this.#lastReceived) {
      params.set('run_id', this.#runID)
      params.set('last_received_event', String(this.#lastReceived))
      if (this.#listenerID) params.set('prev_listener_id', String(this.#listenerID))
      log.info(`connecting: resuming run ${this.#runID} after event ${this.#lastReceived}`)
    } else if (this.#serverTS) {
      log.info('connecting: catch-up sync')
    } else {
      log.info('connecting: fresh initial sync')
    }
    if (this.#serverTS) params.set('last_server_ts', String(this.#serverTS))

    this.#connectStarted = performance.now()
    this.connection.emit({ connected: false, reconnecting: true, error: null })
    const url = this.url(`sse?${params}`)
    this.#stream = this.#backend.mode === 'remote' ? this.#openFetchStream(url) : this.#openEventSource(url)
  }

  #openEventSource(url: string): EventStream {
    const source = new EventSource(url)
    source.onopen = this.#onOpen
    source.onmessage = msg => this.#onMessage(msg.data)
    source.onerror = this.#onError
    return { close: () => source.close() }
  }

  /** EventSource can't send an Authorization header, so remote backends are read with fetch. */
  #openFetchStream(url: string): EventStream {
    const controller = new AbortController()
    const run = async () => {
      const res = await fetch(url, this.#request({ cache: 'no-store', signal: controller.signal }, { Accept: 'text/event-stream' }))
      if (res.status === 401) {
        log.warn('event stream rejected the credentials')
        this.stop()
        this.unauthorized.emit()
        return
      }
      if (!res.ok || !res.body) throw new Error(`event stream failed with status ${res.status}`)
      this.#onOpen()
      const feed = createSSEParser(this.#onMessage)
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
      for (;;) {
        const { value, done } = await reader.read()
        if (done) throw new Error('event stream ended')
        feed(value)
      }
    }
    run().catch(err => {
      if (controller.signal.aborted) return
      log.debug('event stream error', err)
      this.#onError()
    })
    return { close: () => controller.abort() }
  }

  #onOpen = () => {
    const took = formatMs(performance.now() - this.#connectStarted)
    if (this.#everConnected) log.info(`event stream reconnected in ${took}`)
    else markOnce('event stream connected', `opened in ${took}`)
    this.#everConnected = true
    this.#failures = 0
    this.connection.emit({ connected: true, reconnecting: false, error: null })
    if (this.#pingTimer !== null) clearInterval(this.#pingTimer)
    this.#pingTimer = setInterval(this.#ping, PING_INTERVAL)
  }

  #onMessage = (data: string) => {
    const started = performance.now()
    const evt = JSON.parse(data) as RPCEvent
    const parseMs = performance.now() - started
    if (evt.request_id < 0) this.#lastReceived = evt.request_id
    if (evt.command === 'run_id') {
      this.#runID = evt.data.run_id
      this.#listenerID = evt.data.listener_id
      this.vapidKey = evt.data.vapid_key
    } else if (evt.command === 'image_auth_token') {
      setImageAuthToken(evt.data)
    } else if (evt.command === 'sync_complete' && evt.data.server_timestamp) {
      this.#serverTS = evt.data.server_timestamp
    }
    this.events.emit({ evt, bytes: data.length, parseMs })
  }

  #onError = () => {
    // Take over reconnecting: EventSource's own retry wouldn't send resume params.
    this.#stream?.close()
    this.#stream = null
    this.#clearTimers()
    if (this.#stopped) return

    this.#failures++
    const backoff = Math.min(2 ** (this.#failures - 4), 10) * 1000
    log.warn(`event stream lost, reconnecting in ${backoff / 1000}s (attempt ${this.#failures})`)
    this.connection.emit({
      connected: false,
      reconnecting: true,
      error: 'Connection to gomuks lost',
      nextAttempt: Date.now() + backoff,
    })
    this.#reconnectTimer = setTimeout(async () => {
      this.#reconnectTimer = null
      // An EventSource 401 is indistinguishable from a network error, so ask /auth.
      const auth = await this.checkAuth().catch(() => 'ok' as const)
      if (auth === 'unauthorized') {
        log.warn('session is no longer valid')
        this.stop()
        this.unauthorized.emit()
      } else if (!this.#stopped) {
        this.#connect()
      }
    }, backoff)
  }

  #ping = () => {
    const evtID = this.#lastReceived
    if (!this.#runID || !this.#listenerID || !evtID || evtID === this.#lastAcked) return
    const params = new URLSearchParams({
      run_id: this.#runID,
      listener_id: String(this.#listenerID),
      last_received_event: String(evtID),
    })
    fetch(this.url(`sse/ping?${params}`), this.#request({ method: 'POST', signal: AbortSignal.timeout(PING_INTERVAL / 2) })).then(
      res => {
        if (res.ok) this.#lastAcked = evtID
        else log.debug(`ping for event ${evtID} failed with status ${res.status}`)
      },
      err => log.debug(`ping for event ${evtID} failed`, err),
    )
  }

  async exec<Resp = unknown>(command: string, data: unknown = {}, signal?: AbortSignal): Promise<Resp> {
    const started = performance.now()
    let res: Response
    try {
      res = await fetch(
        this.url(`exec/${command}`),
        this.#request({ method: 'POST', body: JSON.stringify(data), signal }, { 'Content-Type': 'application/json' }),
      )
    } catch (err) {
      log.warn(`→ ${command} network error after ${formatMs(performance.now() - started)}`, err)
      throw err
    }
    const text = await res.text()
    const took = formatMs(performance.now() - started)
    const payload = parseJSON(text, res.status, command)
    if (res.status === 401) this.unauthorized.emit()
    if (!res.ok) {
      const message = errorMessage(payload, `${command} failed (${res.status})`)
      log.warn(`→ ${command} failed (${res.status}) in ${took}: ${message}`, data)
      throw new ExecError(message, res.status)
    }
    log.debug(`→ ${command} ${res.status} in ${took} (${formatSize(text.length)})`, data)
    return payload as Resp
  }

  /** GETs an authenticated text resource, e.g. "codeblock/dracula.css". */
  async fetchText(path: string): Promise<string> {
    const res = await fetch(this.url(path), this.#request())
    if (!res.ok) throw new ExecError(`GET ${path} failed (${res.status})`, res.status)
    return res.text()
  }

  /** Uploads a file; the returned content can be sent as-is with sendMessage's base_content. */
  async upload(file: File, encrypt: boolean): Promise<MessageEventContent> {
    const started = performance.now()
    const params = new URLSearchParams({ filename: file.name, encrypt: String(encrypt) })
    const res = await fetch(
      this.url(`upload?${params}`),
      this.#request({ method: 'POST', body: file }, { 'Content-Type': file.type || 'application/octet-stream' }),
    )
    const payload = parseJSON(await res.text(), res.status, 'upload')
    const took = formatMs(performance.now() - started)
    if (res.status === 401) this.unauthorized.emit()
    if (!res.ok) {
      const message = errorMessage(payload, `Upload failed (${res.status})`)
      log.warn(`upload of ${file.name} (${formatSize(file.size)}) failed in ${took}: ${message}`)
      throw new ExecError(message, res.status)
    }
    log.info(`uploaded ${file.name} (${formatSize(file.size)}${encrypt ? ', encrypted' : ''}) in ${took}`)
    return payload as MessageEventContent
  }

  sendMessage(params: SendMessageParams) {
    return this.exec<RawDBEvent | null>('send_message', params)
  }

  /** For custom emoji (mxc:// keys), pass the shortcode so other clients can show its name. */
  sendReaction(room_id: RoomID, event_id: EventID, key: string, shortcode?: string) {
    const content: Record<string, unknown> = { 'm.relates_to': { rel_type: 'm.annotation', event_id, key } }
    if (shortcode && key.startsWith('mxc://')) content['com.beeper.reaction.shortcode'] = `:${shortcode.replaceAll(':', '')}:`
    return this.exec<RawDBEvent>('send_event', { room_id, type: 'm.reaction', content })
  }

  /** Individual state events, e.g. emoji packs from rooms whose state isn't loaded. */
  getSpecificRoomState(keys: { room_id: RoomID; type: string; state_key: string }[]) {
    return this.exec<RawDBEvent[] | null>('get_specific_room_state', { keys })
  }

  redactEvent(room_id: RoomID, event_id: EventID, reason = '') {
    return this.exec<void>('redact_event', { room_id, event_id, reason })
  }

  paginate(room_id: RoomID, max_timeline_id: number, limit = 50, reset = false) {
    return this.exec<PaginationResponse>('paginate', { room_id, max_timeline_id, limit, reset })
  }

  getRoomState(room_id: RoomID, include_members = false, fetch_members = false) {
    return this.exec<RawDBEvent[]>('get_room_state', { room_id, include_members, fetch_members, refetch: false })
  }

  /** With unredact, asks the homeserver for a deleted event's original content (usually moderators only). */
  getEvent(room_id: RoomID, event_id: EventID, unredact = false) {
    return this.exec<RawDBEvent>('get_event', { room_id, event_id, unredact })
  }

  /** Events relating to an event, e.g. its edits (m.replace) or reactions (m.annotation + m.reaction). */
  getRelatedEvents(room_id: RoomID, event_id: EventID, relation_type: string, event_type?: string) {
    return this.exec<RawDBEvent[]>('get_related_events', { room_id, event_id, relation_type, event_type })
  }

  resendEvent(transaction_id: string) {
    return this.exec<RawDBEvent>('resend_event', { transaction_id })
  }

  markRead(room_id: RoomID, event_id: EventID, receipt_type = 'm.read') {
    return this.exec<void>('mark_read', { room_id, event_id, receipt_type })
  }

  setTyping(room_id: RoomID, timeout: number) {
    return this.exec<void>('set_typing', { room_id, timeout })
  }

  /** Global account data, or room account data when room_id is given (e.g. m.tag, m.marked_unread). */
  setAccountData(type: string, content: unknown, room_id?: RoomID) {
    return this.exec<void>('set_account_data', { type, content, room_id })
  }

  /** Mutes or unmutes a room via its room push rule. */
  muteRoom(room_id: RoomID, muted: boolean) {
    return this.exec<boolean>('mute_room', { room_id, muted })
  }

  leaveRoom(room_id: RoomID, reason?: string) {
    return this.exec<Record<string, never>>('leave_room', { room_id, reason })
  }

  /** Messages around an event, for showing a linked message that isn't in the loaded timeline. */
  getEventContext(room_id: RoomID, event_id: EventID, limit = 20) {
    return this.exec<EventContextResponse>('get_event_context', { room_id, event_id, limit })
  }

  resolveAlias(alias: string) {
    return this.exec<{ room_id: RoomID; servers: string[] }>('resolve_alias', { alias })
  }
}

export const client = new GomuksClient()
