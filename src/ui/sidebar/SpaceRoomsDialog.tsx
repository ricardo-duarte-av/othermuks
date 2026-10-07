import * as Dialog from '@radix-ui/react-dialog'
import { Minus, Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { RoomID } from '@/api/types'
import { loadRoomState, useChat } from '@/store/chat'
import { addSpaceChild, canEditSpaceChildren, removeSpaceChild, spaceChildIDs } from '@/store/spaceChildren'
import { showToast } from '@/store/ui'
import { Avatar, Spinner } from '@/ui/primitives'

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * Adds joined rooms to a space or takes them out. Each change is its own m.space.child state event,
 * sent as soon as it's clicked; gomuks's next sync moves the room between the two lists.
 */
export function SpaceRoomsDialog({ spaceID, open, onOpenChange }: { spaceID: RoomID; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="space-rooms-dialog fixed left-1/2 top-1/2 z-50 flex h-[min(720px,90vh)] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-surface text-fg shadow-2xl outline-none"
        >
          {open && <SpaceRoomsBody spaceID={spaceID} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function SpaceRoomsBody({ spaceID }: { spaceID: RoomID }) {
  const spaceName = useChat(s => s.rooms[spaceID]?.meta.name ?? spaceID)
  const children = useChat(useShallow(s => spaceChildIDs(s, spaceID)))
  const canEdit = useChat(s => canEditSpaceChildren(s, spaceID))
  // Joined rooms that could go in: not DMs, not the space itself, not already listed.
  const candidates = useChat(
    useShallow(s => Object.keys(s.rooms).filter(id => id !== spaceID && !s.rooms[id].meta.dm_user_id && !children.includes(id))),
  )
  const names = useChat(useShallow(s => Object.fromEntries([...children, ...candidates].map(id => [id, s.rooms[id]?.meta.name ?? id]))))
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<Set<RoomID>>(new Set())

  // The child events and power levels are room state, which may not be loaded for a space yet.
  useEffect(() => {
    void loadRoomState(spaceID)
  }, [spaceID])

  const needle = query.trim().toLowerCase()
  const matches = (id: RoomID) => !needle || names[id]?.toLowerCase().includes(needle) || id.toLowerCase().includes(needle)
  const byName = (a: RoomID, b: RoomID) => collator.compare(names[a] ?? a, names[b] ?? b)
  const inSpace = useMemo(() => children.filter(matches).sort(byName), [children, needle, names]) // eslint-disable-line react-hooks/exhaustive-deps
  const addable = useMemo(() => candidates.filter(matches).sort(byName), [candidates, needle, names]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = (childID: RoomID, add: boolean) => async () => {
    setBusy(b => new Set(b).add(childID))
    try {
      await (add ? addSpaceChild(spaceID, childID) : removeSpaceChild(spaceID, childID))
    } catch (err) {
      showToast(`Couldn't ${add ? 'add' : 'remove'} ${names[childID] ?? childID}: ${errorText(err)}`)
    } finally {
      setBusy(b => {
        const next = new Set(b)
        next.delete(childID)
        return next
      })
    }
  }

  return (
    <>
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <Dialog.Title className="min-w-0 truncate text-sm font-semibold">Rooms in {spaceName}</Dialog.Title>
        <Dialog.Close aria-label="Close" className="ml-auto rounded-md p-1 text-muted hover:bg-hover hover:text-fg">
          <X size={16} />
        </Dialog.Close>
      </header>
      <div className="shrink-0 border-b border-border px-4 py-2.5">
        <label className="flex h-8 items-center gap-2 rounded-lg border border-border bg-bg px-2.5 text-sm focus-within:border-accent">
          <Search size={14} className="shrink-0 text-muted" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter rooms"
            autoFocus
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
          />
        </label>
        {!canEdit && (
          <p className="mt-2 text-xs text-danger">You don't have permission to change this space's rooms.</p>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <RoomSection title={`In this space (${children.length})`} empty={needle ? 'Nothing matches' : 'No rooms yet'}>
          {inSpace.map(id => (
            <RoomRow key={id} roomID={id} name={names[id] ?? id} busy={busy.has(id)} disabled={!canEdit} onClick={run(id, false)} add={false} />
          ))}
        </RoomSection>
        <RoomSection title="Your other rooms" empty={needle ? 'Nothing matches' : "You're not in any other rooms"}>
          {addable.map(id => (
            <RoomRow key={id} roomID={id} name={names[id] ?? id} busy={busy.has(id)} disabled={!canEdit} onClick={run(id, true)} add />
          ))}
        </RoomSection>
      </div>
    </>
  )
}

function RoomSection({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children.length ? <ul className="space-y-0.5">{children}</ul> : <p className="px-1 py-2 text-xs text-muted">{empty}</p>}
    </section>
  )
}

function RoomRow({ roomID, name, busy, disabled, add, onClick }: { roomID: RoomID; name: string; busy: boolean; disabled: boolean; add: boolean; onClick: () => void }) {
  const avatar = useChat(s => s.rooms[roomID]?.meta.avatar)
  const isSpace = useChat(s => s.rooms[roomID]?.meta.creation_content?.type === 'm.space')
  return (
    <li className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-hover">
      <Avatar mxc={avatar} id={roomID} name={name} size={28} className={isSpace ? 'rounded-lg' : undefined} />
      <span className="min-w-0 flex-1 truncate text-sm" title={roomID}>
        {name}
        {isSpace && <span className="ml-1.5 text-xs text-muted">space</span>}
      </span>
      <button
        type="button"
        onClick={onClick}
        disabled={busy || disabled}
        aria-label={add ? `Add ${name}` : `Remove ${name}`}
        className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs font-medium transition-colors hover:bg-surface-2 disabled:opacity-50"
      >
        {busy ? <Spinner size={11} /> : add ? <Plus size={12} /> : <Minus size={12} />}
        {add ? 'Add' : 'Remove'}
      </button>
    </li>
  )
}
