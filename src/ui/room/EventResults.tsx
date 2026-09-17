// Shared pieces of the search and mentions panels: one found message, and the small filter pills
// above the results.
import { CornerDownRight } from 'lucide-react'
import type { ReactNode } from 'react'
import type { EventRowID } from '@/api/types'
import { cn } from '@/lib/cn'
import { formatFull } from '@/lib/format'
import { useChat } from '@/store/chat'
import { jumpToEventAnywhere } from '@/store/navigation'
import { TimelineRow } from '@/ui/timeline/TimelineRow'

/** A message found by search or mentions, rendered as it appears in the timeline. */
export function EventResult({ rowid, showRoom }: { rowid: EventRowID; showRoom: boolean }) {
  const evt = useChat(s => s.events[rowid])
  const roomName = useChat(s => (evt ? (s.rooms[evt.room_id]?.meta.name ?? evt.room_id) : null))
  if (!evt) return null

  return (
    <li className="result-item overflow-hidden rounded-xl border border-border bg-[var(--timeline-bg)]">
      <div className="flex items-center gap-1.5 border-b border-border/60 px-3 py-1 text-xs">
        {showRoom && <span className="min-w-0 truncate font-medium">{roomName}</span>}
        <time className="shrink-0 text-muted" dateTime={new Date(evt.timestamp).toISOString()}>
          {formatFull(evt.timestamp)}
        </time>
        <button
          type="button"
          onClick={() => jumpToEventAnywhere(evt.room_id, evt.event_id)}
          className="ml-auto flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <CornerDownRight size={12} /> Jump
        </button>
      </div>
      <div className="py-1.5">
        <TimelineRow roomID={evt.room_id} rowid={rowid} compact={false} newDay={false} />
      </div>
    </li>
  )
}

/** A compact on/off pill, for the handful of filters these panels expose. */
export function FilterToggle({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-50',
        checked ? 'border-accent bg-[var(--pill-bg)] text-[var(--pill-text)]' : 'border-border text-muted hover:bg-hover hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

/** Centred message for an empty, loading or failed panel. */
export function PanelMessage({ icon, title, detail }: { icon: ReactNode; title: string; detail?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <span className="mb-3 grid size-14 place-items-center rounded-2xl bg-surface-2 text-muted">{icon}</span>
      <p className="text-sm font-medium">{title}</p>
      {detail && <p className="mt-1 text-xs leading-relaxed text-muted">{detail}</p>}
    </div>
  )
}
