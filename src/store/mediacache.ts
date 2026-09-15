// Media cache for remote backends (e.g. othermuks on GitHub Pages). Media URLs normally carry gomuks' rotating
// image_auth token, so the browser sees a new URL for every token and downloads images again. With the media
// service worker (public/media-sw.js) in control, URLs are left without the token: the worker adds the current
// one when fetching and keeps responses in the Cache API under the stable URL.
// Same-origin setups don't need this: their media URLs never change, so the HTTP cache already works.
import { client } from '@/api/client'
import { getImageAuthToken, onImageAuthToken, setStableMediaURLs } from '@/api/media'
import { log } from '@/lib/log'
import { getPreference } from './preferences'

const WORKER = 'media-sw.js'
export const MEDIA_CACHE_NAME = 'othermuks-media-v1'
const AUTH_MESSAGE = 'othermuks-media-auth'
const AUTH_REQUEST = 'othermuks-media-auth-request'

const supported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && window.isSecureContext

function isOurWorker(worker: ServiceWorker | null | undefined) {
  return !!worker && new URL(worker.scriptURL).pathname.endsWith(`/${WORKER}`)
}

function postAuth() {
  const controller = navigator.serviceWorker.controller
  const token = getImageAuthToken()
  if (!isOurWorker(controller) || !token || client.backend.mode !== 'remote') return
  controller!.postMessage({ type: AUTH_MESSAGE, backend: client.backend.baseURL, token })
}

function updateActive() {
  const active = isOurWorker(navigator.serviceWorker.controller) && client.backend.mode === 'remote'
  setStableMediaURLs(active)
  if (active) postAuth()
}

let wired = false

/** Registers the media worker for remote backends when caching is enabled, or removes it otherwise. */
export async function setupMediaCache() {
  if (!supported()) return
  if (!wired) {
    wired = true
    navigator.serviceWorker.addEventListener('controllerchange', updateActive)
    navigator.serviceWorker.addEventListener('message', event => {
      if ((event.data as { type?: unknown } | null)?.type === AUTH_REQUEST) postAuth()
    })
    onImageAuthToken(postAuth)
  }
  if (client.backend.mode !== 'remote' || !getPreference('cache_on_device')) {
    setStableMediaURLs(false)
    await unregisterMediaWorker()
    return
  }
  // A worker already controlling the page (every load after the first) takes effect right away.
  updateActive()
  try {
    await navigator.serviceWorker.register(new URL(WORKER, document.baseURI).href, { scope: new URL('./', document.baseURI).href })
  } catch (err) {
    log.warn('media cache: service worker registration failed', err)
  }
}

async function unregisterMediaWorker() {
  const registrations = await navigator.serviceWorker.getRegistrations().catch(() => [])
  await Promise.all(registrations.filter(reg => isOurWorker(reg.active ?? reg.waiting ?? reg.installing)).map(reg => reg.unregister()))
}

export async function clearMediaCache() {
  setStableMediaURLs(false)
  if (!supported()) return
  await unregisterMediaWorker()
  if (typeof caches !== 'undefined') await caches.delete(MEDIA_CACHE_NAME)
}
