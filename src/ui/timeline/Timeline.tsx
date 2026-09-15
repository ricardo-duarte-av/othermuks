import { useVirtualizer } from '@tanstack/react-virtual'
import { LayoutGroup } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { EventRowID, RoomID, UserID } from '@/api/types'
import { isSameDay } from '@/lib/format'
import { latestReadEvent, loadOlder, markRoomRead, selectOwnUserID, useChat } from '@/store/chat'
import { isMessageLike, isRenderable, type TimelineEvent, type TimelineFilter } from '@/store/events'
import { usePreference, useTimelineFilter } from '@/store/preferences'
import { useUI } from '@/store/ui'
import { Spinner } from '@/ui/primitives'
import { ENTER_ANIMATION_WINDOW, TimelineRow } from './TimelineRow'

const GROUP_WINDOW = 5 * 60_000
const LOAD_THRESHOLD = 800
const BOTTOM_THRESHOLD = 48
const NO_ROWS: EventRowID[] = []
// Separators for the receipt layout signature; control characters can't appear in user IDs.
const ROW_SEPARATOR = '\u0001'
const USER_SEPARATOR = '\u0002'
const FIELD_SEPARATOR = '\u0003'

interface Item {
  rowid: EventRowID
  compact: boolean
  newDay: boolean
}

function useVisibleRowIDs(roomID: RoomID, filter: TimelineFilter) {
  return useChat(
    useShallow(s => {
      const room = s.rooms[roomID]
      if (!room) return NO_ROWS
      const rowids: EventRowID[] = []
      for (const tuple of room.timeline) {
        const evt = s.events[tuple.event_rowid]
        if (evt && isRenderable(evt, filter)) rowids.push(evt.rowid)
      }
      if (room.pending.length) {
        const seen = new Set(rowids)
        for (const rowid of room.pending) {
          const evt = s.events[rowid]
          if (evt && isRenderable(evt, filter) && !seen.has(rowid)) rowids.push(rowid)
        }
      }
      return rowids
    }),
  )
}

/**
 * When each row newly arrived at the bottom while the room was open, so it can animate in.
 * The first render of a room, history loaded above, and timeline resets never count as new.
 */
function useArrivals(items: Item[]): Map<EventRowID, number> {
  const known = useRef<Set<EventRowID> | null>(null)
  const arrivals = useRef(new Map<EventRowID, number>())
  return useMemo(() => {
    const now = Date.now()
    if (!known.current) {
      if (items.length) known.current = new Set(items.map(item => item.rowid))
      return arrivals.current
    }
    for (const [rowid, at] of arrivals.current) {
      if (now - at > ENTER_ANIMATION_WINDOW * 4) arrivals.current.delete(rowid)
    }
    const fresh: EventRowID[] = []
    let i = items.length - 1
    while (i >= 0 && !known.current.has(items[i].rowid)) fresh.push(items[i--].rowid)
    for (const item of items) known.current.add(item.rowid)
    // i < 0 means every row is unknown (e.g. the timeline was reset): don't animate a whole screen.
    if (i >= 0) for (const rowid of fresh) if (!arrivals.current.has(rowid)) arrivals.current.set(rowid, now)
    return new Map(arrivals.current)
  }, [items])
}

/**
 * Which users' read receipts sit under each visible row (other people only, oldest receipt first).
 * A receipt on a hidden event (reaction, edit, redaction…) shows on the nearest visible row before it.
 * Rows whose readers didn't change keep the same array, so only affected rows re-render.
 */
function useReceiptLayout(roomID: RoomID, filter: TimelineFilter, enabled: boolean): Map<EventRowID, UserID[]> {
  const signature = useChat(s => {
    const room = s.rooms[roomID]
    if (!room || !enabled) return ''
    const receipts = Object.values(room.receipts)
    if (!receipts.length) return ''
    const own = selectOwnUserID(s)

    const displayRow = new Map<EventRowID, EventRowID>()
    let lastVisible: EventRowID | undefined
    for (const tuple of room.timeline) {
      const evt = s.events[tuple.event_rowid]
      if (evt && isRenderable(evt, filter)) lastVisible = evt.rowid
      if (lastVisible !== undefined) displayRow.set(tuple.event_rowid, lastVisible)
    }

    const rows = new Map<EventRowID, { userID: UserID; timestamp: number }[]>()
    for (const receipt of receipts) {
      if (receipt.user_id === own) continue
      const row = displayRow.get(receipt.event_rowid)
      if (row === undefined) continue
      let readers = rows.get(row)
      if (!readers) rows.set(row, (readers = []))
      readers.push({ userID: receipt.user_id, timestamp: receipt.timestamp })
    }
    return [...rows]
      .map(([row, readers]) => `${row}${FIELD_SEPARATOR}${readers.sort((a, b) => a.timestamp - b.timestamp).map(r => r.userID).join(USER_SEPARATOR)}`)
      .join(ROW_SEPARATOR)
  })

  const previous = useRef(new Map<EventRowID, UserID[]>())
  return useMemo(() => {
    const next = new Map<EventRowID, UserID[]>()
    if (signature) {
      for (const part of signature.split(ROW_SEPARATOR)) {
        const [rowPart, usersPart] = part.split(FIELD_SEPARATOR)
        const row = Number(rowPart)
        const users = usersPart.split(USER_SEPARATOR)
        const old = previous.current.get(row)
        next.set(row, old && old.length === users.length && old.every((u, i) => u === users[i]) ? old : users)
      }
    }
    previous.current = next
    return next
  }, [signature])
}

/** Marks the room read at its newest event of any type (see latestReadEvent), if the window has focus. */
function markLatestRead(roomID: RoomID) {
  if (!document.hasFocus()) return
  const evt = latestReadEvent(roomID)
  if (evt) markRoomRead(roomID, evt)
}

export function Timeline({ roomID }: { roomID: RoomID }) {
  const filter = useTimelineFilter(roomID)
  const showReceipts = usePreference('display_read_receipts', roomID)
  const showDates = usePreference('show_date_separators', roomID)
  const rowids = useVisibleRowIDs(roomID, filter)
  const receiptLayout = useReceiptLayout(roomID, filter, showReceipts)
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
      const dayChange = !prev || !isSameDay(prev.timestamp, evt.timestamp)
      const compact =
        !!prev &&
        !dayChange &&
        isMessageLike(prev) &&
        isMessageLike(evt) &&
        prev.sender === evt.sender &&
        evt.timestamp - prev.timestamp < GROUP_WINDOW
      prev = evt
      return { rowid, compact, newDay: dayChange && showDates }
    })
  }, [rowids, showDates])
  const arrivals = useArrivals(items)

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
    if (atBottom.current && !wasAtBottom) markLatestRead(roomID)
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
    if (atBottom.current) markLatestRead(roomID)
    const onFocus = () => {
      if (atBottom.current) markLatestRead(roomID)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [roomID, rowids, timelineLength])

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
        {/* Receipt avatars share layout IDs per user, so they glide between rows as receipts move. */}
        <LayoutGroup id={`receipts:${roomID}`}>
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
                  <TimelineRow
                    roomID={roomID}
                    rowid={item.rowid}
                    compact={item.compact}
                    newDay={item.newDay}
                    readers={receiptLayout.get(item.rowid)}
                    arrivedAt={arrivals.get(item.rowid)}
                  />
                </div>
              )
            })}
          </div>
        </LayoutGroup>
      </div>
    </div>
  )
}
