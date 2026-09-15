// othermuks media cache service worker (remote backends only, see src/store/mediacache.ts).
// Media URLs from the page carry no image_auth token, so they stay the same across token rotations and
// sessions. This worker adds the current token (sent by the page) when fetching from the gomuks backend and
// keeps successful responses in the Cache API. Every other request goes to the network untouched.
const CACHE = 'othermuks-media-v1'
const META = 'othermuks-media-meta'
const MAX_ENTRIES = 4000
const MAX_ENTRY_BYTES = 20 * 1024 * 1024
const AUTH_WAIT_MS = 4000

let auth = null // { backend, token }
let authLoading = null
let waiters = []
let putsSinceTrim = 0

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter(name => name.startsWith('othermuks-media-') && name !== CACHE && name !== META).map(name => caches.delete(name)))
      await self.clients.claim()
    })(),
  )
})

function setAuth(next) {
  auth = next
  authLoading = Promise.resolve(next)
  caches
    .open(META)
    .then(cache => cache.put('auth', new Response(JSON.stringify(next), { headers: { 'Content-Type': 'application/json' } })))
    .catch(() => {})
  const pending = waiters
  waiters = []
  for (const resolve of pending) resolve(next)
}

/** The last token survives the worker being stopped and restarted. */
function loadAuth() {
  if (auth) return Promise.resolve(auth)
  authLoading ??= caches
    .open(META)
    .then(cache => cache.match('auth'))
    .then(res => (res ? res.json() : null))
    .then(stored => (auth ??= stored))
    .catch(() => null)
  return authLoading
}

/** Asks open othermuks tabs for their current token (none known yet, or the known one was rejected). */
async function requestAuth(rejectedToken) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const answer = new Promise(resolve => {
    waiters.push(resolve)
    setTimeout(() => resolve(auth), AUTH_WAIT_MS)
  })
  for (const client of windows) client.postMessage({ type: 'othermuks-media-auth-request' })
  const next = await answer
  return next && next.token !== rejectedToken ? next : null
}

self.addEventListener('message', event => {
  const data = event.data
  if (data?.type === 'othermuks-media-auth' && typeof data.token === 'string' && typeof data.backend === 'string') {
    setAuth({ backend: data.backend.replace(/\/+$/, ''), token: data.token })
  }
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  // Only cross-origin gomuks media without a token of its own (the page's stable URLs).
  if (url.origin === self.location.origin || !url.pathname.includes('/_gomuks/media/') || url.searchParams.has('image_auth')) return
  event.respondWith(handleMedia(request, url))
})

function fetchWithToken(request, url, token) {
  const target = new URL(url)
  target.searchParams.set('image_auth', token)
  const range = request.headers.get('range')
  const init = { mode: 'cors', credentials: 'omit', ...(range ? { headers: { Range: range } } : {}) }
  // Without CORS headers on the backend the response can still be shown, just not cached.
  return fetch(target, init).catch(() => fetch(target, { mode: 'no-cors', credentials: 'omit' }))
}

async function trim(cache) {
  putsSinceTrim = 0
  const keys = await cache.keys()
  if (keys.length > MAX_ENTRIES) await Promise.all(keys.slice(0, keys.length - MAX_ENTRIES).map(key => cache.delete(key)))
}

async function handleMedia(request, url) {
  let current = (await loadAuth()) ?? (await requestAuth(null))
  if (!current || !url.href.startsWith(`${current.backend}/_gomuks/media/`)) return fetch(request)

  const ranged = request.headers.has('range')
  const cache = await caches.open(CACHE)
  if (!ranged) {
    const hit = await cache.match(url.href)
    if (hit) return hit
  }

  let response = await fetchWithToken(request, url, current.token)
  if (response.status === 401 || response.status === 403) {
    const fresh = await requestAuth(current.token)
    if (fresh) {
      current = fresh
      response = await fetchWithToken(request, url, fresh.token)
    }
  }

  const size = Number(response.headers.get('content-length') || 0)
  if (!ranged && response.status === 200 && response.type === 'cors' && size <= MAX_ENTRY_BYTES) {
    const copy = response.clone()
    cache
      .put(url.href, copy)
      .then(() => {
        if (++putsSinceTrim >= 50) return trim(cache)
      })
      .catch(() => {})
  }
  return response
}
