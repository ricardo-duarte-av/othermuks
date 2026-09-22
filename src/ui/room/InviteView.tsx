// The main area for a room we've been invited to but haven't joined: what the invite says about the
// room, plus accepting and declining it. Shown in place of the timeline, which doesn't exist yet.
import { Check, Globe, Hash, Lock, TriangleAlert, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { RoomSummary } from '@/api/types'
import { LinkifiedText } from '@/ui/LinkifiedText'
import { acceptInvite, declineInvite, fetchRoomSummary, type InviteDetails } from '@/store/membership'
import { showToast, useUI } from '@/store/ui'
import { Avatar, Spinner } from '@/ui/primitives'

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function InviteView({ invite }: { invite: InviteDetails }) {
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<RoomSummary | null>(null)

  // The stripped state has no member count, so ask the server for one. It may refuse, which is fine:
  // everything shown here beyond the count comes from the invite itself.
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

  const name = invite.name ?? invite.canonicalAlias ?? invite.roomID
  const members = summary?.num_joined_members
  const joinRule = invite.joinRule ?? summary?.join_rule

  const run = async (action: 'accept' | 'decline') => {
    setBusy(action)
    setError(null)
    try {
      if (action === 'accept') {
        await acceptInvite(invite.roomID)
      } else {
        await declineInvite(invite.roomID)
        // The room list drops the invite on the next sync; don't leave the empty view behind.
        if (useUI.getState().activeRoomID === invite.roomID) useUI.setState({ activeRoomID: null })
        showToast(`Declined the invite to ${name}`)
      }
    } catch (err) {
      setError(errorText(err))
      setBusy(null)
    }
  }

  return (
    <div className="invite-view flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-8">
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <Avatar mxc={invite.avatar} id={invite.roomID} name={invite.name} size={88} className="rounded-2xl" />
        <h1 className="mt-4 text-xl font-semibold">{name}</h1>
        {invite.canonicalAlias && invite.canonicalAlias !== name && (
          <p className="mt-0.5 flex items-center gap-1 text-sm text-muted">
            <Hash size={13} />
            {invite.canonicalAlias.replace(/^#/, '')}
          </p>
        )}

        <p className="mt-3 text-sm">
          {invite.inviter ? (
            <>
              <span className="font-medium">{invite.inviterName}</span> invited you
              {invite.isDM ? ' to chat' : invite.isSpace ? ' to this space' : ' to this room'}
            </>
          ) : (
            "You've been invited"
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
              {joinRule === 'public' ? 'Public room' : joinRule === 'knock' ? 'Ask to join' : 'Invite only'}
            </span>
          )}
          {invite.encrypted && (
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

        {error && (
          <p className="mt-3 flex items-center gap-2 text-xs text-danger">
            <TriangleAlert size={13} className="shrink-0" /> {error}
          </p>
        )}
      </div>
    </div>
  )
}
