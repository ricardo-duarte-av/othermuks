// Client-side thumbnails for images and video. gomuks uploads the file as it was given, so unless
// the sender's client attaches a thumbnail nobody gets one: every receiver pays for the full image
// to show a 300px-wide bubble, and a video shows an empty player. Rendering one here costs a single
// decode on the sender's machine and is what the timeline already looks for (mediaSources) — as a
// video's poster, and as the still frame a paused GIF shows.
import { encode as encodeBlurhash } from 'blurhash'
import { log } from './log'

/** Matrix's conventional thumbnail box; also roughly a retina-sized timeline bubble. */
const MAX_WIDTH = 800
const MAX_HEIGHT = 600
const QUALITY = 0.8
/** A thumbnail that saves almost nothing is just a second file to fetch. */
const WORTH_IT = 0.9
/** Blurhash works on a handful of pixels, and components stay within its 1..9 range. */
const HASH_SIZE = 32
const HASH_COMPONENTS_X = 4
const HASH_COMPONENTS_Y = 3
/**
 * Far enough in to clear the title card or fade-in that opens most clips, early enough to still be
 * the scene the video is "about".
 */
const FRAME_POSITION = 0.25
/** A video that won't load metadata or seek shouldn't hold up the send. */
const VIDEO_TIMEOUT = 10_000

export interface GeneratedThumbnail {
  file: File
  width: number
  height: number
}

export interface MediaDescription {
  width: number
  height: number
  /** Milliseconds, as m.video's info wants it. Only set for video. */
  duration?: number
  blurhash?: string
  thumbnail?: GeneratedThumbnail
}

/** One decoded still, from either an image file or a seeked video element. */
interface Frame {
  source: CanvasImageSource
  width: number
  height: number
}

/**
 * SVG has no intrinsic pixel size worth thumbnailing, and the decoders behind createImageBitmap
 * vary by browser (HEIC usually fails) — an unsupported type just means no thumbnail.
 */
const isImage = (type: string) => type.startsWith('image/') && type !== 'image/svg+xml'

const isVideo = (type: string) => type.startsWith('video/')

const fits = (width: number, height: number) => width <= MAX_WIDTH && height <= MAX_HEIGHT

function scaled(width: number, height: number, maxWidth: number, maxHeight: number) {
  const ratio = Math.min(maxWidth / width, maxHeight / height, 1)
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) }
}

/** `readback` marks the canvas we call getImageData on, so only that one gives up GPU backing. */
function draw(frame: Frame, width: number, height: number, readback = false): CanvasRenderingContext2D | null {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: readback })
  if (!context) return null
  context.drawImage(frame.source, 0, 0, width, height)
  return context
}

const toBlob = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, QUALITY))

/**
 * JPEG would flatten a transparent PNG or sticker onto black. WebP keeps the alpha and is smaller;
 * a browser that can't encode it hands back a PNG instead, which is still worth sending.
 */
const encodeAs = (type: string) => (type === 'image/jpeg' ? 'image/jpeg' : 'image/webp')

function hash(frame: Frame): string | undefined {
  const { width, height } = scaled(frame.width, frame.height, HASH_SIZE, HASH_SIZE)
  const context = draw(frame, width, height, true)
  if (!context) return undefined
  const { data } = context.getImageData(0, 0, width, height)
  return encodeBlurhash(data, width, height, HASH_COMPONENTS_X, HASH_COMPONENTS_Y)
}

/**
 * Describes one decoded frame. `force` is for video: an image that already fits the thumbnail box
 * is its own thumbnail, but a video needs a still at any size — there's nothing else to show.
 */
async function describeFrame(frame: Frame, file: File, force: boolean): Promise<MediaDescription> {
  const description: MediaDescription = { width: frame.width, height: frame.height, blurhash: hash(frame) }
  if (!force && fits(frame.width, frame.height)) return description
  const { width, height } = scaled(frame.width, frame.height, MAX_WIDTH, MAX_HEIGHT)
  const context = draw(frame, width, height)
  const blob = context && (await toBlob(context.canvas, encodeAs(file.type)))
  if (!blob) return description
  if (!force && blob.size >= file.size * WORTH_IT) {
    log.debug(`skipping thumbnail for ${file.name}: ${blob.size} of ${file.size} bytes`)
    return description
  }
  const name = `thumbnail-${file.name.replace(/\.[^./\\]+$/, '')}.${blob.type.split('/')[1] ?? 'webp'}`
  description.thumbnail = { file: new File([blob], name, { type: blob.type }), width, height }
  return description
}

async function describeImage(file: File): Promise<MediaDescription | null> {
  let bitmap: ImageBitmap
  try {
    // An animated GIF decodes to its first frame, which is exactly the still the timeline wants.
    bitmap = await createImageBitmap(file)
  } catch (err) {
    log.debug(`no thumbnail for ${file.name}: ${err}`)
    return null
  }
  try {
    return await describeFrame({ source: bitmap, width: bitmap.width, height: bitmap.height }, file, false)
  } finally {
    bitmap.close()
  }
}

/** Resolves on the first of `events`, rejects on 'error' or when the video stalls. */
function videoEvent(video: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (err?: unknown) => {
      clearTimeout(timer)
      video.removeEventListener(event, ok)
      video.removeEventListener('error', fail)
      if (err) reject(err)
      else resolve()
    }
    const ok = () => done()
    const fail = () => done(video.error?.message ?? 'decode failed')
    const timer = setTimeout(() => done(`timed out waiting for ${event}`), VIDEO_TIMEOUT)
    video.addEventListener(event, ok, { once: true })
    video.addEventListener('error', fail, { once: true })
  })
}

async function describeVideo(file: File): Promise<MediaDescription | null> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url
  try {
    await videoEvent(video, 'loadedmetadata')
    if (!video.videoWidth || !video.videoHeight) return null
    // A stream with no known duration (some WebM) can't be seeked by fraction; its first frame will do.
    const seekable = Number.isFinite(video.duration) && video.duration > 0
    if (seekable) {
      video.currentTime = video.duration * FRAME_POSITION
      await videoEvent(video, 'seeked')
    }
    const frame = { source: video, width: video.videoWidth, height: video.videoHeight }
    const description = await describeFrame(frame, file, true)
    if (seekable) description.duration = Math.round(video.duration * 1000)
    return description
  } catch (err) {
    log.warn(`no thumbnail for ${file.name}: ${err}`)
    return null
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

/**
 * Reads a file's real dimensions and renders a thumbnail for it: images bigger than the thumbnail
 * box, and every video, at a frame a quarter of the way in. Returns null for anything else — and
 * never throws, since a missing thumbnail is only a missed optimisation and the file still sends.
 */
export async function describeMedia(file: File): Promise<MediaDescription | null> {
  try {
    if (isImage(file.type)) return await describeImage(file)
    if (isVideo(file.type)) return await describeVideo(file)
    return null
  } catch (err) {
    log.warn(`thumbnailing ${file.name} failed: ${err}`)
    return null
  }
}
