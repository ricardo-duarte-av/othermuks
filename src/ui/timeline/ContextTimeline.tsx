import { ArrowDown, History } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo, useRef } from 'react'
import type { RoomID } from '@/api/types'
import { isSameDay } from '@/lib/format'
import { useChat } from '@/store/chat'
import { isMessageLike, isRenderable, type TimelineEvent } from '@/store/events'
import { useIgnoredUsers } from '@/store/ignored'
import { closeEventContext, useEventContext } from '@/store/navigation'
import { usePreference, useTimelineFilter } from '@/store/preferences'
import { useUI } from '@/store/ui'
import { Spinner } from '@/ui/primitives'
import { TimelineRow } from './TimelineRow'

const GROUP_WINDOW = 5 * 60_000

/**
 * Messages around a linked or replied-to message that isn't in the loaded timeline, shown over the
 * room's timeline until "Jump to latest".
 */
export function ContextTimeline({ roomID }: { roomID: RoomID }) {
  const view = useEventContext(s => (s.view?.roomID === roomID ? s.view : null))
  const highlight = useUI(s => s.highlight)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowids = view?.rowids
  const status = view?.status
  const targetRowID = view?.targetRowID

  const filter = useTimelineFilter(roomID)
  const ignored = useIgnoredUsers()
  const showDates = usePreference('show_date_separators', roomID)

  const items = useMemo(() => {
    const { events } = useChat.getState()
    let prev: TimelineEvent | undefined
    return (rowids ?? []).flatMap(rowid => {
      const evt = events[rowid]
      // The linked message itself always shows, even if the filter (or ignoring its sender) would hide it.
      const hidden = !evt || !isRenderable(evt, filter) || (ignored.has(evt.sender) && isMessageLike(evt))
      if (!evt || (hidden && !(rowid === targetRowID && isRenderable(evt)))) return []
      const dayChange = !prev || !isSameDay(prev.timestamp, evt.timestamp)
      const compact =
        !!prev &&
        !dayChange &&
        isMessageLike(prev) &&
        isMessageLike(evt) &&
        prev.sender === evt.sender &&
        evt.timestamp - prev.timestamp < GROUP_WINDOW
      prev = evt
      return [{ rowid, compact, newDay: dayChange && showDates }]
    })
  }, [rowids, filter, ignored, showDates, targetRowID])

  // Center the linked message once loaded, and follow later jumps within this view.
  useEffect(() => {
    const rowid = highlight?.rowid ?? targetRowID
    if (status !== 'ready' || rowid === undefined) return
    const frame = requestAnimationFrame(() =>
      scrollRef.current
        ?.querySelector(`[data-rowid="${rowid}"]`)
        ?.scrollIntoView({ block: 'center', behavior: highlight ? 'smooth' : 'auto' }),
    )
    return () => cancelAnimationFrame(frame)
  }, [highlight, status, targetRowID])

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.18 }}
      className="event-context absolute inset-0 z-20 flex flex-col bg-[var(--timeline-bg)]"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-4 py-2 text-sm">
        <History size={15} className="shrink-0 text-muted" />
        <span className="min-w-0 truncate text-muted">Viewing older messages around a linked message</span>
        <button
          type="button"
          onClick={closeEventContext}
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1 text-xs font-medium text-accent-fg transition hover:brightness-110"
        >
          <ArrowDown size={13} /> Jump to latest
        </button>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-3">
        {status === 'loading' && (
          <div className="grid h-full place-items-center text-muted">
            <Spinner size={22} />
          </div>
        )}
        {status === 'error' && (
          <div className="grid h-full place-items-center p-6 text-center text-sm">
            <div>
              <p>Couldn't load that message.</p>
              <p className="mt-1 text-xs text-muted">{view?.error}</p>
            </div>
          </div>
        )}
        {status === 'ready' &&
          items.map(item => (
            <TimelineRow key={item.rowid} roomID={roomID} rowid={item.rowid} compact={item.compact} newDay={item.newDay} />
          ))}
      </div>
    </motion.div>
  )
}
