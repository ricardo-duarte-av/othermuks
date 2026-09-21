// Profile panel actions (DM, invite, kick, ban, redact, power level) and the rooms shared with the user.
import { Ban, Check, ChevronDown, MessageCircle, MessageCirclePlus, Shield, Trash2, UserMinus, UserPlus } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { client } from '@/api/client'
import type { RoomID, UserID } from '@/api/types'
import { cn } from '@/lib/cn'
import { selectOwnUserID, useChat } from '@/store/chat'
import { useRoomPowerContext } from '@/store/hooks'
import { openRoom, showToast } from '@/store/ui'
import {
  createDM,
  findDMRoom,
  loadSharedRooms,
  moderationRights,
  redactableEvents,
  redactEvents,
  setUserPowerLevel,
  type SharedRooms,
} from '@/store/userActions'
import { Avatar, Spinner } from '@/ui/primitives'

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

function ActionButton({
  icon,
  children,
  danger,
  disabled,
  onClick,
}: {
  icon: ReactNode
  children: ReactNode
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-60',
        danger ? 'text-danger hover:bg-danger/10' : 'hover:bg-hover',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

interface ConfirmCardProps {
  title: string
  description: ReactNode
  confirmLabel: string
  /** Asks for an optional reason, passed to onConfirm. */
  withReason?: boolean
  /** An extra opt-in shown as a checkbox. */
  option?: string
  danger?: boolean
  onConfirm: (reason: string, option: boolean) => Promise<void>
  onCancel: () => void
}

/** An inline confirmation, like the ignore one, so the panel never hides behind a modal. */
function ConfirmCard({ title, description, confirmLabel, withReason, option, danger, onConfirm, onCancel }: ConfirmCardProps) {
  const [reason, setReason] = useState('')
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const confirm = async () => {
    setBusy(true)
    try {
      await onConfirm(reason.trim(), checked)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={cn('rounded-lg border p-3', danger ? 'border-danger/40 bg-danger/5' : 'border-border bg-surface-2/40')}>
      <p className="text-sm font-medium">{title}</p>
      <div className="mt-1 text-xs leading-relaxed text-muted">{description}</div>
      {withReason && (
        <input
          value={reason}
          onChange={e => setReason(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void confirm()
            if (e.key === 'Escape') {
              e.stopPropagation()
              onCancel()
            }
          }}
          placeholder="Reason (optional)"
          autoFocus
          className="mt-2 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent/60"
        />
      )}
      {option && (
        <label className="mt-2 flex items-start gap-2 text-xs">
          <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
          {option}
        </label>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm hover:bg-hover">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={busy}
          className={cn(
            'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition hover:brightness-110 disabled:opacity-60',
            danger ? 'bg-danger text-white' : 'bg-accent text-accent-fg',
          )}
        >
          {busy && <Spinner size={14} />} {confirmLabel}
        </button>
      </div>
    </div>
  )
}

/** "Go to DM" when a joined DM with the user exists, otherwise "Create DM". */
function DMAction({ userID, name }: { userID: UserID; name: string }) {
  const existing = useChat(s => findDMRoom(s, userID))
  const [confirming, setConfirming] = useState(false)
  if (existing) {
    return <ActionButton icon={<MessageCircle size={15} />} onClick={() => openRoom(existing)}>Go to DM</ActionButton>
  }
  if (confirming) {
    return (
      <ConfirmCard
        title={`Start a chat with ${name}?`}
        description={<>This creates a new private room and invites <span className="font-mono">{userID}</span>. It's encrypted if they have devices that support it.</>}
        confirmLabel="Create DM"
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          try {
            await createDM(userID)
            setConfirming(false)
          } catch (err) {
            showToast(`Couldn't create the DM: ${errorText(err)}`)
          }
        }}
      />
    )
  }
  return <ActionButton icon={<MessageCirclePlus size={15} />} onClick={() => setConfirming(true)}>Create DM</ActionButton>
}

const PRESETS = [
  { level: 0, label: 'Member' },
  { level: 50, label: 'Moderator' },
  { level: 100, label: 'Admin' },
]

function PowerLevelEditor({ roomID, userID, level, maxLevel, self }: { roomID: RoomID; userID: UserID; level: number; maxLevel: number; self: boolean }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmSelfDemote, setConfirmSelfDemote] = useState(false)
  const value = draft ?? String(level)
  const parsed = /^-?\d+$/.test(value.trim()) ? Number(value) : NaN
  const valid = Number.isSafeInteger(parsed) && parsed <= maxLevel
  const changed = valid && parsed !== level

  const save = async () => {
    if (!changed) return
    if (self && parsed < level && !confirmSelfDemote) {
      setConfirmSelfDemote(true)
      return
    }
    setBusy(true)
    try {
      await setUserPowerLevel(roomID, userID, parsed)
      setDraft(null)
      setConfirmSelfDemote(false)
      showToast(`Power level set to ${parsed}`)
    } catch (err) {
      showToast(`Couldn't set the power level: ${errorText(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="profile-power flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <Shield size={15} className="shrink-0 text-muted" aria-label="Power level" />
        <input
          type="number"
          inputMode="numeric"
          value={value}
          max={maxLevel}
          aria-label="Power level"
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape' && draft !== null) {
              e.stopPropagation()
              setDraft(null)
              setConfirmSelfDemote(false)
            }
          }}
          className={cn(
            'w-20 rounded-md border bg-bg px-2 py-1 text-sm tabular-nums outline-none focus:border-accent/60',
            valid ? 'border-border' : 'border-danger',
          )}
        />
        {/* Wraps below the input as a group when the panel is narrow. */}
        <div className="flex shrink-0 gap-1">
          {PRESETS.filter(preset => preset.level <= maxLevel).map(preset => (
            <button
              key={preset.level}
              type="button"
              onClick={() => setDraft(String(preset.level))}
              className={cn(
                'rounded-full px-2 py-0.5 text-xs transition-colors',
                parsed === preset.level ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted hover:text-fg',
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
        {changed && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            aria-label="Save power level"
            title="Save power level"
            className="ml-auto grid size-7 shrink-0 place-items-center rounded-md bg-accent text-accent-fg transition hover:brightness-110 disabled:opacity-60"
          >
            {busy ? <Spinner size={14} /> : <Check size={15} />}
          </button>
        )}
      </div>
      {!valid && <p className="text-xs text-danger">Enter a whole number up to {maxLevel}, your own level.</p>}
      {confirmSelfDemote && (
        <p className="text-xs text-danger">
          You're lowering your own power level. You may not be able to get it back. Save again to confirm.
        </p>
      )}
    </div>
  )
}

type Pending = 'invite' | 'kick' | 'ban' | 'unban' | 'redact' | null

/** Actions on the user: power level, DM, membership, clean-up. Only what one's power level allows is offered. */
export function UserActions({ roomID, userID, name, children }: { roomID: RoomID; userID: UserID; name: string; children?: ReactNode }) {
  const ownUserID = useChat(selectOwnUserID)
  const { powerLevels, createEvent } = useRoomPowerContext(roomID)
  const membership = useChat(s => {
    const rowid = s.rooms[roomID]?.state['m.room.member']?.[userID]
    return rowid === undefined ? undefined : (s.events[rowid]?.content.membership as string | undefined)
  })
  const isDMWithUser = useChat(s => s.rooms[roomID]?.meta.dm_user_id === userID)
  const redactable = useChat(useShallow(s => redactableEvents(s, roomID, userID)))
  const [pending, setPending] = useState<Pending>(null)
  const [redactRemaining, setRedactRemaining] = useState(0)
  const self = ownUserID === userID
  const rights = useMemo(() => moderationRights(powerLevels, createEvent, ownUserID, userID), [powerLevels, createEvent, ownUserID, userID])
  const current = membership ?? 'leave'
  const nonState = redactable.filter(evt => evt.state_key === undefined)

  const runMembership = (action: 'invite' | 'kick' | 'ban' | 'unban') => async (reason: string, redact: boolean) => {
    try {
      await client.setMembership(roomID, userID, action, reason, action === 'ban' && redact)
      setPending(null)
      if (action === 'ban' && redact) await clean(reason, true)
    } catch (err) {
      showToast(`Couldn't ${action} ${name}: ${errorText(err)}`)
    }
  }

  const clean = async (reason: string, keepState: boolean) => {
    const events = keepState ? nonState : redactable
    try {
      await redactEvents(events, reason, setRedactRemaining)
      showToast(`Deleted ${events.length} ${events.length === 1 ? 'message' : 'messages'}`)
    } catch (err) {
      showToast(`Stopped deleting: ${errorText(err)}`)
    } finally {
      setRedactRemaining(0)
    }
  }

  const canInvite = rights.invite && !self && (current === 'leave' || current === 'knock')
  const canKick = rights.kick && (current === 'join' || current === 'invite' || current === 'knock')
  const kickLabel = current === 'invite' ? 'Revoke invitation' : current === 'knock' ? 'Reject join request' : 'Kick'
  const redactCount = redactable.length

  return (
    <section className="profile-actions flex flex-col gap-1 border-t border-border pt-4">
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Actions</h4>
      {rights.setPowerLevel && (
        <div className="mb-1 px-2">
          <PowerLevelEditor key={rights.userLevel} roomID={roomID} userID={userID} level={rights.userLevel} maxLevel={rights.maxLevel} self={self} />
        </div>
      )}
      {!self && !isDMWithUser && <DMAction userID={userID} name={name} />}

      {canInvite &&
        (pending === 'invite' ? (
          <ConfirmCard
            title={current === 'knock' ? `Let ${name} in?` : `Invite ${name}?`}
            description={current === 'knock' ? 'They asked to join this room.' : `They'll be invited to this room.`}
            confirmLabel={current === 'knock' ? 'Accept' : 'Invite'}
            withReason
            onCancel={() => setPending(null)}
            onConfirm={runMembership('invite')}
          />
        ) : (
          <ActionButton icon={<UserPlus size={15} />} onClick={() => setPending('invite')}>
            {current === 'knock' ? 'Accept join request' : 'Invite'}
          </ActionButton>
        ))}

      {canKick &&
        (pending === 'kick' ? (
          <ConfirmCard
            title={`${kickLabel}: ${name}?`}
            description={current === 'join' ? 'They can rejoin if the room allows it.' : undefined}
            confirmLabel={kickLabel}
            withReason
            danger
            onCancel={() => setPending(null)}
            onConfirm={runMembership('kick')}
          />
        ) : (
          <ActionButton icon={<UserMinus size={15} />} danger onClick={() => setPending('kick')}>
            {kickLabel}
          </ActionButton>
        ))}

      {rights.ban &&
        (current === 'ban' ? (
          pending === 'unban' ? (
            <ConfirmCard
              title={`Unban ${name}?`}
              description="They'll be able to join again."
              confirmLabel="Unban"
              withReason
              onCancel={() => setPending(null)}
              onConfirm={runMembership('unban')}
            />
          ) : (
            <ActionButton icon={<Ban size={15} />} onClick={() => setPending('unban')}>
              Unban
            </ActionButton>
          )
        ) : pending === 'ban' ? (
          <ConfirmCard
            title={`Ban ${name}?`}
            description="They'll be removed and can't come back until unbanned."
            confirmLabel="Ban"
            withReason
            option={
              redactCount && rights.redact
                ? `Also delete their ${nonState.length} loaded ${nonState.length === 1 ? 'message' : 'messages'}`
                : undefined
            }
            danger
            onCancel={() => setPending(null)}
            onConfirm={runMembership('ban')}
          />
        ) : (
          <ActionButton icon={<Ban size={15} />} danger onClick={() => setPending('ban')}>
            Ban
          </ActionButton>
        ))}

      {rights.redact &&
        redactCount > 0 &&
        (pending === 'redact' ? (
          <ConfirmCard
            title={`Delete ${name}'s recent messages?`}
            description={
              <>
                {nonState.length} {nonState.length === 1 ? 'message' : 'messages'}
                {redactCount > nonState.length ? ` and ${redactCount - nonState.length} state events` : ''} are loaded in this room. Older
                ones that aren't loaded stay.
              </>
            }
            confirmLabel="Delete"
            withReason
            option={redactCount > nonState.length ? 'Also delete their state events (name, avatar and membership changes)' : undefined}
            danger
            onCancel={() => setPending(null)}
            onConfirm={async (reason, includeState) => {
              setPending(null)
              await clean(reason, !includeState)
            }}
          />
        ) : (
          <ActionButton icon={<Trash2 size={15} />} danger disabled={redactRemaining > 0} onClick={() => setPending('redact')}>
            {redactRemaining > 0 ? `Deleting… ${redactRemaining} left` : 'Delete recent messages'}
          </ActionButton>
        ))}

      {children}
    </section>
  )
}

const SHARED_ROOMS_STEP = 5

function SharedRoomRow({ roomID }: { roomID: RoomID }) {
  const meta = useChat(s => s.rooms[roomID]?.meta)
  if (!meta) return null
  return (
    <button
      type="button"
      onClick={() => openRoom(roomID)}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-hover"
    >
      <Avatar mxc={meta.avatar} id={meta.dm_user_id ?? roomID} name={meta.name} size={28} />
      <span className="min-w-0 flex-1 truncate">{meta.name ?? roomID}</span>
    </button>
  )
}

/** Rooms both of you are in. */
export function SharedRoomsSection({ userID }: { userID: UserID }) {
  const [state, setState] = useState<SharedRooms>({ status: 'loading' })
  const [shown, setShown] = useState(SHARED_ROOMS_STEP)
  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    void loadSharedRooms(userID).then(result => !cancelled && setState(result))
    return () => {
      cancelled = true
    }
  }, [userID])
  // Most recently active first, like the room list.
  const rooms = useChat(s => s.rooms)
  const sorted = useMemo(
    () =>
      state.status === 'ok'
        ? state.roomIDs.toSorted((a, b) => (rooms[b]?.meta.sorting_timestamp ?? 0) - (rooms[a]?.meta.sorting_timestamp ?? 0))
        : [],
    [state, rooms],
  )

  return (
    <section className="profile-shared-rooms">
      <h4 className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        Shared rooms
        {state.status === 'ok' && <span className="font-normal normal-case tracking-normal">{sorted.length}</span>}
      </h4>
      {state.status === 'loading' && (
        <div className="flex justify-center py-2 text-muted">
          <Spinner size={16} />
        </div>
      )}
      {state.status === 'error' && <p className="text-xs text-muted">Couldn't load shared rooms: {state.message}</p>}
      {state.status === 'ok' && (
        <>
          {sorted.length === 0 && <p className="text-xs text-muted">No rooms in common.</p>}
          {state.approximate && <p className="mb-1 text-xs text-muted">Your server can't list shared rooms, so these are the ones found locally.</p>}
          <div className="-mx-2 flex flex-col">
            {sorted.slice(0, shown).map(roomID => (
              <SharedRoomRow key={roomID} roomID={roomID} />
            ))}
          </div>
          {sorted.length > shown && (
            <button
              type="button"
              onClick={() => setShown(n => n + SHARED_ROOMS_STEP * 4)}
              className="mt-1 flex items-center gap-1 text-xs text-muted hover:text-fg"
            >
              <ChevronDown size={13} /> Show {Math.min(sorted.length - shown, SHARED_ROOMS_STEP * 4)} more
            </button>
          )}
        </>
      )}
    </section>
  )
}
