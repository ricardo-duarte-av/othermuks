import { Lock, LockOpen, Users, X } from 'lucide-react'
import { Fragment, memo, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { mediaURL } from '@/api/media'
import type { RoomID, UserID } from '@/api/types'
import { useChat } from '@/store/chat'
import { displayNameOf, fallbackDisplayName } from '@/store/events'
import { useJoinedMembers, useMember, useRoomPowerContext } from '@/store/hooks'
import { ROLE_GROUP_LABELS, roleForLevel, userPowerLevel, type Role } from '@/store/power'
import { openLightbox, openProfile, useUI } from '@/store/ui'
import { LinkifiedText } from '@/ui/LinkifiedText'
import { Avatar, IconButton, Spinner } from '@/ui/primitives'

const MEMBER_RENDER_LIMIT = 300

const MemberRow = memo(function MemberRow({ roomID, userID, level }: { roomID: RoomID; userID: UserID; level: number }) {
  const member = useMember(roomID, userID)
  const name = displayNameOf(userID, member)
  return (
    <li>
      <button
        type="button"
        onClick={() => openProfile(userID)}
        title={userID}
        className="member-row flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-hover"
      >
        <Avatar mxc={member?.avatar_url} id={userID} name={name} size={36} />
        <div className="min-w-0 flex-1 leading-snug">
          <div className="truncate text-[15px] font-medium">{name}</div>
          <div className="truncate text-xs text-muted">{userID}</div>
        </div>
        {level > 0 && (
          <span
            className="member-power shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted"
            title={level === Infinity ? 'Room creator' : `Power level ${level}`}
          >
            {level === Infinity ? '∞' : level}
          </span>
        )}
      </button>
    </li>
  )
})

function MemberList({ roomID }: { roomID: RoomID }) {
  const memberIDs = useJoinedMembers(roomID)
  const loaded = useChat(s => s.rooms[roomID]?.membersLoaded)
  const { powerLevels, createEvent } = useRoomPowerContext(roomID)
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

  // Highest power level first, then alphabetically by display name.
  const { sorted, roleCounts } = useMemo(() => {
    const entries = memberIDs.map((userID, i) => ({ userID, name: names[i], level: userPowerLevel(powerLevels, createEvent, userID) }))
    entries.sort(
      (a, b) =>
        (a.level === b.level ? 0 : b.level - a.level) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
        a.userID.localeCompare(b.userID),
    )
    const counts: Partial<Record<Role, number>> = {}
    for (const entry of entries) {
      const role = roleForLevel(entry.level)
      counts[role] = (counts[role] ?? 0) + 1
    }
    return { sorted: entries, roleCounts: counts }
  }, [memberIDs, names, powerLevels, createEvent])

  const visible = sorted.slice(0, MEMBER_RENDER_LIMIT)

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <h3 className="flex items-center gap-2 px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">
        <Users size={13} /> People · {memberIDs.length}
        {!loaded && <Spinner size={12} />}
      </h3>
      <ul className="member-list flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
        {visible.map((entry, i) => {
          const role = roleForLevel(entry.level)
          const startsGroup = i === 0 || roleForLevel(visible[i - 1].level) !== role
          return (
            <Fragment key={entry.userID}>
              {startsGroup && (
                <li className="member-group px-2.5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-muted first:pt-2">
                  {ROLE_GROUP_LABELS[role]} · {roleCounts[role]}
                </li>
              )}
              <MemberRow roomID={roomID} userID={entry.userID} level={entry.level} />
            </Fragment>
          )
        })}
        {sorted.length > MEMBER_RENDER_LIMIT && (
          <li className="px-2.5 py-2 text-xs text-muted">and {sorted.length - MEMBER_RENDER_LIMIT} more</li>
        )}
      </ul>
    </section>
  )
}

/** Room details view of the right panel: room info plus a member list whose rows open profiles. */
export function RoomDetails({ roomID }: { roomID: RoomID }) {
  const meta = useChat(s => s.rooms[roomID]?.meta)
  if (!meta) return null
  const avatarURL = mediaURL(meta.avatar)
  return (
    <>
      <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
        <h2 className="text-sm font-semibold">Room details</h2>
        <IconButton label="Close" shortcut="Esc" className="ml-auto" onClick={() => useUI.setState({ drawerOpen: false })}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="flex flex-col items-center gap-2 border-b border-border px-4 py-5 text-center">
        {avatarURL ? (
          <button type="button" title="View room avatar" onClick={() => openLightbox(avatarURL, meta.name)} className="rounded-full">
            <Avatar mxc={meta.avatar} id={meta.dm_user_id ?? roomID} name={meta.name} size={72} />
          </button>
        ) : (
          <Avatar id={meta.dm_user_id ?? roomID} name={meta.name} size={72} />
        )}
        <h3 className="mt-1 text-base font-semibold">{meta.name ?? roomID}</h3>
        {meta.canonical_alias && <p className="text-xs text-muted">{meta.canonical_alias}</p>}
        {meta.topic && (
          <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm text-muted">
            <LinkifiedText text={meta.topic} />
          </p>
        )}
        <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted">
          {meta.encryption_event ? <Lock size={12} /> : <LockOpen size={12} />}
          {meta.encryption_event ? 'End-to-end encrypted' : 'Not encrypted'}
        </span>
      </div>
      <MemberList roomID={roomID} />
    </>
  )
}
