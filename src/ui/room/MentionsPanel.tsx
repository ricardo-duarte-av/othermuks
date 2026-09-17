// Recent messages that mention you, newest first, answered from gomuks' database (never the homeserver).
import { AtSign, TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { client } from '@/api/client'
import { UnreadType, type EventRowID, type RoomID } from '@/api/types'
import { storeEvents, useChat } from '@/store/chat'
import { closeRoomTool } from '@/store/ui'
import { IconButton, Spinner } from '@/ui/primitives'
import { EventResult, FilterToggle, PanelMessage } from './EventResults'

const BATCH_SIZE = 50

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function MentionsPanel({ roomID }: { roomID: RoomID }) {
  const [rowids, setRowids] = useState<EventRowID[]>([])
  const [oldest, setOldest] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [thisRoom, setThisRoom] = useState(false)
  const [highlightsOnly, setHighlightsOnly] = useState(true)
  const request = useRef<AbortController | null>(null)

  const load = useCallback(
    async (append: boolean, overrides: { thisRoom?: boolean; highlightsOnly?: boolean } = {}, olderThan?: number) => {
      const scoped = overrides.thisRoom ?? thisRoom
      const highlights = overrides.highlightsOnly ?? highlightsOnly
      request.current?.abort()
      const controller = new AbortController()
      request.current = controller
      setLoading(true)
      if (!append) {
        setRowids([])
        setOldest(null)
        setHasMore(true)
      }
      try {
        const events =
          (await client.getMentions(
            {
              // Ask for everything older than the last result we have, or start from now.
              max_timestamp: append && olderThan !== undefined ? olderThan - 1 : Date.now(),
              type: highlights ? UnreadType.Highlight : UnreadType.Highlight | UnreadType.Notify,
              limit: BATCH_SIZE,
              room_id: scoped ? roomID : undefined,
            },
            controller.signal,
          )) ?? []
        if (controller.signal.aborted) return
        storeEvents(events)
        const known = useChat.getState().rooms
        const found = events.filter(evt => known[evt.room_id])
        setRowids(prev => (append ? [...prev, ...found.map(evt => evt.rowid)] : found.map(evt => evt.rowid)))
        if (events.length) setOldest(events[events.length - 1].timestamp)
        setHasMore(events.length >= BATCH_SIZE)
        setError(null)
      } catch (err) {
        if (controller.signal.aborted) return
        setError(errorText(err))
        setHasMore(false)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    },
    [roomID, thisRoom, highlightsOnly],
  )

  // The panel is mounted per room, so this only ever runs once: changing a filter reloads explicitly,
  // and reloading here as well would load twice.
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void load(false)
  }, [load])

  // Cleanup belongs in its own effect: as part of the one above it would abort the request a filter
  // change had just started, since changing a filter rebuilds `load`.
  useEffect(() => () => request.current?.abort(), [])

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <h2 className="text-sm font-semibold">Mentions</h2>
        <IconButton label="Close" shortcut="Esc" className="ml-auto" onClick={closeRoomTool}>
          <X size={16} />
        </IconButton>
      </div>

      <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-border p-3">
        <FilterToggle
          checked={thisRoom}
          onChange={checked => {
            setThisRoom(checked)
            void load(false, { thisRoom: checked })
          }}
        >
          This room only
        </FilterToggle>
        <FilterToggle
          checked={highlightsOnly}
          onChange={checked => {
            setHighlightsOnly(checked)
            void load(false, { highlightsOnly: checked })
          }}
        >
          Mentions only
        </FilterToggle>
      </div>

      <div className="mentions-list min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
        {error ? (
          <PanelMessage icon={<TriangleAlert size={24} />} title="Couldn't load mentions" detail={error} />
        ) : rowids.length === 0 && !loading ? (
          <PanelMessage
            icon={<AtSign size={26} />}
            title="No mentions"
            detail={
              highlightsOnly
                ? 'Messages that mention you by name appear here. Turn off "Mentions only" to see every notification.'
                : 'Notifications from the rooms you follow appear here.'
            }
          />
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {rowids.map(rowid => (
                <EventResult key={rowid} rowid={rowid} showRoom={!thisRoom} />
              ))}
            </ul>
            {hasMore && (
              <button
                type="button"
                disabled={loading}
                onClick={() => void load(true, {}, oldest ?? undefined)}
                className="mt-2 w-full rounded-lg border border-border py-1.5 text-xs text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-60"
              >
                {loading ? 'Loading…' : 'Load more'}
              </button>
            )}
          </>
        )}
        {loading && rowids.length === 0 && (
          <div className="flex justify-center py-6">
            <Spinner size={18} />
          </div>
        )}
      </div>
    </>
  )
}
