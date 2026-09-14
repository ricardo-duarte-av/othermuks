// Blurhash placeholders (xyz.amorgan.blurhash) shown while media loads. Decoding happens locally,
// so placeholders appear instantly with no network request.
import { decode, isBlurhashValid } from 'blurhash'
import type { MediaInfo } from '@/api/types'

// A tiny image is plenty: CSS stretches it and the blur hides the scaling.
const SIZE = 32
const CACHE_LIMIT = 500
const cache = new Map<string, string | null>()

export function blurhashOf(info?: MediaInfo): string | undefined {
  return info?.['xyz.amorgan.blurhash'] ?? info?.thumbnail_info?.['xyz.amorgan.blurhash']
}

/** A data: URL of the decoded blurhash, or undefined when there's none or it's invalid. */
export function blurhashDataURL(hash?: string): string | undefined {
  if (!hash) return undefined
  let url = cache.get(hash)
  if (url === undefined) {
    url = null
    try {
      if (isBlurhashValid(hash).result) {
        const canvas = document.createElement('canvas')
        canvas.width = SIZE
        canvas.height = SIZE
        const context = canvas.getContext('2d')
        if (context) {
          const image = context.createImageData(SIZE, SIZE)
          image.data.set(decode(hash, SIZE, SIZE))
          context.putImageData(image, 0, 0)
          url = canvas.toDataURL()
        }
      }
    } catch {
      url = null
    }
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!)
    cache.set(hash, url)
  }
  return url ?? undefined
}
