import { Lock, LockOpen, Users, X } from 'lucide-react'
import { memo, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { RoomID, UserID } from '@/api/types'
import { useChat } from '@/store/chat'
import { displayNameOf, fallbackDisplayName } from '@/store/events'
import { useJoinedMembers, useMember } from '@/store/hooks'
import { openProfile, useUI } from '@/store/ui'
import { Avatar, IconButton, Spinner } from '@/ui/primitives'

const MEMBER_RENDER_LIMIT = 300

const MemberRow = memo(function MemberRow({ roomID, userID }: { roomID: RoomID; userID: UserID }) {
  const member = useMember(roomID, userID)
  const name = displayNameOf(userID, member)
  return (
    <li>
      <button
        type="button"
        onClick={() => openProfile(userID)}
        title={userID}
        className="member-row flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors hover:bg-hover"
      >
        <Avatar mxc={member?.avatar_url} id={userID} name={name} size={28} />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm">{name}</div>
          <div className="truncate text-[11px] text-muted">{userID}</div>
        </div>
      </button>
    </li>
  )
})

function MemberList({ roomID }: { roomID: RoomID }) {
  const memberIDs = useJoinedMembers(roomID)
  const loaded = useChat(s => s.rooms[roomID]?.membersLoaded)
  const names = useChat(
    useShallow(s => {
      const room = s.rooms[roomID]
      return memberIDs.map(userID => {
        const rowid = room?.state['m.room.member']?.[userID]
        const name = rowid === undefined ? undefined : s.events[rowid]?.content.displayname
        return typeof name === 'string' && name ? name : fallbackDisplayName(userID)
      })
    }),
  )
  const sorted = useMemo(
    () =>
      memberIDs
        .map((userID, i) => ({ userID, sortKey: names[i].toLocaleLowerCase() }))
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey)),
    [memberIDs, names],
  )

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <h3 className="flex items-center gap-2 px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">
        <Users size={13} /> Members · {memberIDs.length}
        {!loaded && <Spinner size={12} />}
      </h3>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {sorted.slice(0, MEMBER_RENDER_LIMIT).map(({ userID }) => (
          <MemberRow key={userID} roomID={roomID} userID={userID} />
        ))}
        {sorted.length > MEMBER_RENDER_LIMIT && (
          <li className="px-2 py-2 text-xs text-muted">and {sorted.length - MEMBER_RENDER_LIMIT} more</li>
        )}
      </ul>
    </section>
  )
}

/** Room details view of the right panel: room info plus a member list whose rows open profiles. */
export function RoomDetails({ roomID }: { roomID: RoomID }) {
  const meta = useChat(s => s.rooms[roomID]?.meta)
  if (!meta) return null
  return (
    <>
      <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
        <h2 className="text-sm font-semibold">Room details</h2>
        <IconButton label="Close" shortcut="Esc" className="ml-auto" onClick={() => useUI.setState({ drawerOpen: false })}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="flex flex-col items-center gap-2 border-b border-border px-4 py-5 text-center">
        <Avatar mxc={meta.avatar} id={meta.dm_user_id ?? roomID} name={meta.name} size={72} />
        <h3 className="mt-1 text-base font-semibold">{meta.name ?? roomID}</h3>
        {meta.canonical_alias && <p className="text-xs text-muted">{meta.canonical_alias}</p>}
        {meta.topic && <p className="line-clamp-4 whitespace-pre-wrap text-sm text-muted">{meta.topic}</p>}
        <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted">
          {meta.encryption_event ? <Lock size={12} /> : <LockOpen size={12} />}
          {meta.encryption_event ? 'End-to-end encrypted' : 'Not encrypted'}
        </span>
      </div>
      <MemberList roomID={roomID} />
    </>
  )
}
