// Global Matrix profiles (get_profile), cached per user. Per-room names/avatars come from room state instead.
import { create } from 'zustand'
import { client } from '@/api/client'
import type { GetProfileResponse, UserID } from '@/api/types'

export interface ProfileEntry {
  loading: boolean
  profile?: GetProfileResponse['profile']
  bio?: GetProfileResponse['bio']
  error?: string
  fetchedAt?: number
}

export const useProfiles = create<{ profiles: Record<UserID, ProfileEntry> }>()(() => ({ profiles: {} }))

function patch(userID: UserID, entry: Partial<ProfileEntry>) {
  useProfiles.setState(s => ({ profiles: { ...s.profiles, [userID]: { ...(s.profiles[userID] ?? { loading: false }), ...entry } } }))
}

const FRESH_MS = 30_000

export async function loadProfile(userID: UserID, force = false) {
  const current = useProfiles.getState().profiles[userID]
  if (current?.loading) return
  if (!force && current?.fetchedAt && Date.now() - current.fetchedAt < FRESH_MS) return
  patch(userID, { loading: true, error: undefined })
  try {
    const resp = await client.exec<GetProfileResponse>('get_profile', { user_id: userID })
    patch(userID, { loading: false, profile: resp.profile, bio: resp.bio, fetchedAt: Date.now() })
  } catch (err) {
    patch(userID, { loading: false, error: err instanceof Error ? err.message : String(err) })
  }
}

// ---- Profile fields othermuks shows and edits ----

/** Status keys (MSC4426), stable first: the stable one wins when several are set. */
export const STATUS_KEYS = ['m.status', 'org.matrix.msc4426.status', 'org.msc.4426.status'] as const
/** Time zone keys (MSC4175), stable first. */
export const TIMEZONE_KEYS = ['m.tz', 'us.cloke.msc4175.tz'] as const
export const PRONOUNS_KEY = 'io.fsky.nyx.pronouns'

type Profile = Record<string, unknown>

const asString = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined)

export interface PronounSet {
  summary: string
  language?: string
  grammatical_gender?: string
}

export function pronounsOf(profile: Profile): PronounSet[] {
  const value = profile[PRONOUNS_KEY]
  if (!Array.isArray(value)) return []
  return value.filter((set): set is PronounSet => !!asString((set as { summary?: unknown } | null)?.summary))
}

export function statusOf(profile: Profile): { emoji?: string; text?: string } | undefined {
  for (const key of STATUS_KEYS) {
    const raw = profile[key] as { emoji?: unknown; text?: unknown } | null | undefined
    if (!raw || typeof raw !== 'object') continue
    const emoji = asString(raw.emoji)
    const text = asString(raw.text)
    if (emoji || text) return { emoji, text }
  }
  return undefined
}

export function timeZoneOf(profile: Profile): string | undefined {
  for (const key of TIMEZONE_KEYS) {
    const tz = asString(profile[key])
    if (tz) return tz
  }
  return undefined
}

/** The common English sets, with the grammatical gender gomuks web gives them. */
export const PRONOUN_PRESETS: PronounSet[] = [
  { summary: 'they/them', language: 'en', grammatical_gender: 'neuter' },
  { summary: 'she/her', language: 'en', grammatical_gender: 'feminine' },
  { summary: 'he/him', language: 'en', grammatical_gender: 'masculine' },
  { summary: 'it/its', language: 'en', grammatical_gender: 'inanimate' },
]

/**
 * Writes a value under a field's stable key, and under any other key for the same field the profile
 * already has, so clients reading an unstable key don't keep showing the old value. Clearing deletes all
 * of them.
 */
async function setFieldEverywhere(profile: Profile, keys: readonly string[], value: unknown) {
  const targets = keys.filter((key, index) => index === 0 || key in profile)
  for (const key of targets) {
    if (value === undefined && !(key in profile)) continue
    await client.setProfileField(key, value)
  }
}

export interface OwnProfileEdit {
  /** Free-form summaries, e.g. "she/they"; empty clears them. */
  pronouns: string[]
  status: { emoji: string; text: string }
  timeZone: string
}

/** Saves the fields that changed, then reloads the profile. */
export async function saveOwnProfile(userID: UserID, profile: Profile, edit: OwnProfileEdit) {
  const pronouns = edit.pronouns.map(p => p.trim()).filter(Boolean)
  const current = pronounsOf(profile).map(set => set.summary)
  if (pronouns.join('\n') !== current.join('\n')) {
    const sets = pronouns.map(summary => PRONOUN_PRESETS.find(preset => preset.summary === summary) ?? { summary, language: 'en' })
    if (sets.length) await client.setProfileField(PRONOUNS_KEY, sets)
    else if (PRONOUNS_KEY in profile) await client.setProfileField(PRONOUNS_KEY)
  }

  const emoji = edit.status.emoji.trim()
  const text = edit.status.text.trim()
  const status = statusOf(profile)
  if (emoji !== (status?.emoji ?? '') || text !== (status?.text ?? '')) {
    await setFieldEverywhere(profile, STATUS_KEYS, emoji || text ? { emoji, text } : undefined)
  }

  const timeZone = edit.timeZone.trim()
  if (timeZone !== (timeZoneOf(profile) ?? '')) {
    await setFieldEverywhere(profile, TIMEZONE_KEYS, timeZone || undefined)
  }
  await loadProfile(userID, true)
}
