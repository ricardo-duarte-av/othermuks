import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown } from 'lucide-react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { EventRowID, RoomID, UserID } from '@/api/types'
import { isSameDay } from '@/lib/format'
import { latestReadEvent, loadOlder, markRoomRead, selectOwnUserID, useChat } from '@/store/chat'
import { hasNoRenderer, isMessageLike, isRenderable, type TimelineEvent, type TimelineFilter } from '@/store/events'
import { useIgnoredUsers } from '@/store/ignored'
import { useEventContext } from '@/store/navigation'
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

/** Renderable, and not a message from someone the user ignores (their state events stay visible). */
const isShown = (evt: TimelineEvent, filter: TimelineFilter, ignored: ReadonlySet<UserID>) =>
  isRenderable(evt, filter) && !(ignored.has(evt.sender) && isMessageLike(evt))

/** Only real messages group under one avatar: an edit shown as a hidden event breaks the run. */
const groupable = (evt: TimelineEvent) => isMessageLike(evt) && !hasNoRenderer(evt)

function useVisibleRowIDs(roomID: RoomID, filter: TimelineFilter, ignored: ReadonlySet<UserID>) {
  return useChat(
    useShallow(s => {
      const room = s.rooms[roomID]
      if (!room) return NO_ROWS
      const rowids: EventRowID[] = []
      for (const tuple of room.timeline) {
        const evt = s.events[tuple.event_rowid]
        if (evt && isShown(evt, filter, ignored)) rowids.push(evt.rowid)
      }
      if (room.pending.length) {
        const seen = new Set(rowids)
        for (const rowid of room.pending) {
          const evt = s.events[rowid]
          if (evt && isShown(evt, filter, ignored) && !seen.has(rowid)) rowids.push(rowid)
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
    // In a background tab animation frames are paused and nobody sees the arrival, so don't animate those either.
    if (i >= 0 && !document.hidden) for (const rowid of fresh) if (!arrivals.current.has(rowid)) arrivals.current.set(rowid, now)
    return new Map(arrivals.current)
  }, [items])
}

/**
 * Which users' read receipts sit under each visible row (other people only, oldest receipt first).
 * A receipt on a hidden event (reaction, edit, redaction…) shows on the nearest visible row before it.
 * Rows whose readers didn't change keep the same array, so only affected rows re-render.
 */
function useReceiptLayout(roomID: RoomID, filter: TimelineFilter, ignored: ReadonlySet<UserID>, enabled: boolean): Map<EventRowID, UserID[]> {
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
      if (evt && isShown(evt, filter, ignored)) lastVisible = evt.rowid
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
  const ignored = useIgnoredUsers()
  const rowids = useVisibleRowIDs(roomID, filter, ignored)
  const receiptLayout = useReceiptLayout(roomID, filter, ignored, showReceipts)
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
        groupable(prev) &&
        groupable(evt) &&
        prev.sender === evt.sender &&
        evt.timestamp - prev.timestamp < GROUP_WINDOW
      prev = evt
      return { rowid, compact, newDay: dayChange && showDates }
    })
  }, [rowids, showDates])
  const arrivals = useArrivals(items)

  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  /** Mirrors !atBottom for rendering the jump-to-latest button (the ref alone doesn't re-render). */
  const [detached, setDetached] = useState(false)
  /** A "Jump to latest" smooth scroll is in progress. */
  const jumping = useRef(false)
  const anchor = useRef<{ rowid: EventRowID; offset: number } | null>(null)
  const firstRowID = useRef<EventRowID | undefined>(undefined)
  /**
   * The last scrollTop this component set itself. Rows are measured after they render, and the first
   * screenful of a room is estimated at 64px a row when a message with an image is several times that,
   * so the content can grow by thousands of pixels between pinning to the bottom and the scroll event
   * that pin triggers. Reading that event as the user scrolling away detached the timeline from the
   * bottom for good: it stayed parked in old history while new messages piled up below.
   */
  const programmatic = useRef<number | null>(null)
  /** Last observed scroll position, to tell which way the view moved. */
  const lastTop = useRef(0)

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
    if (programmatic.current !== null && Math.abs(el.scrollTop - programmatic.current) < 1) {
      programmatic.current = null
      return
    }
    const wasAtBottom = atBottom.current
    const reachedBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD
    // Only moving up detaches the timeline. Rows are measured after they render, so the content can
    // grow by thousands of pixels under a view that is already at the bottom; measured by distance
    // alone that looks exactly like scrolling away, and the timeline would stop following the room.
    const movedUp = el.scrollTop < lastTop.current - 1
    lastTop.current = el.scrollTop
    if (jumping.current) {
      // Mid smooth-scroll from "Jump to latest": stay attached until the bottom is reached.
      if (reachedBottom) {
        jumping.current = false
        markLatestRead(roomID)
      }
      return
    }
    atBottom.current = reachedBottom || (atBottom.current && !movedUp)
    setDetached(!atBottom.current)
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
      // Read back: the browser clamps to the maximum, and that's the value the scroll event reports.
      programmatic.current = el.scrollTop
      lastTop.current = el.scrollTop
    } else if (prevFirst !== undefined && prevFirst !== items[0].rowid && anchor.current) {
      const { rowid, offset } = anchor.current
      const index = items.findIndex(item => item.rowid === rowid)
      const measurement = index >= 0 ? virtualizer.measurementsCache[index] : undefined
      if (measurement) {
        el.scrollTop = measurement.start - offset
        programmatic.current = el.scrollTop
        lastTop.current = el.scrollTop
      }
    }
  }, [items, totalSize, virtualizer])

  // Jump to a message (e.g. from a reply preview); the row highlights itself.
  useEffect(() => {
    if (!highlight) return
    // A context view open for this room is already showing (and highlighting) the message. Leave the
    // room timeline underneath pinned to the latest messages instead of scrolling it as well.
    if (useEventContext.getState().view?.roomID === roomID) return
    const index = items.findIndex(item => item.rowid === highlight.rowid)
    if (index < 0) return
    atBottom.current = false
    setDetached(true)
    virtualizer.scrollToIndex(index, { align: 'center' })
    // On a short list scrollToIndex may not move anything, so no scroll event records an anchor. Record
    // it here, or history prepended afterwards would leave the view at the top and keep paginating.
    const rowid = highlight.rowid
    const frame = requestAnimationFrame(() => {
      const el = scrollRef.current
      const measurement = virtualizer.measurementsCache[index]
      if (el && measurement) anchor.current = { rowid, offset: measurement.start - el.scrollTop }
    })
    return () => cancelAnimationFrame(frame)
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

  const jumpToLatest = () => {
    const el = scrollRef.current
    if (!el) return
    // Re-attach right away so messages arriving during the smooth scroll keep it pinned to the bottom.
    atBottom.current = true
    jumping.current = true
    anchor.current = null
    setDetached(false)
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  /** The user taking over the scroll ends a jump in progress. */
  const cancelJump = () => {
    jumping.current = false
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <AnimatePresence>
        {detached && items.length > 0 && (
          <motion.button
            key="jump-to-latest"
            type="button"
            onClick={jumpToLatest}
            initial={{ opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
            aria-label="Jump to latest message"
            title="Jump to latest message"
            className="jump-to-latest absolute bottom-3 right-4 z-20 flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-fg shadow-lg outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ArrowDown size={14} className="text-accent" />
            Jump to latest
          </motion.button>
        )}
      </AnimatePresence>
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
        onWheel={cancelJump}
        onTouchStart={cancelJump}
        onKeyDown={cancelJump}
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
