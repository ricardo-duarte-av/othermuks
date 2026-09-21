import { Braces, Clock, Copy, Pencil, Shield, UserCheck, UserX, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { mediaURL, userColorIndex } from '@/api/media'
import type { RoomID, UserID } from '@/api/types'
import { selectOwnUserID, useChat } from '@/store/chat'
import { fallbackDisplayName } from '@/store/events'
import { setIgnored, useIsIgnored } from '@/store/ignored'
import { useMember, useRoomPowerContext } from '@/store/hooks'
import { ROLE_LABELS, roleForLevel, userPowerLevel } from '@/store/power'
import { loadProfile, pronounsOf, statusOf, timeZoneOf, useProfiles } from '@/store/profiles'
import { openLightbox, openStateExplorer, showToast, useUI } from '@/store/ui'
import { sanitizeHTML } from '@/ui/html'
import { Avatar, IconButton, Spinner } from '@/ui/primitives'
import { ProfileEditor } from './ProfileEditor'
import { SharedRoomsSection, UserActions } from './UserActions'

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
  'org.matrix.msc4426.status',
  'm.tz',
  'us.cloke.msc4175.tz',
])

const asString = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined)

/** The plain text of an extensible text container (MSC1767 m.text), which many profile fields use. */
function extensibleText(value: unknown): string | undefined {
  const texts = (value as { 'm.text'?: unknown } | null)?.['m.text']
  if (!Array.isArray(texts)) return undefined
  const plain = texts.find(item => !item?.mimetype || item.mimetype === 'text/plain') ?? texts[0]
  return asString(plain?.body)
}

type FieldValue = { text: string } | { json: string }

/** Readable value for an arbitrary profile field: text where there's text, else its JSON, so nothing is hidden. */
function describeField(value: unknown): FieldValue | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') return value.trim() ? { text: value } : undefined
  if (typeof value === 'number' || typeof value === 'boolean') return { text: String(value) }
  const text = extensibleText(value)
  if (text) return { text }
  if (Array.isArray(value)) {
    const parts = value.map(item => (typeof item === 'string' ? item : asString((item as { summary?: unknown } | null)?.summary) ?? extensibleText(item)))
    if (parts.length && parts.every(Boolean)) return { text: parts.join(', ') }
    if (!value.length) return undefined
  } else if (typeof value === 'object' && !Object.keys(value).length) {
    return undefined
  }
  return { json: JSON.stringify(value, null, 2) }
}

function localTime(timeZone: string, now: Date) {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone, hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(now)
  } catch {
    return undefined
  }
}

/** The current minute, updated as it turns, for clocks. */
function useMinute(enabled: boolean) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!enabled) return
    let interval: ReturnType<typeof setInterval> | undefined
    const timeout = setTimeout(() => {
      setNow(new Date())
      interval = setInterval(() => setNow(new Date()), 60_000)
    }, 60_000 - (Date.now() % 60_000))
    return () => {
      clearTimeout(timeout)
      clearInterval(interval)
    }
  }, [enabled])
  return now
}

/** Banners wider than this are shown whole; taller ones are cropped to it so the profile stays in view. */
const TALLEST_BANNER_RATIO = 4 / 3

/** The banner at the panel's full width, as tall as its proportions make it (placeholder 3:1 until it loads). */
function Banner({ mxc, userID, name }: { mxc?: string; userID: UserID; name: string }) {
  const url = mediaURL(mxc)
  const [failed, setFailed] = useState(false)
  const [ratio, setRatio] = useState<number | null>(null)
  if (!url || failed) {
    return (
      <div
        className="profile-banner aspect-[3/1] max-h-40 w-full"
        style={{ background: `linear-gradient(135deg, var(--user-color-${userColorIndex(userID)}), var(--surface-2))` }}
      />
    )
  }
  return (
    <button
      type="button"
      title="View banner"
      onClick={() => openLightbox(url, `${name} banner`)}
      className="profile-banner block w-full overflow-hidden bg-surface-2"
      style={{ aspectRatio: ratio ? Math.max(ratio, 1 / TALLEST_BANNER_RATIO) : 3 }}
    >
      <img
        src={url}
        alt=""
        onLoad={e => {
          const img = e.currentTarget
          if (img.naturalWidth && img.naturalHeight) setRatio(img.naturalWidth / img.naturalHeight)
        }}
        onError={() => setFailed(true)}
        className="size-full object-cover"
      />
    </button>
  )
}

/** Sized by --profile-avatar-size, which grows with the panel's width. */
function LargeAvatar({ mxc, userID, name }: { mxc?: string; userID: UserID; name: string }) {
  const url = mediaURL(mxc)
  const [failed, setFailed] = useState(false)
  if (!url || failed) {
    const letter = Array.from(name.replace(/^[@#!+]/, ''))[0]?.toUpperCase() ?? '?'
    return (
      <div
        aria-hidden
        className="user-avatar grid size-[var(--profile-avatar-size)] place-items-center font-semibold ring-4 ring-[var(--drawer-bg)]"
        style={{ background: `var(--user-color-${userColorIndex(userID)})`, color: 'var(--bg)', fontSize: 'calc(var(--profile-avatar-size) * 0.42)' }}
      >
        {letter}
      </div>
    )
  }
  return (
    <button type="button" title="View avatar" onClick={() => openLightbox(url, `${name} avatar`)} className="block rounded-full">
      <img
        src={url}
        alt=""
        onError={() => setFailed(true)}
        className="user-avatar size-[var(--profile-avatar-size)] bg-surface-2 object-cover ring-4 ring-[var(--drawer-bg)]"
      />
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
      <div className="profile-ignore">
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
      </div>
    )
  }

  return (
    <div className="profile-ignore">
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
    </div>
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
  const pronouns = pronounsOf(profile).map(set => set.summary)
  const status = statusOf(profile)
  const timeZone = timeZoneOf(profile)
  const now = useMinute(!!timeZone)
  const time = timeZone ? localTime(timeZone, now) : undefined
  const level = userPowerLevel(powerLevels, createEvent, userID)
  const role = roleForLevel(level)
  const extras = Object.entries(profile)
    .filter(([key]) => !KNOWN_FIELDS.has(key))
    .map(([key, value]) => [key, describeField(value)] as const)
    .filter((field): field is readonly [string, FieldValue] => !!field[1])
  const membership = member?.membership
  const isSelf = useChat(selectOwnUserID) === userID
  const [showSource, setShowSource] = useState(false)
  const [editing, setEditing] = useState(false)

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
      {/* The avatar grows with the panel: 88px at the narrowest, up to 176px. */}
      <div className="user-profile @container min-h-0 flex-1 overflow-y-auto pb-6 [--profile-avatar-size:clamp(88px,34cqw,176px)]">
        <Banner mxc={asString(profile['chat.commet.profile_banner'])} userID={userID} name={name} />
        <div className="relative px-4">
          <div className="-mt-[calc(var(--profile-avatar-size)/2)] flex items-end gap-2">
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

        <div className="flex flex-col gap-4 px-4 pt-3">
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

          {editing && entry?.profile ? (
            <ProfileEditor userID={userID} profile={entry.profile} onDone={() => setEditing(false)} />
          ) : (pronouns.length > 0 || !!status || !!time || level > 0 || isSelf) && (
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
              {status && (
                <span className="profile-status rounded-full bg-surface-2 px-2 py-0.5">{[status.emoji, status.text].filter(Boolean).join(' ')}</span>
              )}
              {time && (
                <span className="profile-time flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5" title={`Local time in ${timeZone}`}>
                  <Clock size={11} /> {time} · {timeZone?.replaceAll('_', ' ')}
                </span>
              )}
              {isSelf && entry?.profile && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="profile-edit flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-muted transition-colors hover:border-accent/60 hover:text-fg"
                >
                  <Pencil size={11} /> {pronouns.length || status || timeZone ? 'Edit pronouns, status & time zone' : 'Add pronouns, status & time zone'}
                </button>
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
                    {'text' in value ? (
                      <dd className="whitespace-pre-wrap break-words">{value.text}</dd>
                    ) : (
                      <dd>
                        <pre className="overflow-x-auto rounded-md bg-[var(--code-bg)] p-2 font-mono text-[11px] leading-relaxed">{value.json}</pre>
                      </dd>
                    )}
                  </div>
                ))}
              </dl>
            </section>
          )}

          <UserActions roomID={roomID} userID={userID} name={name}>
            {!isSelf && <IgnoreSection userID={userID} name={name} />}
          </UserActions>

          {!isSelf && <SharedRoomsSection userID={userID} />}

          <section className="profile-sources flex flex-wrap gap-1.5 border-t border-border pt-4">
            {entry?.profile && (
              <button
                type="button"
                onClick={() => setShowSource(shown => !shown)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-fg"
              >
                <Braces size={12} /> {showSource ? 'Hide' : 'View'} global profile
              </button>
            )}
            {member && (
              <button
                type="button"
                onClick={() => openStateExplorer(roomID, { type: 'm.room.member', stateKey: userID })}
                className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-fg"
              >
                <Braces size={12} /> Member event
              </button>
            )}
            {showSource && entry?.profile && (
              <pre className="mt-1 w-full overflow-x-auto rounded-md bg-[var(--code-bg)] p-2 font-mono text-[11px] leading-relaxed">
                {JSON.stringify(entry.profile, null, 2)}
              </pre>
            )}
          </section>

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
