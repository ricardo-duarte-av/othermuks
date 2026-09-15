import type { ContentURI, UserID } from './types'

// Same-origin: root-relative URLs authenticated by the gomuks cookie.
// Remote: absolute URLs on the backend with gomuks' short-lived image_auth token, since
// <img>/<video> can't send an Authorization header.
let backendBaseURL: string | null = null
let imageAuthToken: string | null = null
/** The media service worker adds the token itself, so URLs stay stable and cacheable (store/mediacache). */
let stableURLs = false
const tokenListeners = new Set<(token: string) => void>()

export function setMediaBackend(baseURL: string | null) {
  backendBaseURL = baseURL
}

export function setImageAuthToken(token: string) {
  imageAuthToken = token
  for (const listener of tokenListeners) listener(token)
}

export const getImageAuthToken = () => imageAuthToken

export function onImageAuthToken(listener: (token: string) => void) {
  tokenListeners.add(listener)
}

export function setStableMediaURLs(stable: boolean) {
  stableURLs = stable
}

const apiRoot = () => (backendBaseURL ? `${backendBaseURL}/_gomuks/` : '/_gomuks/')

/** URL for a gomuks media path such as "media/server/id?encrypted=false". */
export function gomuksMediaURL(path: string): string {
  const url = apiRoot() + path
  if (!backendBaseURL || !imageAuthToken || stableURLs) return url
  return `${url}${url.includes('?') ? '&' : '?'}image_auth=${encodeURIComponent(imageAuthToken)}`
}

export function isGomuksMediaURL(src: string): boolean {
  return src.startsWith(`${apiRoot()}media/`)
}

const mxcRegex = /^mxc:\/\/([^/]+)\/([^/?#]+)$/

export function parseMxc(mxc?: string): [server: string, mediaID: string] | null {
  const match = mxc ? mxcRegex.exec(mxc) : null
  return match ? [match[1], match[2]] : null
}

export function mediaURL(mxc?: ContentURI, encrypted = false): string | undefined {
  const parsed = parseMxc(mxc)
  if (!parsed) return undefined
  const [server, mediaID] = parsed
  return gomuksMediaURL(`media/${encodeURIComponent(server)}/${encodeURIComponent(mediaID)}?encrypted=${encrypted}`)
}

export function avatarURL(mxc?: ContentURI, encrypted = false): string | undefined {
  const url = mediaURL(mxc, encrypted)
  return url && `${url}&thumbnail=avatar`
}

const USER_COLOR_COUNT = 8

/** Stable 0..7 index used to pick --user-color-N for a user's name and fallback avatar. */
export function userColorIndex(id: UserID | string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return Math.abs(hash) % USER_COLOR_COUNT
}
