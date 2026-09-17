// Message search, over gomuks' own index or the homeserver's, as gomuks web's search panel does.
import { Search, TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { client } from '@/api/client'
import type { EventRowID, LocalSearchParams, RoomID } from '@/api/types'
import { storeEvents, useChat } from '@/store/chat'
import { closeRoomTool } from '@/store/ui'
import { IconButton, Spinner } from '@/ui/primitives'
import { EventResult, FilterToggle, PanelMessage } from './EventResults'

const BATCH_SIZE = 50
const DEBOUNCE_MS = 400

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function SearchPanel({ roomID }: { roomID: RoomID }) {
  // The homeserver can't see into an encrypted room, so those start on gomuks' own index.
  const encrypted = useChat(s => !!s.rooms[roomID]?.meta.encryption_event)
  const [term, setTerm] = useState('')
  const [local, setLocal] = useState(encrypted)
  const [thisRoom, setThisRoom] = useState(true)
  const [sortByTime, setSortByTime] = useState(true)
  const [rowids, setRowids] = useState<EventRowID[]>([])
  const [nextBatch, setNextBatch] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // One in-flight search at a time: a new query or filter cancels the previous request.
  const request = useRef<AbortController | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const run = async (append: boolean, overrides: { term?: string; local?: boolean; thisRoom?: boolean; sortByTime?: boolean } = {}) => {
    const searchTerm = overrides.term ?? term
    const useLocal = overrides.local ?? local
    const scoped = overrides.thisRoom ?? thisRoom
    const byTime = overrides.sortByTime ?? sortByTime
    request.current?.abort()
    clearTimeout(debounce.current)
    if (!searchTerm.trim()) {
      setRowids([])
      setNextBatch(undefined)
      setError(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    const params: LocalSearchParams = {
      search_term: searchTerm,
      limit: BATCH_SIZE,
      room_ids: scoped ? [roomID] : undefined,
      sort_by_time: byTime,
      next_batch: append ? nextBatch : undefined,
    }
    try {
      const resp = useLocal ? await client.searchLocal(params, controller.signal) : await client.searchServer(params, controller.signal)
      if (controller.signal.aborted) return
      const events = resp.events ?? []
      storeEvents(events)
      // Results from rooms this account isn't in can't be rendered (no members, no room name).
      const known = useChat.getState().rooms
      const found = events.filter(evt => known[evt.room_id]).map(evt => evt.rowid)
      setRowids(prev => (append ? [...prev, ...found] : found))
      setNextBatch(resp.next_batch)
      setError(null)
    } catch (err) {
      if (controller.signal.aborted) return
      setError(errorText(err))
      if (!append) {
        setRowids([])
        setNextBatch(undefined)
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  const onTermChange = (value: string) => {
    setTerm(value)
    request.current?.abort()
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => void run(false, { term: value }), DEBOUNCE_MS)
  }

  useEffect(() => {
    return () => {
      request.current?.abort()
      clearTimeout(debounce.current)
    }
  }, [])

  const searched = term.trim().length > 0

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <h2 className="text-sm font-semibold">Search messages</h2>
        <IconButton label="Close" shortcut="Esc" className="ml-auto" onClick={closeRoomTool}>
          <X size={16} />
        </IconButton>
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-b border-border p-3">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            autoFocus
            value={term}
            onChange={e => onTermChange(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void run(false)}
            placeholder="Search for messages"
            className="w-full rounded-lg border border-border bg-[var(--timeline-bg)] py-1.5 pl-8 pr-3 text-sm outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterToggle
            checked={thisRoom}
            onChange={checked => {
              setThisRoom(checked)
              void run(false, { thisRoom: checked })
            }}
          >
            This room only
          </FilterToggle>
          <FilterToggle
            checked={sortByTime}
            onChange={checked => {
              setSortByTime(checked)
              void run(false, { sortByTime: checked })
            }}
          >
            Newest first
          </FilterToggle>
          <FilterToggle
            checked={local}
            disabled={encrypted}
            onChange={checked => {
              setLocal(checked)
              void run(false, { local: checked })
            }}
          >
            Search gomuks' index
          </FilterToggle>
        </div>
        {encrypted && <p className="text-xs text-muted">This room is encrypted: only gomuks' own index can search it.</p>}
      </div>

      <div className="search-results min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
        {error ? (
          <PanelMessage icon={<TriangleAlert size={24} />} title="Search failed" detail={error} />
        ) : !searched ? (
          <PanelMessage
            icon={<Search size={26} />}
            title="Search messages"
            detail={
              local
                ? "Searches gomuks' index of the messages it has, including encrypted rooms."
                : 'Searches the homeserver, which knows more history but cannot read encrypted rooms.'
            }
          />
        ) : rowids.length === 0 && !loading ? (
          <PanelMessage icon={<Search size={26} />} title="No messages found" detail="Try a different term, or widen the search to every room." />
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {rowids.map(rowid => (
                <EventResult key={rowid} rowid={rowid} showRoom={!thisRoom} />
              ))}
            </ul>
            {nextBatch && (
              <button
                type="button"
                disabled={loading}
                onClick={() => void run(true)}
                className="mt-2 w-full rounded-lg border border-border py-1.5 text-xs text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-60"
              >
                {loading ? 'Loading…' : 'Load more results'}
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
