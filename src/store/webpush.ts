// Web push through gomuks, modelled on gomuks web's registerWebPush: the browser subscribes with the
// backend's VAPID key and the subscription is stored in gomuks with register_push, under a device ID
// that is unique to this browser and never changes. Disabling registers the same device ID with type
// "null". Registrations expire (7 days by default), so they're refreshed on every connection.
import { create } from 'zustand'
import { client } from '@/api/client'
import type { EventID, RoomID } from '@/api/types'
import { log } from '@/lib/log'
import { useChat } from './chat'
import { openMatrixTarget } from './navigation'
import { getPreference, PreferenceContext, setPreference, useLocalPrefs } from './preferences'
import { showToast } from './ui'

const DEVICE_ID_KEY = 'othermuks-push-device-id'
const REGISTERED_KEY = 'othermuks-push-registered'
const WORKER_PATH = 'pushmuks-sw.js'
const OPEN_ROOM_MESSAGE = 'othermuks-open-room'

export type WebPushStatus = 'unsupported' | 'off' | 'working' | 'on' | 'blocked' | 'error'

export const useWebPush = create<{ status: WebPushStatus; detail: string | null }>()(() => ({
  status: webPushSupported() ? 'off' : 'unsupported',
  detail: null,
}))

export function webPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Storage blocked: the registration still works for this session.
  }
}

/** Unique to this browser and stable: created once and never rotated. */
export function pushDeviceID(): string {
  let id = readStorage(DEVICE_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    writeStorage(DEVICE_ID_KEY, id)
  }
  return id
}

/** A scope of its own, so the worker never controls (or caches) the app's pages. */
const workerScope = () => new URL('pushmuks/', document.baseURI).href

function workerURL(): string {
  const url = new URL(WORKER_PATH, document.baseURI)
  if (client.backend.mode === 'remote') url.searchParams.set('backend', client.backend.baseURL)
  return url.href
}

function base64URLToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const raw = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

function sameKey(current: ArrayBuffer | null, wanted: Uint8Array): boolean {
  if (!current || current.byteLength !== wanted.byteLength) return false
  const view = new Uint8Array(current)
  return view.every((byte, i) => byte === wanted[i])
}

class PushError extends Error {
  readonly status: WebPushStatus
  /** Whether the user's choice can't work at all (so the setting is turned back off). */
  readonly permanent: boolean

  constructor(status: WebPushStatus, message: string, permanent: boolean) {
    super(message)
    this.status = status
    this.permanent = permanent
  }
}

async function enable() {
  const vapidKey = client.vapidKey
  if (!vapidKey) throw new PushError('error', "This gomuks backend doesn't have web push set up (it sent no VAPID key).", true)
  if (Notification.permission === 'denied') {
    throw new PushError('blocked', 'Notifications are blocked for this site. Allow them in the browser settings, then try again.', true)
  }
  if (Notification.permission !== 'granted') {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      throw new PushError('blocked', permission === 'denied' ? 'Notification permission was denied.' : 'Notification permission was dismissed.', true)
    }
  }
  let key: Uint8Array<ArrayBuffer>
  try {
    key = base64URLToBytes(vapidKey)
  } catch {
    throw new PushError('error', 'The gomuks backend sent an invalid VAPID key.', true)
  }
  const registration = await navigator.serviceWorker.register(workerURL(), { scope: workerScope() })
  let subscription = await registration.pushManager.getSubscription()
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    // Subscribed for another backend (different VAPID key): start over.
    await subscription.unsubscribe()
    subscription = null
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  await client.registerPush({ type: 'web', device_id: pushDeviceID(), data: subscription.toJSON() })
  writeStorage(REGISTERED_KEY, '1')
}

async function disable() {
  const registration = await navigator.serviceWorker.getRegistration(workerScope())
  const subscription = await registration?.pushManager.getSubscription()
  await subscription?.unsubscribe().catch(err => log.debug('push unsubscribe failed', err))
  await registration?.unregister().catch(err => log.debug('push worker unregister failed', err))
  if (readStorage(REGISTERED_KEY)) {
    await client.registerPush({ type: 'null', device_id: pushDeviceID(), data: null, expiration: 1 })
    writeStorage(REGISTERED_KEY, null)
  }
}

const setStatus = (status: WebPushStatus, detail: string | null = null) => useWebPush.setState({ status, detail })
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

async function sync(userInitiated: boolean) {
  if (!webPushSupported()) {
    setStatus('unsupported')
    if (userInitiated && getPreference('web_push')) {
      showToast("Push notifications need HTTPS and a browser with service worker and push support.")
      void setPreference(PreferenceContext.Device, 'web_push', undefined)
    }
    return
  }
  if (getPreference('web_push')) {
    setStatus('working')
    try {
      await enable()
      setStatus('on')
      if (userInitiated) showToast('Push notifications are on for this browser')
    } catch (err) {
      const pushError = err instanceof PushError ? err : null
      setStatus(pushError?.status ?? 'error', errorText(err))
      log.warn('web push registration failed', err)
      // Only give up on the setting when it can't work; a failed refresh (e.g. offline) retries on the next connection.
      if (pushError?.permanent || userInitiated) {
        showToast(`Couldn't turn on push notifications: ${errorText(err)}`)
        void setPreference(PreferenceContext.Device, 'web_push', undefined)
      }
    }
    return
  }
  const registration = await navigator.serviceWorker.getRegistration(workerScope()).catch(() => undefined)
  if (!registration && !readStorage(REGISTERED_KEY)) {
    setStatus('off')
    return
  }
  setStatus('working')
  try {
    await disable()
    setStatus('off')
  } catch (err) {
    setStatus('error', `Couldn't unregister: ${errorText(err)}`)
    log.warn('web push unregistration failed', err)
  }
}

let queue: Promise<void> = Promise.resolve()

/** Brings the browser's push registration in line with the web_push setting (one run at a time). */
export function syncWebPush(userInitiated = false): Promise<void> {
  queue = queue.then(() => sync(userInitiated))
  return queue
}

// ---- Opening rooms from notifications ----

let pendingTarget: { roomID: RoomID; eventID?: EventID } | null = null

function openFromNotification(roomID: RoomID, eventID?: EventID) {
  if (useChat.getState().initComplete) void openMatrixTarget({ kind: 'room', roomID, eventID, via: [] })
  else pendingTarget = { roomID, eventID }
}

/** A notification clicked while no othermuks window was open opens the app with ?open_room=…&open_event=… */
function takeOpenParams() {
  const params = new URLSearchParams(location.search)
  const roomID = params.get('open_room')
  if (!roomID) return
  const eventID = params.get('open_event') ?? undefined
  params.delete('open_room')
  params.delete('open_event')
  const query = params.toString()
  history.replaceState(history.state, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`)
  openFromNotification(roomID, eventID)
}

let wired = false

export function wireWebPush() {
  if (wired) return
  wired = true
  takeOpenParams()
  useChat.subscribe((state, prev) => {
    if (state.initComplete && !prev.initComplete && pendingTarget) {
      const target = pendingTarget
      pendingTarget = null
      void openMatrixTarget({ kind: 'room', roomID: target.roomID, eventID: target.eventID, via: [] })
    }
  })
  if (!webPushSupported()) return

  navigator.serviceWorker.addEventListener('message', event => {
    const data = event.data as { type?: unknown; roomID?: unknown; eventID?: unknown } | null
    if (data?.type === OPEN_ROOM_MESSAGE && typeof data.roomID === 'string') {
      openFromNotification(data.roomID, typeof data.eventID === 'string' ? data.eventID : undefined)
    }
  })
  // Messages from the worker aren't delivered to pages it doesn't control until this is called.
  navigator.serviceWorker.startMessages()

  // Every new connection refreshes the registration (they expire) once the VAPID key is known.
  client.events.on(({ evt }) => {
    if (evt.command === 'run_id') void syncWebPush(false)
  })
  let enabled = getPreference('web_push')
  useLocalPrefs.subscribe(() => {
    const next = getPreference('web_push')
    if (next === enabled) return
    enabled = next
    void syncWebPush(true)
  })
}
