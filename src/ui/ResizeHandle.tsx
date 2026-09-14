import type { KeyboardEvent, PointerEvent } from 'react'
import { cn } from '@/lib/cn'

const KEY_STEP = 16

interface ResizeHandleProps {
  /** Which edge of the resizable element the handle sits on. */
  edge: 'left' | 'right'
  getWidth: () => number
  onResize: (width: number) => void
  defaultWidth: number
  label: string
}

/** Drag, arrow keys, or double-click to reset. The parent must be position: relative. */
export function ResizeHandle({ edge, getWidth, onResize, defaultWidth, label }: ResizeHandleProps) {
  // Dragging towards the handle's edge grows the element.
  const direction = edge === 'right' ? 1 : -1

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    const startX = e.clientX
    const startWidth = getWidth()
    handle.setPointerCapture(e.pointerId)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: globalThis.PointerEvent) => onResize(startWidth + (ev.clientX - startX) * direction)
    const onEnd = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onEnd)
      handle.removeEventListener('pointercancel', onEnd)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onEnd)
    handle.addEventListener('pointercancel', onEnd)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const towardsEdge = (e.key === 'ArrowRight') === (edge === 'right')
    onResize(getWidth() + (towardsEdge ? KEY_STEP : -KEY_STEP))
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`${label} (double-click to reset)`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onResize(defaultWidth)}
      className={cn(
        'resize-handle group absolute inset-y-0 z-30 w-3 cursor-col-resize touch-none outline-none',
        edge === 'right' ? '-right-1.5' : '-left-1.5',
      )}
    >
      <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-accent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100" />
    </div>
  )
}
