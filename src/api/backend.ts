// Which gomuks backend the client talks to, and how.
//
// same-origin: the page is served from the backend's own domain (reverse proxy routes /_gomuks/ to gomuks).
//   Auth uses gomuks' HttpOnly cookie, exactly like the official web client.
// remote: the page is hosted elsewhere (e.g. GitHub Pages) and the user types a backend address.
//   gomuks can't be changed, and a cross-site cookie would be third-party, so every request carries
//   HTTP Basic auth. The backend's reverse proxy must allow CORS (see CORS_SNIPPET).

export type BackendConfig =
  | { mode: 'same-origin' }
  /** `password` is absent when the backend has auth disabled. */
  | { mode: 'remote'; baseURL: string; username: string; password?: string }

export function basicAuthHeader(username: string, password: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(`${username}:${password}`)) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

/** Accepts "host", "https://host/", "https://host/_gomuks"; returns "https://host" (keeping any sub-path). */
export function normalizeBackendURL(input: string): string | null {
  let value = input.trim()
  if (!value) return null
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  try {
    const url = new URL(value)
    const path = url.pathname.replace(/\/+$/, '').replace(/\/_gomuks$/, '')
    return `${url.origin}${path}`
  } catch {
    return null
  }
}

// ---- persistence ----------------------------------------------------------------------------

export interface StoredBackend {
  baseURL: string
  username?: string
  /** Only present when the user chose to remember it (localStorage) or for this tab (sessionStorage). */
  password?: string
  remember?: boolean
  authDisabled?: boolean
}

const BACKEND_KEY = 'othermuks-backend'
const SESSION_PASSWORD_KEY = 'othermuks-backend-password'
const PICK_BACKEND_KEY = 'othermuks-pick-backend'

function readJSON<T>(storage: () => Storage, key: string): T | null {
  try {
    const raw = storage().getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJSON(storage: () => Storage, key: string, value: unknown) {
  try {
    storage().setItem(key, JSON.stringify(value))
  } catch {
    // Storage blocked (private mode etc.): the session still works, it just won't be remembered.
  }
}

function remove(storage: () => Storage, key: string) {
  try {
    storage().removeItem(key)
  } catch {
    // ignore
  }
}

export function loadStoredBackend(): StoredBackend | null {
  const stored = readJSON<StoredBackend>(() => localStorage, BACKEND_KEY)
  if (!stored?.baseURL) return null
  if (stored.password === undefined) {
    const tabPassword = readJSON<string>(() => sessionStorage, SESSION_PASSWORD_KEY)
    if (typeof tabPassword === 'string') stored.password = tabPassword
  }
  return stored
}

export function saveRemoteBackend({ password, remember, ...rest }: StoredBackend) {
  writeJSON(() => localStorage, BACKEND_KEY, { ...rest, remember, password: remember ? password : undefined })
  if (!remember && password !== undefined) writeJSON(() => sessionStorage, SESSION_PASSWORD_KEY, password)
  else remove(() => sessionStorage, SESSION_PASSWORD_KEY)
}

export function forgetPassword() {
  const stored = readJSON<StoredBackend>(() => localStorage, BACKEND_KEY)
  if (stored) writeJSON(() => localStorage, BACKEND_KEY, { ...stored, password: undefined })
  remove(() => sessionStorage, SESSION_PASSWORD_KEY)
}

export function clearStoredBackend() {
  remove(() => localStorage, BACKEND_KEY)
  remove(() => sessionStorage, SESSION_PASSWORD_KEY)
}

/** Makes the next page load show the backend picker even if this site has its own gomuks. */
export function requestBackendPicker() {
  writeJSON(() => sessionStorage, PICK_BACKEND_KEY, true)
}

export function consumeBackendPickerRequest(): boolean {
  const requested = readJSON<boolean>(() => sessionStorage, PICK_BACKEND_KEY) === true
  remove(() => sessionStorage, PICK_BACKEND_KEY)
  return requested
}

// ---- probing --------------------------------------------------------------------------------

export type SameOriginStatus = 'ok' | 'disabled' | 'login' | 'none'

/** Is there a gomuks behind /_gomuks/ on this page's own origin, and is the cookie still valid? */
export async function probeSameOrigin(): Promise<SameOriginStatus> {
  try {
    const res = await fetch(`/_gomuks/auth?no_prompt=true&secure=${window.isSecureContext}`, {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    const isHTML = res.headers.get('content-type')?.includes('text/html')
    if (res.status === 204) return 'disabled'
    if ((res.status === 200 || res.status === 201) && !isHTML) return 'ok'
    if (res.status === 401 && (await res.text()).includes('basic auth credentials')) return 'login'
    return 'none'
  } catch {
    return 'none'
  }
}

export interface ProbeSuccess {
  ok: true
  baseURL: string
  authDisabled: boolean
}

export interface ProbeFailure {
  ok: false
  baseURL?: string
  reason: 'invalid-url' | 'insecure' | 'unreachable' | 'cors' | 'preflight' | 'not-gomuks'
  detail?: string
}

const PROBE_TIMEOUT = 10_000

/** Checks that an address is a reachable gomuks backend that allows this page to use it cross-origin. */
export async function probeBackend(input: string): Promise<ProbeSuccess | ProbeFailure> {
  const baseURL = normalizeBackendURL(input)
  if (!baseURL) return { ok: false, reason: 'invalid-url' }
  const url = new URL(baseURL)
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (location.protocol === 'https:' && url.protocol === 'http:' && !isLocal) {
    return { ok: false, baseURL, reason: 'insecure' }
  }

  // output=json keeps gomuks from setting a cookie; this client doesn't use cookies cross-origin.
  const authURL = `${baseURL}/_gomuks/auth?no_prompt=true&output=json`
  let res: Response
  try {
    res = await fetch(authURL, { method: 'POST', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(PROBE_TIMEOUT) })
  } catch {
    // The response wasn't readable. An opaque request tells "server down" apart from "CORS not allowed".
    try {
      await fetch(authURL, { method: 'POST', mode: 'no-cors', credentials: 'omit', signal: AbortSignal.timeout(PROBE_TIMEOUT) })
      return { ok: false, baseURL, reason: 'cors' }
    } catch {
      return { ok: false, baseURL, reason: 'unreachable' }
    }
  }

  if (res.status === 204) return { ok: true, baseURL, authDisabled: true }
  const body = await res.text().catch(() => '')
  if (res.status !== 401 || !body.includes('basic auth credentials')) {
    return { ok: false, baseURL, reason: 'not-gomuks', detail: `HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}` }
  }

  // Authenticated requests send an Authorization header, which triggers a CORS preflight (OPTIONS).
  // Empty credentials are simply rejected by gomuks with 401, which is all we need to see.
  try {
    await fetch(authURL, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      headers: { Authorization: basicAuthHeader('', '') },
      signal: AbortSignal.timeout(PROBE_TIMEOUT),
    })
  } catch {
    return { ok: false, baseURL, reason: 'preflight' }
  }
  return { ok: true, baseURL, authDisabled: false }
}

/** Reverse-proxy config a backend needs so browser clients hosted elsewhere can use it. */
export const CORS_SNIPPET = `location /_gomuks/ {
    # Browsers pre-check authenticated cross-origin requests; gomuks itself would reject OPTIONS.
    if ($request_method = OPTIONS) {
        add_header Access-Control-Allow-Origin * always;
        add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, Content-Type, Cache-Control" always;
        add_header Access-Control-Max-Age 86400 always;
        return 204;
    }
    add_header Access-Control-Allow-Origin * always;

    proxy_pass http://YOUR-GOMUKS:29325;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Accept-Encoding "";
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $http_connection;
    proxy_buffering off;
    proxy_read_timeout 3600s;
    client_max_body_size 1000M;
}`
