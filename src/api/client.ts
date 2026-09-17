// Transport for the gomuks backend: SSE for events, POST /_gomuks/exec for commands.
// HTTP spec: https://spec.mau.fi/gomuks/http.html  RPC spec: https://spec.mau.fi/gomuks/rpc.html
import { formatMs, formatSize, log } from '@/lib/log'
import { markOnce } from '@/lib/perf'
import {
  basicAuthHeader,
  forgetWebsocketPreferred,
  rememberWebsocketPreferred,
  websocketPreferred,
  type BackendConfig,
} from './backend'
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
/** How long an event stream may go without a response or its first data before it counts as stuck. */
const STREAM_STALL_TIMEOUT = 20_000
/** gomuks closes a websocket that sends nothing for a minute; we give up on one that receives nothing as long. */
const WS_RECV_TIMEOUT = 4 * PING_INTERVAL

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
  /**
   * How events arrive. Always SSE, except on the same origin after SSE stalled (e.g. a firewall that
   * holds streaming responses back): then gomuks' websocket, for the rest of the session. A websocket
   * can't carry Basic auth and gomuks' cookie is SameSite=Lax, so remote backends stay on SSE.
   *
   * The choice is remembered per browser, so a network that stalls the stream costs the wait once
   * rather than on every load. A websocket that then delivers nothing drops that memory again.
   */
  #transport: 'sse' | 'websocket' = 'sse'
  /** Whether SSE already stalled this session, so the websocket is the only transport left to try. */
  #sseStalled = false

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
    this.#transport = backend.mode === 'same-origin' && websocketPreferred() ? 'websocket' : 'sse'
    this.#sseStalled = false
    this.#runID = undefined
    this.#listenerID = undefined
    this.#lastReceived = undefined
    this.#lastAcked = undefined
    this.#serverTS = undefined
    setMediaBackend(backend.mode === 'remote' ? backend.baseURL : null)
    log.info(backend.mode === 'remote' ? `backend: ${backend.baseURL} (remote, basic auth)` : 'backend: this site (same origin, cookie auth)')
  }

  /** Resume from cached state: the first connection then asks only for changes since this server time. */
  setCatchupTimestamp(serverTimestamp: number) {
    this.#serverTS = serverTimestamp
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
      // prev_listener_id is deliberately not sent. gomuks clears that listener's acknowledgement
      // before subscribing us, and with no listener left to keep events for, its buffer garbage
      // collection drops everything we're about to ask it to replay: the resume then finds nothing
      // and falls back to a catch-up sync. The stale listener ages out of the buffer on its own.
      log.info(`connecting: resuming run ${this.#runID} after event ${this.#lastReceived}`)
    } else if (this.#serverTS) {
      log.info('connecting: catch-up sync')
    } else {
      log.info('connecting: fresh initial sync')
    }
    if (this.#serverTS) params.set('last_server_ts', String(this.#serverTS))

    this.#connectStarted = performance.now()
    this.connection.emit({ connected: false, reconnecting: true, error: null })
    if (this.#backend.mode === 'remote') {
      this.#stream = this.#openFetchStream(this.url(`sse?${params}`))
    } else if (this.#transport === 'websocket') {
      this.#stream = this.#openWebSocket(params)
    } else {
      this.#stream = this.#openEventSource(this.url(`sse?${params}`))
    }
  }

  #openEventSource(url: string): EventStream {
    const source = new EventSource(url)
    let receiving = false
    // EventSource can report "open" while a proxy holds the body back, so only events count. If none
    // arrive, fall back to gomuks' websocket (same origin: the cookie authenticates it).
    const stallTimer = setTimeout(() => {
      if (receiving) return
      log.warn(`event stream stalled: no data after ${STREAM_STALL_TIMEOUT / 1000}s, switching to the websocket`)
      source.close()
      this.#stream = null
      this.#sseStalled = true
      this.#transport = 'websocket'
      if (!this.#stopped) this.#connect()
    }, STREAM_STALL_TIMEOUT)
    source.onmessage = msg => {
      if (!receiving) {
        receiving = true
        clearTimeout(stallTimer)
        this.#onOpen()
      }
      this.#onMessage(msg.data)
    }
    source.onerror = () => {
      clearTimeout(stallTimer)
      this.#onError()
    }
    return {
      close: () => {
        clearTimeout(stallTimer)
        source.close()
      },
    }
  }

  /**
   * gomuks' websocket, used only for receiving events (commands still go over HTTP exec). It needs a
   * ping at least every minute; pings also acknowledge the last received event, like /sse/ping.
   */
  #openWebSocket(params: URLSearchParams): EventStream {
    const url = new URL('/_gomuks/websocket', location.href)
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    url.search = params.toString()
    log.info(`connecting over the websocket: ${url.pathname}${url.search}`)
    const socket = new WebSocket(url)
    let receiving = false
    let closed = false
    let lastMessage = Date.now()
    let requestID = 0

    const cleanup = () => {
      closed = true
      clearTimeout(stallTimer)
      clearInterval(pingTimer)
      socket.onmessage = null
      socket.onclose = null
      socket.onerror = null
    }
    const fail = (reason?: string) => {
      if (closed) return
      cleanup()
      socket.close()
      this.#onError(reason)
    }

    const stallTimer = setTimeout(() => {
      if (receiving) return
      log.warn(`websocket stalled: no data after ${STREAM_STALL_TIMEOUT / 1000}s`)
      fail(
        this.#websocketFailed()
          ? undefined
          : 'No data from gomuks over the event stream or the websocket. This network seems to block both.',
      )
    }, STREAM_STALL_TIMEOUT)

    const pingTimer = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return
      if (Date.now() - lastMessage > WS_RECV_TIMEOUT) {
        log.warn(`websocket received nothing for ${WS_RECV_TIMEOUT / 1000}s`)
        fail()
        return
      }
      socket.send(JSON.stringify({ command: 'ping', request_id: ++requestID, data: { last_received_id: this.#lastReceived ?? 0 } }))
    }, PING_INTERVAL)

    socket.onmessage = msg => {
      if (typeof msg.data !== 'string') return
      lastMessage = Date.now()
      if (!receiving) {
        receiving = true
        clearTimeout(stallTimer)
        // Data, not just an open socket, is what makes this worth skipping SSE for next time.
        rememberWebsocketPreferred()
        this.#onOpen()
      }
      // One JSON command per line (gomuks may put several in one frame).
      for (const line of msg.data.split('\n')) {
        if (!line.trim() || line.startsWith('{"command":"pong"')) continue
        this.#onMessage(line)
      }
    }
    socket.onerror = () => log.debug('websocket error')
    socket.onclose = event => {
      if (closed) return
      log.warn(`websocket closed (${event.code}${event.reason ? `: ${event.reason}` : ''})`)
      cleanup()
      // A handshake gomuks refuses (e.g. a reverse proxy that doesn't forward the browser's Host,
      // which fails its Origin check) closes here without ever delivering an event.
      if (!receiving) this.#websocketFailed()
      this.#onError()
    }
    return {
      close: () => {
        if (closed) return
        cleanup()
        socket.close(1000, 'Client closed')
      },
    }
  }

  /** EventSource can't send an Authorization header, so remote backends are read with fetch. */
  #openFetchStream(url: string): EventStream {
    const controller = new AbortController()
    // gomuks answers and sends its first events right away. If nothing arrives, something between the
    // browser and the server (antivirus web scanning, a proxy, an extension) is holding the stream back;
    // without a watchdog the page would wait silently forever.
    let stallTimer: ReturnType<typeof setTimeout> | undefined
    let stalled: string | null = null
    const watch = (stage: string) => {
      clearTimeout(stallTimer)
      stallTimer = setTimeout(() => {
        stalled = stage
        log.warn(`event stream stalled: ${stage} after ${STREAM_STALL_TIMEOUT / 1000}s`)
        controller.abort()
        // Report right away rather than waiting for the aborted request to reject.
        this.#onError(
          `No data from gomuks (${stage}). Something between this browser and the server may be holding back the event ` +
            'stream: antivirus HTTPS or web scanning, a VPN or company proxy, or a browser extension. ' +
            "(The websocket fallback only works when othermuks is opened from the gomuks server's own address.)",
        )
      }, STREAM_STALL_TIMEOUT)
    }
    const run = async () => {
      watch('no response')
      const res = await fetch(url, this.#request({ cache: 'no-store', signal: controller.signal }, { Accept: 'text/event-stream' }))
      log.info(
        `event stream response: HTTP ${res.status}, ${res.headers.get('content-type') ?? 'no content-type'}, ` +
          `encoding ${res.headers.get('content-encoding') ?? 'none'}`,
      )
      if (res.status === 401) {
        clearTimeout(stallTimer)
        log.warn('event stream rejected the credentials')
        this.stop()
        this.unauthorized.emit()
        return
      }
      if (!res.ok || !res.body) throw new Error(`event stream failed with status ${res.status}`)
      watch('response headers arrived but no data')
      const feed = createSSEParser(this.#onMessage)
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
      let receiving = false
      for (;;) {
        const { value, done } = await reader.read()
        if (done) throw new Error('event stream ended')
        if (!receiving) {
          // Only data proves the stream works; headers alone can arrive while the body is held back.
          receiving = true
          clearTimeout(stallTimer)
          this.#onOpen()
        }
        feed(value)
      }
    }
    run().catch(err => {
      clearTimeout(stallTimer)
      // A stall was already reported by the watchdog; a close() abort needs no handling.
      if (stalled || controller.signal.aborted) return
      log.debug('event stream error', err)
      this.#onError()
    })
    return {
      close: () => {
        clearTimeout(stallTimer)
        controller.abort()
      },
    }
  }

  /**
   * A websocket that delivered nothing is no fallback, so it stops being the remembered one. Returns
   * whether there's still SSE to go back to: once it has stalled this session, both have failed.
   */
  #websocketFailed(): boolean {
    forgetWebsocketPreferred()
    if (this.#sseStalled) return false
    log.warn('websocket delivered nothing, going back to the event stream')
    this.#transport = 'sse'
    return true
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

  #onError = (reason?: string) => {
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
      error: reason ?? 'Connection to gomuks lost',
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
    // The websocket acknowledges events with its own pings.
    if (this.#transport === 'websocket' && this.#backend.mode === 'same-origin') return
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

  /**
   * Stores a push registration in gomuks under a stable per-browser device ID. Web push passes the
   * browser's PushSubscription as data; type "null" stops pushes to that device.
   */
  registerPush(params: { type: 'web' | 'null'; device_id: string; data: unknown; expiration?: number }) {
    return this.exec<void>('register_push', params)
  }

  // ---- Widget API support ----

  sendEvent(room_id: RoomID, type: string, content: unknown, opts: { disable_encryption?: boolean; synchronous?: boolean } = {}) {
    return this.exec<RawDBEvent>('send_event', { room_id, type, content, ...opts })
  }

  /** With delay_ms, schedules a delayed state event and returns its delay ID instead of an event ID. */
  setState(room_id: RoomID, type: string, state_key: string, content: unknown, extra: { delay_ms?: number } = {}) {
    return this.exec<string>('set_state', { room_id, type, state_key, content, ...extra })
  }

  sendStickyEvent(room_id: RoomID, type: string, content: unknown, sticky_duration_ms: number, delay_ms?: number) {
    return this.exec<string>('send_sticky_event', { room_id, type, content, sticky_duration_ms, delay_ms })
  }

  updateDelayedEvent(delay_id: string, action: 'cancel' | 'restart' | 'send') {
    return this.exec<void>('update_delayed_event', { delay_id, action })
  }

  sendToDevice(event_type: string, messages: Record<string, Record<string, object>>, encrypted: boolean) {
    return this.exec<void>('send_to_device', { event_type, messages, encrypted })
  }

  requestOpenIDToken() {
    return this.exec<{ access_token: string; token_type: string; matrix_server_name: string; expires_in: number } | null>(
      'request_openid_token',
      {},
    )
  }

  getTurnServers() {
    return this.exec<{ uris: string[]; username: string; password: string; ttl?: number }>('get_turn_servers', {})
  }

  getRTCTransports() {
    return this.exec<unknown>('get_rtc_transports', {})
  }

  getMediaConfig() {
    return this.exec<Record<string, unknown>>('get_media_config', {})
  }

  /** Whether gomuks includes to-device events in syncs (only needed while widgets are open). */
  setListenToDevice(listen: boolean) {
    return this.exec<boolean>('listen_to_device', listen)
  }

  getStickyEvents(room_id: RoomID) {
    return this.exec<RawDBEvent[] | null>('get_sticky_events', { room_id })
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
