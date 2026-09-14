import { Clock, Copy, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { mediaURL, userColorIndex } from '@/api/media'
import type { RoomID, UserID } from '@/api/types'
import { fallbackDisplayName } from '@/store/events'
import { useMember } from '@/store/hooks'
import { loadProfile, useProfiles } from '@/store/profiles'
import { showToast, useUI } from '@/store/ui'
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

function Banner({ mxc, userID }: { mxc?: string; userID: UserID }) {
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
    <a href={url} target="_blank" rel="noopener noreferrer" title="Open banner at full size" className="profile-banner block h-28 w-full overflow-hidden bg-surface-2">
      <img src={url} alt="" onError={() => setFailed(true)} className="size-full object-cover" />
    </a>
  )
}

function LargeAvatar({ mxc, userID, name }: { mxc?: string; userID: UserID; name: string }) {
  const url = mediaURL(mxc)
  const [failed, setFailed] = useState(false)
  if (!url || failed) {
    return <Avatar id={userID} name={name} size={88} className="ring-4 ring-[var(--drawer-bg)]" />
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title="Open avatar at full size" className="block rounded-full">
      <img src={url} alt="" onError={() => setFailed(true)} className="user-avatar size-[88px] bg-surface-2 ring-4 ring-[var(--drawer-bg)]" />
    </a>
  )
}

function SectionTitle({ children }: { children: string }) {
  return <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{children}</h4>
}

export function UserProfilePanel({ roomID, userID }: { roomID: RoomID; userID: UserID }) {
  const member = useMember(roomID, userID)
  const entry = useProfiles(s => s.profiles[userID])

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
  const showGlobalAvatar = !!roomAvatar && !!globalAvatar && roomAvatar !== globalAvatar
  const pronouns = pronounsOf(profile['io.fsky.nyx.pronouns'])
  const status = statusOf(profile)
  const timeZone = asString(profile['m.tz'] ?? profile['us.cloke.msc4175.tz'])
  const time = timeZone ? localTime(timeZone) : undefined
  const extras = Object.entries(profile)
    .filter(([key]) => !KNOWN_FIELDS.has(key))
    .map(([key, value]) => [key, describeField(value)] as const)
    .filter((field): field is readonly [string, string] => !!field[1])
  const membership = member?.membership

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
          <Banner mxc={asString(profile['chat.commet.profile_banner'])} userID={userID} />
          <div className="absolute -bottom-11 left-4 flex items-end gap-2">
            <LargeAvatar key={avatar} mxc={avatar} userID={userID} name={name} />
            {showGlobalAvatar && (
              <a
                href={mediaURL(globalAvatar)}
                target="_blank"
                rel="noopener noreferrer"
                title="Global avatar (open at full size)"
                className="mb-1 flex items-center gap-1.5 rounded-full border border-border bg-surface py-0.5 pl-0.5 pr-2 text-[11px] text-muted transition-colors hover:text-fg"
              >
                <Avatar mxc={globalAvatar} id={userID} name={globalName ?? name} size={24} />
                Global
              </a>
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

          {(pronouns.length > 0 || !!status?.text || !!time) && (
            <div className="flex flex-wrap gap-1.5 text-xs">
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
