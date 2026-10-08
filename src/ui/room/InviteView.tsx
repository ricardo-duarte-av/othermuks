// The main area for a room we've been invited to but haven't joined: what the invite says about the
// room and who sent it, plus accepting and declining it. Shown in place of the timeline, which
// doesn't exist yet.
import { Check, ChevronDown, Globe, Hash, Lock, ShieldAlert, TriangleAlert, UserX, Users, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { RoomSummary, UserID } from '@/api/types'
import { formatFull, formatRelative } from '@/lib/format'
import { useChat } from '@/store/chat'
import { fallbackDisplayName } from '@/store/events'
import { setIgnored } from '@/store/ignored'
import { acceptInvite, declineInvite, fetchRoomSummary, type InviteDetails } from '@/store/membership'
import { loadProfile, useProfiles } from '@/store/profiles'
import { showToast, useUI } from '@/store/ui'
import { loadSharedRooms, type SharedRooms } from '@/store/userActions'
import { LinkifiedText } from '@/ui/LinkifiedText'
import { Avatar, Spinner } from '@/ui/primitives'
import { Copyable, JOIN_RULES, Mono, None, Row, Section } from './InfoRows'
import { SharedRoomRow } from './UserActions'

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

const SHARED_ROOMS_SHOWN = 4

export function InviteView({ invite }: { invite: InviteDetails }) {
  const [busy, setBusy] = useState<'accept' | 'decline' | 'ignore' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<RoomSummary | null>(null)

  // The stripped state has no member count (and often no version), so ask the server. It may refuse,
  // which is fine: everything else shown here comes from the invite itself.
  useEffect(() => {
    let cancelled = false
    fetchRoomSummary(invite.roomID).then(
      resp => !cancelled && setSummary(resp),
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [invite.roomID])

  // The invite may not carry the inviter's name or avatar; their global profile fills the gaps.
  const inviterID = invite.inviter
  useEffect(() => {
    if (inviterID) void loadProfile(inviterID)
  }, [inviterID])
  const profile = useProfiles(s => (inviterID ? s.profiles[inviterID]?.profile : undefined))
  const namedInRoom = !!inviterID && invite.inviterName !== fallbackDisplayName(inviterID)
  const inviterName = namedInRoom ? invite.inviterName : (profile?.displayname ?? invite.inviterName)
  const inviterAvatar = invite.inviterAvatar ?? profile?.avatar_url

  // A DM is named after the inviter, so it takes the better name too.
  const name = invite.isDM && invite.name === invite.inviterName ? inviterName : (invite.name ?? invite.canonicalAlias ?? invite.roomID)
  const members = summary?.num_joined_members
  const joinRule = invite.joinRule ?? summary?.join_rule
  const encryption = invite.encryption ?? summary?.encryption
  const roomVersion = invite.roomVersion ?? summary?.room_version
  const kind = invite.isDM ? 'chat' : invite.isSpace ? 'space' : 'room'

  const run = async (action: 'accept' | 'decline' | 'ignore') => {
    setBusy(action)
    setError(null)
    try {
      if (action === 'accept') {
        await acceptInvite(invite.roomID)
        return
      }
      await declineInvite(invite.roomID)
      if (action === 'ignore' && inviterID) await setIgnored(inviterID, true)
      // The room list drops the invite on the next sync; don't leave the empty view behind.
      if (useUI.getState().activeRoomID === invite.roomID) useUI.setState({ activeRoomID: null })
      showToast(action === 'ignore' ? `Declined the invite and ignored ${inviterName}` : `Declined the invite to ${name}`)
    } catch (err) {
      setError(errorText(err))
      setBusy(null)
    }
  }

  return (
    <div className="invite-view flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 py-8 sm:px-8">
      <div className="my-auto flex w-full max-w-md flex-col items-center text-center">
        {invite.isDM && inviterID ? (
          <Avatar mxc={invite.avatar ?? inviterAvatar} id={inviterID} name={inviterName} size={88} />
        ) : (
          <Avatar mxc={invite.avatar} id={invite.roomID} name={invite.name} size={88} className="rounded-2xl" />
        )}
        <h1 className="mt-4 break-words text-xl font-semibold">{name}</h1>
        {invite.isDM && inviterID ? (
          <p className="mt-0.5 break-all font-mono text-[13px] text-muted">{inviterID}</p>
        ) : (
          invite.canonicalAlias &&
          invite.canonicalAlias !== name && (
            <p className="mt-0.5 flex items-center gap-1 text-sm text-muted">
              <Hash size={13} />
              {invite.canonicalAlias.replace(/^#/, '')}
            </p>
          )
        )}

        <p className="mt-3 text-sm">
          {inviterID ? (
            <>
              <span className="font-medium">{inviterName}</span> invited you {invite.isDM ? 'to chat' : `to this ${kind}`}
            </>
          ) : (
            "You've been invited"
          )}
          {invite.createdAt > 0 && (
            <span className="text-muted" title={formatFull(invite.createdAt)}>
              {' · '}
              {formatRelative(invite.createdAt)}
            </span>
          )}
        </p>
        {invite.reason && <p className="mt-1 text-sm italic text-muted">“{invite.reason}”</p>}

        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted">
          {members !== undefined && (
            <span className="flex items-center gap-1">
              <Users size={12} /> {members} {members === 1 ? 'member' : 'members'}
            </span>
          )}
          {joinRule && (
            <span className="flex items-center gap-1">
              {joinRule === 'public' ? <Globe size={12} /> : <Lock size={12} />}
              {joinRule === 'public' ? 'Public' : joinRule === 'knock' ? 'Ask to join' : 'Invite only'}
            </span>
          )}
          {encryption && (
            <span className="flex items-center gap-1">
              <Lock size={12} /> Encrypted
            </span>
          )}
        </div>

        {invite.topic && (
          <p className="mt-4 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-muted">
            <LinkifiedText text={invite.topic} />
          </p>
        )}

        {inviterID && <InviterCard userID={inviterID} name={inviterName ?? inviterID} avatar={inviterAvatar} showIdentity={!invite.isDM} />}

        {invite.members.length > 0 && (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted">
            <span className="flex -space-x-1.5">
              {invite.members.slice(0, 5).map(m => (
                <span key={m.userID} title={m.name ? `${m.name} (${m.userID})` : m.userID} className="rounded-full ring-2 ring-bg">
                  <Avatar mxc={m.avatar} id={m.userID} name={m.name ?? fallbackDisplayName(m.userID)} size={20} />
                </span>
              ))}
            </span>
            {formatMembers(invite.members.map(m => m.name ?? fallbackDisplayName(m.userID)))} {invite.members.length === 1 ? 'is' : 'are'} here
          </div>
        )}

        <div className="mt-6 flex w-full gap-2">
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void run('accept')}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-60"
          >
            {busy === 'accept' ? <Spinner size={14} /> : <Check size={15} />}
            {invite.isSpace ? 'Join space' : 'Accept'}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void run('decline')}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-hover hover:text-danger disabled:opacity-60"
          >
            {busy === 'decline' ? <Spinner size={14} /> : <X size={15} />}
            Decline
          </button>
        </div>
        {inviterID && (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void run('ignore')}
            className="mt-2 flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-danger disabled:opacity-60"
          >
            {busy === 'ignore' ? <Spinner size={12} /> : <UserX size={13} />}
            Decline and ignore {inviterName}
          </button>
        )}

        {error && (
          <p className="mt-3 flex items-center gap-2 text-xs text-danger">
            <TriangleAlert size={13} className="shrink-0" /> {error}
          </p>
        )}

        <details className="invite-details group mt-6 w-full text-left text-sm">
          <summary className="flex cursor-pointer list-none items-center justify-center gap-1 text-xs text-muted hover:text-fg">
            Details <ChevronDown size={13} className="transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-3">
            <Section title="Invite">
              <Row label="Room ID">
                <Copyable value={invite.roomID} what="Room ID" />
              </Row>
              {invite.canonicalAlias && (
                <Row label="Address">
                  <Copyable value={invite.canonicalAlias} what="Address" />
                </Row>
              )}
              {inviterID && (
                <Row label="Invited by">
                  <Copyable value={inviterID} what="User ID" />
                </Row>
              )}
              {invite.createdAt > 0 && <Row label="Received">{formatFull(invite.createdAt)}</Row>}
              <Row label="Type">{invite.isDM ? 'Direct message' : invite.isSpace ? 'Space' : 'Room'}</Row>
              {invite.creator && invite.creator !== inviterID && (
                <Row label="Created by">
                  <Mono>{invite.creator}</Mono>
                </Row>
              )}
              <Row label="Version">{roomVersion ?? <None>Unknown</None>}</Row>
              <Row label="Who can join">{joinRule ? (JOIN_RULES[joinRule] ?? <Mono>{joinRule}</Mono>) : <None>Unknown</None>}</Row>
              <Row label="Encryption">{encryption ? <Mono>{encryption}</Mono> : 'Not encrypted'}</Row>
              <Row label="Members">{members !== undefined ? `${members} joined` : <None>Unknown</None>}</Row>
            </Section>
          </div>
        </details>
      </div>
    </div>
  )
}

/** "Alice", "Alice and Bob", "Alice, Bob and 3 others". */
function formatMembers(names: string[]) {
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} ${names.length === 3 ? 'other' : 'others'}`
}

/**
 * Who sent the invite and which rooms we already share with them: the first thing to check before
 * accepting, since an invite from someone we share nothing with is how most invite spam arrives.
 */
function InviterCard({ userID, name, avatar, showIdentity }: { userID: UserID; name: string; avatar?: string; showIdentity: boolean }) {
  const [state, setState] = useState<SharedRooms>({ status: 'loading' })
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    void loadSharedRooms(userID).then(result => !cancelled && setState(result))
    return () => {
      cancelled = true
    }
  }, [userID])
  const rooms = useChat(s => s.rooms)
  const shared = useMemo(
    () =>
      state.status === 'ok'
        ? state.roomIDs.toSorted((a, b) => (rooms[b]?.meta.sorting_timestamp ?? 0) - (rooms[a]?.meta.sorting_timestamp ?? 0))
        : [],
    [state, rooms],
  )
  const shown = expanded ? shared : shared.slice(0, SHARED_ROOMS_SHOWN)

  return (
    <div className="invite-inviter mt-5 w-full rounded-lg border border-border bg-surface p-3 text-left">
      {showIdentity && (
        <div className="mb-2.5 flex items-center gap-2.5">
          <Avatar mxc={avatar} id={userID} name={name} size={36} />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate font-mono text-xs text-muted" title={userID}>
              {userID}
            </p>
          </div>
        </div>
      )}
      {state.status === 'loading' && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Spinner size={12} /> Looking for rooms you share…
        </p>
      )}
      {state.status === 'error' && <p className="text-xs text-muted">Couldn't load shared rooms: {state.message}</p>}
      {state.status === 'ok' && shared.length === 0 && (
        <p className="flex items-start gap-2 text-xs text-fg">
          <ShieldAlert size={14} className="mt-px shrink-0 text-danger" />
          <span>
            You don't share any rooms with {showIdentity ? 'them' : name}. Only accept if you know who this is.
            {state.approximate && <span className="text-muted"> (Checked locally; your server can't list shared rooms.)</span>}
          </span>
        </p>
      )}
      {state.status === 'ok' && shared.length > 0 && (
        <>
          <p className="text-xs text-muted">
            {shared.length} shared {shared.length === 1 ? 'room' : 'rooms'}
            {state.approximate && ' (found locally)'}
          </p>
          <div className="-mx-2 mt-1 flex flex-col">
            {shown.map(roomID => (
              <SharedRoomRow key={roomID} roomID={roomID} />
            ))}
          </div>
          {shared.length > SHARED_ROOMS_SHOWN && (
            <button type="button" onClick={() => setExpanded(e => !e)} className="mt-1 flex items-center gap-1 text-xs text-muted hover:text-fg">
              <ChevronDown size={13} className={expanded ? 'rotate-180' : undefined} />
              {expanded ? 'Show fewer' : `Show ${shared.length - SHARED_ROOMS_SHOWN} more`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
