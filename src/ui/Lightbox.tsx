import * as Dialog from '@radix-ui/react-dialog'
import { Download, ExternalLink, RotateCcw, RotateCw, X } from 'lucide-react'
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { cn } from '@/lib/cn'
import { showToast, useUI, type LightboxImage } from '@/store/ui'
import { Spinner } from './primitives'

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

// Space the image may use: viewport minus the toolbar and padding.
const HORIZONTAL_MARGIN = 32
const VERTICAL_MARGIN = 112

/** Downloads through a blob, since <a download> is ignored for cross-origin (remote backend) URLs. */
async function saveImage(url: string, name?: string) {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const base = name?.trim() || 'image'
    const extension = EXTENSIONS[blob.type]
    const filename = extension && !/\.[a-z0-9]{2,5}$/i.test(base) ? `${base}.${extension}` : base
    const objectURL = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectURL
    link.download = filename
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(objectURL), 10_000)
  } catch (err) {
    showToast(`Couldn't save the image: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-white/90 transition hover:bg-white/20 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
    >
      {children}
    </button>
  )
}

/** Full-screen image viewer. Open it with openLightbox(url, name, { placeholder, width, height, from }). */
export function Lightbox() {
  const lightbox = useUI(s => s.lightbox)
  // The viewer animates back into the thumbnail before it goes, so the chrome around it fades with it.
  const [closing, setClosing] = useState(false)
  const view = useRef<{ close: () => void } | null>(null)

  useEffect(() => {
    if (lightbox) setClosing(false)
  }, [lightbox])

  return (
    <Dialog.Root
      open={!!lightbox}
      // Esc and outside clicks ask the view to close, so it can run the zoom out first.
      onOpenChange={open => {
        if (!open) view.current?.close()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'lightbox-overlay fixed inset-0 z-[60] animate-[lightbox-in_150ms_ease-out] bg-black/90 transition-opacity duration-300 ease-out',
            closing && 'opacity-0',
          )}
        />
        <Dialog.Content
          aria-describedby={undefined}
          className="lightbox fixed inset-0 z-[61] flex animate-[lightbox-in_150ms_ease-out] flex-col outline-none"
        >
          {lightbox && <LightboxView key={lightbox.url} ref={view} onClosing={() => setClosing(true)} {...lightbox} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Size of the image so the stand-in matches where the loaded image will appear. */
function fittedSize(width: number | undefined, height: number | undefined, sideways: boolean) {
  if (!width || !height) return undefined
  const maxWidth = sideways ? window.innerHeight - VERTICAL_MARGIN : window.innerWidth - HORIZONTAL_MARGIN
  const maxHeight = sideways ? window.innerWidth - HORIZONTAL_MARGIN : window.innerHeight - VERTICAL_MARGIN
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Transform that puts `box` exactly over `target`, for zooming between the thumbnail and the viewer. */
function transformOnto(box: DOMRect, target: { top: number; left: number; width: number; height: number }) {
  const scaleX = target.width / box.width
  const scaleY = target.height / box.height
  const dx = target.left + target.width / 2 - (box.left + box.width / 2)
  const dy = target.top + target.height / 2 - (box.top + box.height / 2)
  return `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`
}

const ZOOM_MS = 280

interface LightboxViewProps extends LightboxImage {
  ref: Ref<{ close: () => void }>
  onClosing: () => void
}

function LightboxView({ url, name, placeholder, width, height, from, ref, onClosing }: LightboxViewProps) {
  const [rotation, setRotation] = useState(0)
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const rotate = (delta: number) => setRotation(r => r + delta)
  const quarter = ((rotation % 360) + 360) % 360
  const sideways = quarter === 90 || quarter === 270
  // The thumbnail is the better stand-in; the blurhash is what's left when there isn't one.
  const preview = from?.url ?? placeholder
  // Kept mounted a moment past the load so it can fade under the original instead of blinking away.
  const [previewMounted, setPreviewMounted] = useState(true)
  const box = fittedSize(width, height, sideways)
  const stageRef = useRef<HTMLDivElement>(null)
  const closingRef = useRef(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (status !== 'loaded') return
    const timer = setTimeout(() => setPreviewMounted(false), 250)
    return () => clearTimeout(timer)
  }, [status])

  /**
   * Where the thumbnail is now. It may have scrolled away or been replaced since the viewer opened,
   * so the live element wins over the box remembered at open, and a thumbnail that has left the
   * screen isn't worth flying back to.
   */
  const thumbnailRect = () => {
    if (!from) return undefined
    const live = from.element?.isConnected ? from.element.getBoundingClientRect() : undefined
    const rect = live?.width ? live : from.rect
    const offscreen = rect.top > window.innerHeight || rect.left > window.innerWidth || rect.top + rect.height < 0 || rect.left + rect.width < 0
    return offscreen ? undefined : rect
  }

  const close = () => {
    const stage = stageRef.current
    const target = thumbnailRect()
    if (closingRef.current) return
    if (!stage || !target || !box || reducedMotion()) {
      useUI.setState({ lightbox: null })
      return
    }
    closingRef.current = true
    setClosing(true)
    onClosing()
    // Shrink back into the thumbnail, then let the dialog go.
    stage.style.transform = transformOnto(stage.getBoundingClientRect(), target)
    stage.style.opacity = status === 'loaded' ? '1' : '0.6'
    const closed = useUI.getState().lightbox
    setTimeout(() => {
      if (useUI.getState().lightbox === closed) useUI.setState({ lightbox: null })
    }, ZOOM_MS)
  }

  useImperativeHandle(ref, () => ({ close }))

  // Grow out of the thumbnail that was clicked: measure where the image lands, start the stage back at
  // the thumbnail's box, then let the transition carry it in. An image whose event carried no
  // dimensions has no box to land in, so it just appears.
  useLayoutEffect(() => {
    const stage = stageRef.current
    const target = thumbnailRect()
    if (!stage || !target || !box || reducedMotion()) return
    stage.style.transition = 'none'
    stage.style.transform = transformOnto(stage.getBoundingClientRect(), target)
    const frame = requestAnimationFrame(() => {
      stage.style.transition = ''
      stage.style.transform = ''
    })
    return () => cancelAnimationFrame(frame)
    // Only on open: rotating or loading later must not replay the zoom.
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'r') rotate(90)
      else if (e.key === 'R') rotate(-90)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const rotated = { transform: `rotate(${rotation}deg)` }

  return (
    <>
      <div
        className={cn(
          'lightbox-chrome flex shrink-0 items-center gap-2 px-4 py-3 transition-opacity duration-200 ease-out',
          closing && 'opacity-0',
        )}
      >
        <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-medium text-white/90">{name || 'Image'}</Dialog.Title>
        <ToolbarButton label="Rotate left (Shift+R)" onClick={() => rotate(-90)}>
          <RotateCcw size={18} />
        </ToolbarButton>
        <ToolbarButton label="Rotate right (R)" onClick={() => rotate(90)}>
          <RotateCw size={18} />
        </ToolbarButton>
        <ToolbarButton label="Save" onClick={() => void saveImage(url, name)}>
          <Download size={18} />
        </ToolbarButton>
        <ToolbarButton label="Open original in a new tab" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>
          <ExternalLink size={18} />
        </ToolbarButton>
        <ToolbarButton label="Close (Esc)" onClick={close}>
          <X size={20} />
        </ToolbarButton>
      </div>
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center p-4"
        onClick={e => {
          if (e.target === e.currentTarget) close()
        }}
      >
        {status === 'error' ? (
          <p className="text-sm text-white/80">Couldn't load this image.</p>
        ) : box ? (
          // One box for both the stand-in and the original, so a single transform zooms either of them.
          <div
            ref={stageRef}
            className="lightbox-stage absolute inset-0 m-auto transition-[transform,opacity] ease-out"
            style={{ ...box, transitionDuration: `${ZOOM_MS}ms` }}
          >
            {preview && previewMounted && (
              <img
                src={preview}
                alt=""
                aria-hidden
                className="absolute inset-0 size-full object-contain transition-[transform,opacity] duration-200 ease-out"
                style={{ ...rotated, opacity: status === 'loaded' ? 0 : 1 }}
              />
            )}
            <img
              src={url}
              alt={name ?? ''}
              draggable={false}
              onLoad={() => setStatus('loaded')}
              onError={() => setStatus('error')}
              className={cn(
                'absolute inset-0 size-full select-none object-contain shadow-2xl transition-[transform,opacity] duration-200 ease-out',
                status === 'loaded' ? 'opacity-100' : 'opacity-0',
              )}
              style={rotated}
            />
          </div>
        ) : (
          // No dimensions to lay out against: the original sizes itself once it arrives.
          <>
            {status === 'loading' && <Spinner size={28} className="absolute text-white/70" />}
            <img
              src={url}
              alt={name ?? ''}
              draggable={false}
              onLoad={() => setStatus('loaded')}
              onError={() => setStatus('error')}
              className={cn(
                'relative select-none object-contain shadow-2xl transition-[transform,opacity] duration-300 ease-out',
                status === 'loaded' ? 'opacity-100' : 'opacity-0',
              )}
              style={{
                ...rotated,
                // A sideways image swaps which viewport dimension limits it.
                maxWidth: sideways ? `calc(100vh - ${VERTICAL_MARGIN}px)` : `calc(100vw - ${HORIZONTAL_MARGIN}px)`,
                maxHeight: sideways ? `calc(100vw - ${HORIZONTAL_MARGIN}px)` : `calc(100vh - ${VERTICAL_MARGIN}px)`,
              }}
            />
          </>
        )}
      </div>
    </>
  )
}
