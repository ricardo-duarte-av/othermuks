import { X } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { EventID, EventRowID, RoomID } from '@/api/types'
import { isSameDay } from '@/lib/format'
import { fetchEvent, loadThreadPage, useChat } from '@/store/chat'
import { isMessageLike, type TimelineEvent } from '@/store/events'
import { useUI } from '@/store/ui'
import { IconButton, Spinner } from '@/ui/primitives'
import { TimelineRow } from '@/ui/timeline/TimelineRow'
import { Composer } from './Composer'

export const THREAD_PANEL_WIDTH = 420
const GROUP_WINDOW = 5 * 60_000
const BOTTOM_THRESHOLD = 48
const NO_ROWS: EventRowID[] = []

function useThreadReplies(rootID: EventID) {
  return useChat(
    useShallow(s => {
      const replies = s.threads[rootID]
      if (!replies) return NO_ROWS
      return replies.toSorted((a, b) => (s.events[a]?.timestamp ?? 0) - (s.events[b]?.timestamp ?? 0))
    }),
  )
}

export function ThreadPanel({ roomID, rootID }: { roomID: RoomID; rootID: EventID }) {
  const rootRowID = useChat(s => s.eventIDs[rootID])
  const replies = useThreadReplies(rootID)
  const [nextBatch, setNextBatch] = useState<string>()
  const [loading, setLoading] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const restoreFromBottom = useRef<number | null>(null)

  useEffect(() => {
    if (rootRowID === undefined) void fetchEvent(roomID, rootID)
  }, [roomID, rootID, rootRowID])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadThreadPage(roomID, rootID)
      .then(next => !cancelled && setNextBatch(next))
      .catch(err => console.error('Failed to load thread', err))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [roomID, rootID])

  const items = useMemo(() => {
    const { events } = useChat.getState()
    let prev: TimelineEvent | undefined
    return replies.map(rowid => {
      const evt = events[rowid]
      const newDay = !!prev && !!evt && !isSameDay(prev.timestamp, evt.timestamp)
      const compact =
        !!prev && !!evt && !newDay && isMessageLike(prev) && prev.sender === evt.sender && evt.timestamp - prev.timestamp < GROUP_WINDOW
      prev = evt
      return { rowid, compact, newDay }
    })
  }, [replies])

  // Stick to the newest reply, or keep position after loading older ones.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (restoreFromBottom.current !== null) {
      el.scrollTop = el.scrollHeight - restoreFromBottom.current
      restoreFromBottom.current = null
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [items, rootRowID])

  async function loadOlderReplies() {
    const el = scrollRef.current
    if (!nextBatch || loading || !el) return
    setLoading(true)
    restoreFromBottom.current = el.scrollHeight - el.scrollTop
    try {
      setNextBatch(await loadThreadPage(roomID, rootID, nextBatch))
    } catch (err) {
      console.error('Failed to load older thread replies', err)
      restoreFromBottom.current = null
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.aside
      initial={{ x: THREAD_PANEL_WIDTH }}
      animate={{ x: 0 }}
      exit={{ x: THREAD_PANEL_WIDTH }}
      transition={{ type: 'spring', stiffness: 520, damping: 46, mass: 0.8 }}
      className="thread-panel absolute inset-y-0 right-0 z-20 flex flex-col border-l border-border bg-[var(--drawer-bg)]"
      style={{ width: THREAD_PANEL_WIDTH }}
      aria-label="Thread"
    >
      <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
        <h2 className="text-sm font-semibold">Thread</h2>
        <IconButton label="Close thread" shortcut="Esc" className="ml-auto" onClick={() => useUI.setState({ threadRoot: null })}>
          <X size={16} />
        </IconButton>
      </div>
      <div
        ref={scrollRef}
        onScroll={e => {
          const el = e.currentTarget
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD
        }}
        className="thread-timeline min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-2 pt-4"
      >
        {rootRowID !== undefined ? (
          <TimelineRow roomID={roomID} rowid={rootRowID} compact={false} newDay={false} threadRoot={rootID} />
        ) : (
          <div className="grid h-20 place-items-center text-muted">
            <Spinner />
          </div>
        )}
        <div className="thread-divider flex items-center gap-3 px-4 py-3 text-xs text-muted">
          <span className="h-px flex-1 bg-border" />
          {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
          <span className="h-px flex-1 bg-border" />
        </div>
        {nextBatch && (
          <button
            type="button"
            onClick={() => void loadOlderReplies()}
            disabled={loading}
            className="mx-auto mb-2 flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted transition-colors hover:text-fg disabled:opacity-60"
          >
            {loading && <Spinner size={12} />}
            Load older replies
          </button>
        )}
        {loading && !nextBatch && replies.length === 0 && (
          <div className="flex justify-center py-4 text-muted">
            <Spinner />
          </div>
        )}
        {items.map(item => (
          <TimelineRow
            key={item.rowid}
            roomID={roomID}
            rowid={item.rowid}
            compact={item.compact}
            newDay={item.newDay}
            threadRoot={rootID}
          />
        ))}
      </div>
      <Composer roomID={roomID} threadRoot={rootID} />
    </motion.aside>
  )
}
