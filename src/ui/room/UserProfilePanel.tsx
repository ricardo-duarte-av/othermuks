import { Clock, Copy, Shield, UserCheck, UserX, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { mediaURL, userColorIndex } from '@/api/media'
import type { RoomID, UserID } from '@/api/types'
import { selectOwnUserID, useChat } from '@/store/chat'
import { fallbackDisplayName } from '@/store/events'
import { setIgnored, useIsIgnored } from '@/store/ignored'
import { useMember, useRoomPowerContext } from '@/store/hooks'
import { ROLE_LABELS, roleForLevel, userPowerLevel } from '@/store/power'
import { loadProfile, useProfiles } from '@/store/profiles'
import { openLightbox, showToast, useUI } from '@/store/ui'
import { sanitizeHTML } from '@/ui/html'
import { Avatar, IconButton, Spinner } from '@/ui/primitives'

/** Profile keys rendered in dedicated places; anything else is listed under "Profile fields". */
const KNOWN_FIELDS = new Set([
  'displayname',
  'avatar_url',
  'chat.commet.profile_banner',
  // Biographies: gomuks returns them already sanitized as `bio.html`.
  'chat.commet.profile_bio',
  'gay.fomx.biography',
  'moe.sable.app.bio',
  'io.fsky.nyx.pronouns',
  'm.status',
  'org.msc.4426.status',
  'm.tz',
  'us.cloke.msc4175.tz',
])

const asString = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined)

function pronounsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(set => asString((set as { summary?: unknown } | null)?.summary)).filter((s): s is string => !!s)
}

function statusOf(profile: Record<string, unknown>) {
  const raw = (profile['m.status'] ?? profile['org.msc.4426.status']) as { emoji?: unknown; text?: unknown } | null | undefined
  if (!raw || typeof raw !== 'object') return undefined
  const emoji = asString(raw.emoji)
  const text = asString(raw.text)
  return emoji || text ? { emoji, text } : undefined
}

/** Readable value for an arbitrary profile field, or undefined to hide it. */
function describeField(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') return value.trim() || undefined
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const parts = value
      .map(item => (typeof item === 'string' ? item : asString((item as { summary?: unknown } | null)?.summary)))
      .filter(Boolean)
    return parts.length ? parts.join(', ') : undefined
  }
  return undefined
}

function localTime(timeZone: string) {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date())
  } catch {
    return undefined
  }
}

function Banner({ mxc, userID, name }: { mxc?: string; userID: UserID; name: string }) {
  const url = mediaURL(mxc)
  const [failed, setFailed] = useState(false)
  if (!url || failed) {
    return (
      <div
        className="profile-banner h-28 w-full"
        style={{ background: `linear-gradient(135deg, var(--user-color-${userColorIndex(userID)}), var(--surface-2))` }}
      />
    )
  }
  return (
    <button
      type="button"
      title="View banner"
      onClick={() => openLightbox(url, `${name} banner`)}
      className="profile-banner block h-28 w-full overflow-hidden bg-surface-2"
    >
      <img src={url} alt="" onError={() => setFailed(true)} className="size-full object-cover" />
    </button>
  )
}

function LargeAvatar({ mxc, userID, name }: { mxc?: string; userID: UserID; name: string }) {
  const url = mediaURL(mxc)
  const [failed, setFailed] = useState(false)
  if (!url || failed) {
    return <Avatar id={userID} name={name} size={88} className="ring-4 ring-[var(--drawer-bg)]" />
  }
  return (
    <button type="button" title="View avatar" onClick={() => openLightbox(url, `${name} avatar`)} className="block rounded-full">
      <img src={url} alt="" onError={() => setFailed(true)} className="user-avatar size-[88px] bg-surface-2 ring-4 ring-[var(--drawer-bg)]" />
    </button>
  )
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Ignore / unignore, with a confirmation before ignoring. */
function IgnoreSection({ userID, name }: { userID: UserID; name: string }) {
  const ignored = useIsIgnored(userID)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const apply = async (ignore: boolean) => {
    setBusy(true)
    try {
      await setIgnored(userID, ignore)
      showToast(ignore ? `Ignored ${name}` : `You're no longer ignoring ${name}`)
      setConfirming(false)
    } catch (err) {
      showToast(`Couldn't ${ignore ? 'ignore' : 'unignore'} ${name}: ${errorText(err)}`)
    } finally {
      setBusy(false)
    }
  }

  if (ignored) {
    return (
      <section className="profile-ignore border-t border-border pt-4">
        <p className="mb-2 flex items-center gap-1.5 text-xs text-muted">
          <UserX size={13} className="shrink-0 text-danger" /> You're ignoring {name}. Their messages are hidden.
        </p>
        <button
          type="button"
          onClick={() => void apply(false)}
          disabled={busy}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-hover disabled:opacity-60"
        >
          {busy ? <Spinner size={14} /> : <UserCheck size={15} />} Unignore
        </button>
      </section>
    )
  }

  return (
    <section className="profile-ignore border-t border-border pt-4">
      {confirming ? (
        <div className="rounded-lg border border-danger/40 bg-danger/5 p-3">
          <p className="text-sm font-medium">Ignore {name}?</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Their messages will be hidden in every room and they won't be able to invite you. This is saved on your account, so it
            applies to all your clients. You can undo it here or in Settings.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirming(false)} className="rounded-lg px-3 py-1.5 text-sm hover:bg-hover">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void apply(true)}
              disabled={busy}
              className="flex items-center gap-2 rounded-lg bg-danger px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-60"
            >
              {busy && <Spinner size={14} />} Ignore
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-danger transition-colors hover:bg-danger/10"
        >
          <UserX size={15} /> Ignore user
        </button>
      )}
    </section>
  )
}

function SectionTitle({ children }: { children: string }) {
  return <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{children}</h4>
}

export function UserProfilePanel({ roomID, userID }: { roomID: RoomID; userID: UserID }) {
  const member = useMember(roomID, userID)
  const entry = useProfiles(s => s.profiles[userID])
  const { powerLevels, createEvent } = useRoomPowerContext(roomID)

  useEffect(() => {
    void loadProfile(userID, true)
  }, [userID])

  const profile = entry?.profile ?? {}
  const globalName = asString(profile.displayname)
  const roomName = asString(member?.displayname)
  const name = roomName ?? globalName ?? fallbackDisplayName(userID)
  const globalAvatar = asString(profile.avatar_url)
  const roomAvatar = asString(member?.avatar_url)
  const avatar = roomAvatar ?? globalAvatar
  const globalAvatarURL = mediaURL(globalAvatar)
  const showGlobalAvatar = !!roomAvatar && !!globalAvatarURL && roomAvatar !== globalAvatar
  const pronouns = pronounsOf(profile['io.fsky.nyx.pronouns'])
  const status = statusOf(profile)
  const timeZone = asString(profile['m.tz'] ?? profile['us.cloke.msc4175.tz'])
  const time = timeZone ? localTime(timeZone) : undefined
  const level = userPowerLevel(powerLevels, createEvent, userID)
  const role = roleForLevel(level)
  const extras = Object.entries(profile)
    .filter(([key]) => !KNOWN_FIELDS.has(key))
    .map(([key, value]) => [key, describeField(value)] as const)
    .filter((field): field is readonly [string, string] => !!field[1])
  const membership = member?.membership
  const isSelf = useChat(selectOwnUserID) === userID

  const copyUserID = () =>
    navigator.clipboard.writeText(userID).then(
      () => showToast('User ID copied'),
      () => showToast("Couldn't copy"),
    )

  return (
    <>
      <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
        <h2 className="text-sm font-semibold">Profile</h2>
        <IconButton label="Close profile" shortcut="Esc" className="ml-auto" onClick={() => useUI.setState({ profileUserID: null })}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="user-profile min-h-0 flex-1 overflow-y-auto pb-6">
        <div className="relative">
          <Banner mxc={asString(profile['chat.commet.profile_banner'])} userID={userID} name={name} />
          <div className="absolute -bottom-11 left-4 flex items-end gap-2">
            <LargeAvatar key={avatar} mxc={avatar} userID={userID} name={name} />
            {showGlobalAvatar && (
              <button
                type="button"
                onClick={() => openLightbox(globalAvatarURL, `${globalName ?? name} global avatar`)}
                title="View global avatar"
                className="mb-1 flex items-center gap-1.5 rounded-full border border-border bg-surface py-0.5 pl-0.5 pr-2 text-[11px] text-muted transition-colors hover:text-fg"
              >
                <Avatar mxc={globalAvatar} id={userID} name={globalName ?? name} size={24} />
                Global
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 px-4 pt-14">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 break-words text-lg font-semibold leading-tight">
              {name}
              {status?.emoji && (
                <span title={status.text} className="text-base">
                  {status.emoji}
                </span>
              )}
            </h3>
            {roomName && globalName && roomName !== globalName && (
              <p className="mt-0.5 text-xs text-muted">
                Global name: <span className="text-fg/80">{globalName}</span>
              </p>
            )}
            <button
              type="button"
              onClick={() => void copyUserID()}
              title="Copy user ID"
              className="mt-1 flex max-w-full items-center gap-1.5 font-mono text-xs text-muted transition-colors hover:text-fg"
            >
              <span className="truncate">{userID}</span>
              <Copy size={11} className="shrink-0" />
            </button>
          </div>

          {(pronouns.length > 0 || !!status?.text || !!time || level > 0) && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              {level > 0 && (
                <span
                  className="profile-role flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5"
                  title={level === Infinity ? undefined : `Power level ${level}`}
                >
                  <Shield size={11} /> {ROLE_LABELS[role]}
                  {level !== Infinity && role === 'member' ? ` · ${level}` : ''}
                </span>
              )}
              {pronouns.map(pronoun => (
                <span key={pronoun} className="profile-pronouns rounded-full bg-surface-2 px-2 py-0.5">
                  {pronoun}
                </span>
              ))}
              {status?.text && (
                <span className="profile-status rounded-full bg-surface-2 px-2 py-0.5">{[status.emoji, status.text].filter(Boolean).join(' ')}</span>
              )}
              {time && (
                <span className="profile-time flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5" title={timeZone}>
                  <Clock size={11} /> {time} local time
                </span>
              )}
            </div>
          )}

          {membership && membership !== 'join' && (
            <p className="text-xs text-muted">
              {membership === 'invite' ? 'Invited to this room' : membership === 'ban' ? 'Banned from this room' : 'Not in this room'}
            </p>
          )}

          {entry?.bio?.html && (
            <section>
              <SectionTitle>Bio</SectionTitle>
              <div className="profile-bio message-body text-sm" dangerouslySetInnerHTML={{ __html: sanitizeHTML(entry.bio.html) }} />
            </section>
          )}

          {extras.length > 0 && (
            <section>
              <SectionTitle>Profile fields</SectionTitle>
              <dl className="profile-fields flex flex-col gap-2 text-sm">
                {extras.map(([key, value]) => (
                  <div key={key} className="min-w-0">
                    <dt className="truncate font-mono text-[11px] text-muted" title={key}>
                      {key}
                    </dt>
                    <dd className="break-words">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {!isSelf && <IgnoreSection userID={userID} name={name} />}

          {entry?.loading && !entry.profile && (
            <div className="flex justify-center py-4 text-muted">
              <Spinner />
            </div>
          )}
          {entry?.error && <p className="text-xs text-danger">Couldn't load the global profile: {entry.error}</p>}
        </div>
      </div>
    </>
  )
}
