import * as Dialog from '@radix-ui/react-dialog'
import { Download, ExternalLink, RotateCcw, RotateCw, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { showToast, useUI } from '@/store/ui'
import { Spinner } from './primitives'

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

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

/** Full-screen image viewer. Open it with openLightbox(url, name). */
export function Lightbox() {
  const lightbox = useUI(s => s.lightbox)
  return (
    <Dialog.Root open={!!lightbox} onOpenChange={open => !open && useUI.setState({ lightbox: null })}>
      <Dialog.Portal>
        <Dialog.Overlay className="lightbox-overlay fixed inset-0 z-[60] animate-[lightbox-in_150ms_ease-out] bg-black/90" />
        <Dialog.Content
          aria-describedby={undefined}
          className="lightbox fixed inset-0 z-[61] flex animate-[lightbox-in_150ms_ease-out] flex-col outline-none"
        >
          {lightbox && <LightboxView key={lightbox.url} url={lightbox.url} name={lightbox.name} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function LightboxView({ url, name }: { url: string; name?: string }) {
  const [rotation, setRotation] = useState(0)
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const close = () => useUI.setState({ lightbox: null })
  const rotate = (delta: number) => setRotation(r => r + delta)
  const quarter = ((rotation % 360) + 360) % 360
  const sideways = quarter === 90 || quarter === 270

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'r') rotate(90)
      else if (e.key === 'R') rotate(-90)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 px-4 py-3">
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
        {status === 'loading' && <Spinner size={28} className="absolute text-white/70" />}
        {status === 'error' ? (
          <p className="text-sm text-white/80">Couldn't load this image.</p>
        ) : (
          <img
            src={url}
            alt={name ?? ''}
            draggable={false}
            onLoad={() => setStatus('loaded')}
            onError={() => setStatus('error')}
            className={cn(
              'select-none object-contain shadow-2xl transition-[transform,opacity] duration-200 ease-out',
              status === 'loaded' ? 'opacity-100' : 'opacity-0',
            )}
            style={{
              transform: `rotate(${rotation}deg)`,
              // A sideways image swaps which viewport dimension limits it.
              maxWidth: sideways ? 'calc(100vh - 7rem)' : 'calc(100vw - 2rem)',
              maxHeight: sideways ? 'calc(100vw - 2rem)' : 'calc(100vh - 7rem)',
            }}
          />
        )}
      </div>
    </>
  )
}
