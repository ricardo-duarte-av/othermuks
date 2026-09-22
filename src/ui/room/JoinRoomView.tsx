// The main area for a room we're not in, reached by following a link to it: what the server will
// say about the room, and the way in — joining it, or asking to when that's all it allows.
import { DoorOpen, Globe, Hash, Lock, TriangleAlert, Users, X } from 'lucide-react'
import { useState } from 'react'
import { LinkifiedText } from '@/ui/LinkifiedText'
import { canKnock, closeRoomPreview, joinPreviewedRoom, type RoomPreviewState } from '@/store/membership'
import { Avatar, IconButton, Spinner } from '@/ui/primitives'

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function JoinRoomView({ preview }: { preview: RoomPreviewState }) {
  const [busy, setBusy] = useState<'join' | 'knock' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [askingReason, setAskingReason] = useState(false)

  const summary = preview.summary
  const name = summary?.name ?? preview.alias ?? summary?.canonical_alias ?? preview.reference
  const alias = summary?.canonical_alias ?? preview.alias
  const members = summary?.num_joined_members
  const joinRule = summary?.join_rule
  const knockable = canKnock(joinRule)
  const isSpace = summary?.room_type === 'm.space'

  const run = (kind: 'join' | 'knock') => async () => {
    setBusy(kind)
    setError(null)
    try {
      await joinPreviewedRoom(kind === 'knock' ? { knock: true, reason: reason.trim() || undefined } : {})
    } catch (err) {
      setError(errorText(err))
      setBusy(null)
    }
  }

  if (preview.status === 'loading') {
    return (
      <div className="join-room-view grid min-h-0 flex-1 place-items-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="join-room-view relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-8">
      <div className="absolute right-3 top-3">
        <IconButton label="Close" shortcut="Esc" onClick={closeRoomPreview}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <Avatar mxc={summary?.avatar_url} id={preview.roomID ?? preview.reference} name={summary?.name} size={88} className="rounded-2xl" />
        <h1 className="mt-4 break-all text-xl font-semibold">{name}</h1>
        {alias && alias !== name && (
          <p className="mt-0.5 flex items-center gap-1 text-sm text-muted">
            <Hash size={13} />
            {alias.replace(/^#/, '')}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted">
          {members !== undefined && (
            <span className="flex items-center gap-1">
              <Users size={12} /> {members} {members === 1 ? 'member' : 'members'}
            </span>
          )}
          {joinRule && (
            <span className="flex items-center gap-1">
              {joinRule === 'public' ? <Globe size={12} /> : <Lock size={12} />}
              {joinRule === 'public' ? 'Anyone can join' : knockable ? 'Ask to join' : 'Invite only'}
            </span>
          )}
          {summary?.encryption && (
            <span className="flex items-center gap-1">
              <Lock size={12} /> Encrypted
            </span>
          )}
        </div>

        {summary?.topic && (
          <p className="mt-4 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-muted">
            <LinkifiedText text={summary.topic} />
          </p>
        )}

        {preview.status === 'error' && (
          <p className="mt-4 text-xs leading-relaxed text-muted">
            This server wouldn't say anything about the room. You can still try to join it.
          </p>
        )}

        {preview.eventID && <p className="mt-3 text-xs text-muted">The link points at a message; we'll go to it once you're in.</p>}

        {askingReason && (
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={2}
            autoFocus
            placeholder="Why do you want to join? (optional)"
            className="mt-4 w-full resize-none rounded-lg border border-border bg-bg/40 px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
          />
        )}

        <div className="mt-6 flex w-full gap-2">
          {knockable ? (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => (askingReason ? void run('knock')() : setAskingReason(true))}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-60"
            >
              {busy === 'knock' ? <Spinner size={14} /> : <DoorOpen size={15} />}
              Ask to join
            </button>
          ) : (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void run('join')()}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-60"
            >
              {busy === 'join' ? <Spinner size={14} /> : <DoorOpen size={15} />}
              {isSpace ? 'Join space' : 'Join room'}
            </button>
          )}
          <button
            type="button"
            disabled={!!busy}
            onClick={closeRoomPreview}
            className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-hover disabled:opacity-60"
          >
            Cancel
          </button>
        </div>

        {error && (
          <>
            <p className="mt-3 flex items-center gap-2 text-left text-xs text-danger">
              <TriangleAlert size={13} className="mt-px shrink-0" /> {error}
            </p>
            {/* A room that only takes requests refuses a plain join, so offer the way it does allow. */}
            {!knockable && /knock/i.test(error) && (
              <button
                type="button"
                onClick={() => void run('knock')()}
                className="mt-2 flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-hover"
              >
                <DoorOpen size={13} /> Ask to join instead
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
