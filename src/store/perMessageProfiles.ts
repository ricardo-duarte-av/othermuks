// Stored per-message profiles (MSC4461): personas the user can send as, kept in account data, globally
// and per room. gomuks does the sending itself: send_message matches the triggers against the text,
// falls back to the default profile, and adds the fallbacks. This module reads and edits the lists,
// and mirrors gomuks's pick (mautrix's PickPerMessageProfile) so the composer can show who a message
// will go out as before it's sent.
import { client } from '@/api/client'
import type { ContentURI, RoomID } from '@/api/types'
import { useChat, type ChatSnapshot } from './chat'

/** The unstable type (v3: an array of profiles with prefix/suffix triggers). */
export const PER_MESSAGE_PROFILES_TYPE = 'fi.mau.msc4461.per_message_profiles.v3'

export interface ProfileTrigger {
  prefix?: string
  suffix?: string
  /** Send the prefix and suffix along instead of cutting them off. */
  keep_trigger?: boolean
}

/** A stored profile. Unknown fields are kept as they are, since gomuks copies them into messages. */
export interface StoredProfile {
  id: string
  displayname?: string
  avatar_url?: ContentURI
  triggers?: ProfileTrigger[]
  [key: string]: unknown
}

export interface StoredProfiles {
  /** null or absent: no opinion (a room defers to the global one). "": no default, even over a global one. */
  default_profile_id?: string | null
  profiles: StoredProfile[]
  [key: string]: unknown
}

const EMPTY: StoredProfiles = { profiles: [] }

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

function parse(content: Record<string, unknown> | undefined): StoredProfiles {
  if (!content) return EMPTY
  const profiles = Array.isArray(content.profiles)
    ? content.profiles.filter((p): p is StoredProfile => isObject(p) && typeof p.id === 'string' && !!p.id)
    : []
  const defaultID = content.default_profile_id
  return { ...content, profiles, default_profile_id: typeof defaultID === 'string' ? defaultID : null }
}

// Parsed once per account data object, so selectors hand back the same object until it changes.
const parsed = new WeakMap<object, StoredProfiles>()
function cached(content: Record<string, unknown> | undefined): StoredProfiles {
  if (!content) return EMPTY
  let value = parsed.get(content)
  if (!value) parsed.set(content, (value = parse(content)))
  return value
}

export const globalProfilesOf = (s: ChatSnapshot) => cached(s.accountData[PER_MESSAGE_PROFILES_TYPE]?.content)
export const roomProfilesOf = (s: ChatSnapshot, roomID: RoomID) => cached(s.rooms[roomID]?.accountData[PER_MESSAGE_PROFILES_TYPE]?.content)

export const useGlobalProfiles = () => useChat(globalProfilesOf)
export const useRoomProfiles = (roomID: RoomID) => useChat(s => roomProfilesOf(s, roomID))

export interface ProfilePick {
  profile: StoredProfile
  /** The trigger that picked it; absent when it's the default. */
  trigger?: ProfileTrigger
}

function matchTrigger(profiles: StoredProfiles, text: string): ProfilePick | undefined {
  for (const profile of profiles.profiles) {
    for (const trigger of profile.triggers ?? []) {
      const prefix = trigger.prefix ?? ''
      const suffix = trigger.suffix ?? ''
      if (text.length >= prefix.length + suffix.length && text.startsWith(prefix) && text.endsWith(suffix)) return { profile, trigger }
    }
  }
  return undefined
}

/**
 * The room's default profile ID, else the global one: null when neither names one, and "" when the
 * room turns the global default off.
 */
export function effectiveDefaultID(global: StoredProfiles, room: StoredProfiles): string | null {
  return room.default_profile_id ?? global.default_profile_id ?? null
}

/** The profile gomuks will send `text` as: a room trigger, a global trigger, then the default. */
export function pickProfile(global: StoredProfiles, room: StoredProfiles, text: string): ProfilePick | undefined {
  const triggered = matchTrigger(room, text) ?? matchTrigger(global, text)
  if (triggered) return triggered
  const defaultID = effectiveDefaultID(global, room)
  if (!defaultID) return undefined
  const profile = room.profiles.find(p => p.id === defaultID) ?? global.profiles.find(p => p.id === defaultID)
  return profile && { profile }
}

/** How a trigger reads to a person: `cat: …`, `… meow`, `meow … meow`. */
export function describeTrigger(trigger: ProfileTrigger): string {
  return `${trigger.prefix ?? ''}…${trigger.suffix ?? ''}`
}

/** Replaces the global list, keeping any fields this client doesn't know about. */
export function saveGlobalProfiles(update: (current: StoredProfiles) => StoredProfiles) {
  const current = globalProfilesOf(useChat.getState())
  return client.setAccountData(PER_MESSAGE_PROFILES_TYPE, update(current))
}

/**
 * Sets which profile the room sends as by default: an ID, "" for none (overriding a global default),
 * or null to follow the global default. Any profiles stored for the room are kept.
 */
export function setRoomDefaultProfile(roomID: RoomID, profileID: string | null) {
  const current = roomProfilesOf(useChat.getState(), roomID)
  return client.setAccountData(PER_MESSAGE_PROFILES_TYPE, { ...current, default_profile_id: profileID }, roomID)
}
