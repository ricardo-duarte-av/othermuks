import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { EventRowID, RoomID } from '@/api/types'
import { isSameDay } from '@/lib/format'
import { loadOlder, markRoomRead, useChat } from '@/store/chat'
import { isMessageLike, isPendingEvent, isRenderable, type TimelineEvent } from '@/store/events'
import { useUI } from '@/store/ui'
import { Spinner } from '@/ui/primitives'
import { TimelineRow } from './TimelineRow'

const GROUP_WINDOW = 5 * 60_000
const LOAD_THRESHOLD = 800
const BOTTOM_THRESHOLD = 48
const NO_ROWS: EventRowID[] = []

interface Item {
  rowid: EventRowID
  compact: boolean
  newDay: boolean
}

function useVisibleRowIDs(roomID: RoomID) {
  return useChat(
    useShallow(s => {
      const room = s.rooms[roomID]
      if (!room) return NO_ROWS
      const rowids: EventRowID[] = []
      for (const tuple of room.timeline) {
        const evt = s.events[tuple.event_rowid]
        if (evt && isRenderable(evt)) rowids.push(evt.rowid)
      }
      if (room.pending.length) {
        const seen = new Set(rowids)
        for (const rowid of room.pending) {
          const evt = s.events[rowid]
          if (evt && isRenderable(evt) && !seen.has(rowid)) rowids.push(rowid)
        }
      }
      return rowids
    }),
  )
}

function markLatestRead(roomID: RoomID, rowids: EventRowID[]) {
  if (!document.hasFocus()) return
  const { events } = useChat.getState()
  for (let i = rowids.length - 1; i >= 0; i--) {
    const evt = events[rowids[i]]
    if (evt && !isPendingEvent(evt)) {
      markRoomRead(roomID, evt)
      return
    }
  }
}

export function Timeline({ roomID }: { roomID: RoomID }) {
  const rowids = useVisibleRowIDs(roomID)
  const timelineLength = useChat(s => s.rooms[roomID]?.timeline.length ?? 0)
  const hasMore = useChat(s => s.rooms[roomID]?.hasMore ?? false)
  const paginating = useChat(s => s.rooms[roomID]?.paginating ?? false)
  const highlight = useUI(s => s.highlight)

  // sender/timestamp/type-class never change for an event, so grouping only depends on the row list.
  const items = useMemo<Item[]>(() => {
    const { events } = useChat.getState()
    let prev: TimelineEvent | undefined
    return rowids.map(rowid => {
      const evt = events[rowid]
      const newDay = !prev || !isSameDay(prev.timestamp, evt.timestamp)
      const compact =
        !!prev &&
        !newDay &&
        isMessageLike(prev) &&
        isMessageLike(evt) &&
        prev.sender === evt.sender &&
        evt.timestamp - prev.timestamp < GROUP_WINDOW
      prev = evt
      return { rowid, compact, newDay }
    })
  }, [rowids])

  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const anchor = useRef<{ rowid: EventRowID; offset: number } | null>(null)
  const firstRowID = useRef<EventRowID | undefined>(undefined)

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: index => (items[index].compact ? 28 : 64) + (items[index].newDay ? 44 : 0),
    getItemKey: index => items[index].rowid,
    overscan: 12,
    paddingStart: 12,
    paddingEnd: 8,
    useFlushSync: false,
  })
  const totalSize = virtualizer.getTotalSize()

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const wasAtBottom = atBottom.current
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD
    const first = virtualizer.getVirtualItems().find(item => item.end > el.scrollTop)
    anchor.current = first ? { rowid: first.key as EventRowID, offset: first.start - el.scrollTop } : null
    if (el.scrollTop < LOAD_THRESHOLD) void loadOlder(roomID)
    if (atBottom.current && !wasAtBottom) markLatestRead(roomID, rowids)
  }

  // Stay pinned to the newest message, or keep the same message in place when history is prepended.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !items.length) return
    const prevFirst = firstRowID.current
    firstRowID.current = items[0].rowid
    if (atBottom.current) {
      el.scrollTop = el.scrollHeight
    } else if (prevFirst !== undefined && prevFirst !== items[0].rowid && anchor.current) {
      const { rowid, offset } = anchor.current
      const index = items.findIndex(item => item.rowid === rowid)
      const measurement = index >= 0 ? virtualizer.measurementsCache[index] : undefined
      if (measurement) el.scrollTop = measurement.start - offset
    }
  }, [items, totalSize, virtualizer])

  // Jump to a message (e.g. from a reply preview); the row highlights itself.
  useEffect(() => {
    if (!highlight) return
    const index = items.findIndex(item => item.rowid === highlight.rowid)
    if (index < 0) return
    atBottom.current = false
    virtualizer.scrollToIndex(index, { align: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight])

  useEffect(() => {
    if (atBottom.current) markLatestRead(roomID, rowids)
    const onFocus = () => {
      if (atBottom.current) markLatestRead(roomID, rowids)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [roomID, rowids])

  // Backfill until the viewport is filled or history runs out.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || paginating || !hasMore) return
    if (el.scrollTop < LOAD_THRESHOLD) void loadOlder(roomID)
  }, [roomID, timelineLength, hasMore, paginating])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {paginating && (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
          <span className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted shadow">
            <Spinner size={12} /> Loading history
          </span>
        </div>
      )}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        className="timeline flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden [overflow-anchor:none]"
      >
        <div className="relative mt-auto w-full shrink-0" style={{ height: totalSize }}>
          {virtualizer.getVirtualItems().map(virtualItem => {
            const item = items[virtualItem.index]
            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                <TimelineRow roomID={roomID} rowid={item.rowid} compact={item.compact} newDay={item.newDay} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
