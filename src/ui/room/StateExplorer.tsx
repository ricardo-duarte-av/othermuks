// Room state explorer (/devtools): every state event gomuks has for the room, by type and state key.
import * as Dialog from '@radix-ui/react-dialog'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { EventType, RoomID } from '@/api/types'
import { loadRoomState, useChat } from '@/store/chat'
import { originalEvent } from '@/store/events'
import { closeStateExplorer, useUI } from '@/store/ui'
import { CopyJSONButton, DialogHeader, JSONBlock, useJSONWrap, WrapSwitch } from './MessageDialogs'

export function StateExplorer() {
  const target = useUI(s => s.stateExplorer)
  return (
    <Dialog.Root open={!!target} onOpenChange={next => !next && closeStateExplorer()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          // Start in the filter box rather than on the close button, so typing narrows the list right away.
          onOpenAutoFocus={e => {
            e.preventDefault()
            ;(e.currentTarget as HTMLElement | null)?.querySelector<HTMLInputElement>('input')?.focus()
          }}
          className="state-explorer fixed left-1/2 top-1/2 z-50 flex h-[min(720px,85vh)] w-[min(760px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-surface text-fg shadow-2xl outline-none"
        >
          {target && (
            <Explorer key={`${target.roomID}|${target.type}|${target.stateKey}`} roomID={target.roomID} initialType={target.type} initialKey={target.stateKey} />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Explorer({ roomID, initialType, initialKey }: { roomID: RoomID; initialType?: EventType; initialKey?: string }) {
  const roomName = useChat(s => s.rooms[roomID]?.meta.name)
  const state = useChat(s => s.rooms[roomID]?.state)
  const [type, setType] = useState<EventType | null>(initialType ?? null)
  const [stateKey, setStateKey] = useState<string | null>(initialType ? (initialKey ?? null) : null)
  const [filter, setFilter] = useState('')
  const [wrap, setWrap] = useJSONWrap()

  // The sync only carries some of the state; this fetches the rest (members included) once per room.
  useEffect(() => {
    void loadRoomState(roomID)
  }, [roomID])

  const rowid = type !== null && stateKey !== null ? state?.[type]?.[stateKey] : undefined
  const evt = useChat(s => (rowid === undefined ? undefined : s.events[rowid]))
  const source = useMemo(() => (evt ? originalEvent(evt) : undefined), [evt])

  const back = () => {
    setFilter('')
    if (stateKey !== null) setStateKey(null)
    else setType(null)
  }

  return (
    <>
      <DialogHeader
        title={roomName ? `Room state: ${roomName}` : 'Room state'}
        actions={
          source && (
            <>
              <WrapSwitch wrap={wrap} onChange={setWrap} />
              <CopyJSONButton value={source} />
            </>
          )
        }
      />
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs">
        {type !== null && (
          <button type="button" onClick={back} aria-label="Back" className="rounded-md p-1 text-muted hover:bg-hover hover:text-fg">
            <ChevronLeft size={15} />
          </button>
        )}
        <nav className="flex min-w-0 flex-1 items-center gap-1 truncate font-mono text-muted" aria-label="Location">
          <button type="button" onClick={() => (setType(null), setStateKey(null), setFilter(''))} className="hover:text-fg hover:underline">
            {roomID}
          </button>
          {type !== null && (
            <>
              <span>/</span>
              <button type="button" onClick={() => (setStateKey(null), setFilter(''))} className="truncate hover:text-fg hover:underline">
                {type}
              </button>
            </>
          )}
          {stateKey !== null && (
            <>
              <span>/</span>
              <span className="truncate text-fg">{stateKey === '' ? '""' : stateKey}</span>
            </>
          )}
        </nav>
        {stateKey === null && (
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder={type === null ? 'Filter types' : 'Filter state keys'}
            aria-label="Filter"
            className="w-44 rounded-md border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent/60"
          />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {type === null ? (
          <TypeList state={state} filter={filter} onPick={next => (setType(next), setFilter(''))} />
        ) : stateKey === null ? (
          <KeyList keys={state?.[type]} filter={filter} onPick={next => (setStateKey(next), setFilter(''))} />
        ) : source ? (
          <div className="p-2">
            <JSONBlock value={source} wrap={wrap} />
          </div>
        ) : (
          <p className="p-4 text-center text-sm text-muted">This state event isn't loaded.</p>
        )}
      </div>
    </>
  )
}

function Row({ label, detail, onClick }: { label: string; detail?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-xs hover:bg-hover"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail && <span className="shrink-0 text-muted">{detail}</span>}
      <ChevronRight size={13} className="shrink-0 text-muted" />
    </button>
  )
}

type StateMap = Record<EventType, Record<string, number>> | undefined

function TypeList({ state, filter, onPick }: { state: StateMap; filter: string; onPick: (type: EventType) => void }) {
  const types = useMemo(
    () =>
      Object.entries(state ?? {})
        .filter(([type, keys]) => Object.keys(keys).length && type.toLowerCase().includes(filter.toLowerCase()))
        .sort(([a], [b]) => a.localeCompare(b)),
    [state, filter],
  )
  if (!types.length) return <p className="p-4 text-center text-sm text-muted">{filter ? 'No matching event types' : 'Loading…'}</p>
  return types.map(([type, keys]) => {
    const count = Object.keys(keys).length
    return <Row key={type} label={type} detail={count === 1 ? '1 key' : `${count} keys`} onClick={() => onPick(type)} />
  })
}

function KeyList({ keys, filter, onPick }: { keys: Record<string, number> | undefined; filter: string; onPick: (key: string) => void }) {
  const events = useChat(useShallow(s => Object.values(keys ?? {}).map(rowid => s.events[rowid])))
  const sorted = useMemo(() => {
    const senders = new Map(events.filter(Boolean).map(evt => [evt.rowid, evt.sender]))
    return Object.entries(keys ?? {})
      .filter(([key]) => key.toLowerCase().includes(filter.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, rowid]) => ({ key, sender: senders.get(rowid) }))
  }, [keys, events, filter])
  if (!sorted.length) return <p className="p-4 text-center text-sm text-muted">No matching state keys</p>
  return sorted.map(({ key, sender }) => (
    <Row key={key} label={key === '' ? '""' : key} detail={sender && sender !== key ? `by ${sender}` : undefined} onClick={() => onPick(key)} />
  ))
}
