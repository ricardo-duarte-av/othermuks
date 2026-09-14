import * as Tooltip from '@radix-ui/react-tooltip'
import { LoaderCircle } from 'lucide-react'
import { memo, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { avatarURL, userColorIndex } from '@/api/media'
import type { ContentURI } from '@/api/types'
import { cn } from '@/lib/cn'

interface AvatarProps {
  mxc?: ContentURI
  /** User or room ID; picks the fallback color. */
  id: string
  name?: string
  size?: number
  className?: string
}

export const Avatar = memo(function Avatar({ mxc, id, name, size = 36, className }: AvatarProps) {
  const url = avatarURL(mxc)
  const [failedURL, setFailedURL] = useState<string>()
  const style = { width: size, height: size }

  if (url && url !== failedURL) {
    return (
      <img
        src={url}
        alt=""
        draggable={false}
        loading="lazy"
        onError={() => setFailedURL(url)}
        className={cn('user-avatar bg-surface-2', className)}
        style={style}
      />
    )
  }
  const letter = Array.from((name || id).replace(/^[@#!+]/, ''))[0]?.toUpperCase() ?? '?'
  return (
    <div
      aria-hidden
      className={cn('user-avatar grid place-items-center font-semibold', className)}
      style={{
        ...style,
        fontSize: Math.round(size * 0.42),
        background: `var(--user-color-${userColorIndex(id)})`,
        color: 'var(--bg)',
      }}
    >
      {letter}
    </div>
  )
})

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  shortcut?: string
  children: ReactNode
}

export function IconButton({ label, shortcut, className, children, ...props }: IconButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'icon-button grid size-8 shrink-0 place-items-center rounded-md text-muted transition-colors',
            'hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40',
            'data-[active]:bg-surface-2 data-[active]:text-fg',
            className,
          )}
          {...props}
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className="tooltip z-50 flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-fg shadow-lg"
        >
          {label}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <LoaderCircle size={size} className={cn('animate-spin', className)} aria-hidden />
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-bg/60 px-1.5 py-px font-sans text-[10px] font-medium text-muted">
      {children}
    </kbd>
  )
}
