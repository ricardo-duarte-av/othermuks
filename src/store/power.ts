// Room power levels, following gomuks web's util/powerlevel.ts.
import type { UserID } from '@/api/types'
import type { TimelineEvent } from './events'

/** Room versions before 12 don't give room creators an implicit infinite power level. */
const PRE_V12_ROOM_VERSIONS = new Set<string | undefined>([undefined, '', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'])

export interface PowerLevelsContent {
  users?: Record<UserID, number>
  users_default?: number
  events?: Record<string, number>
  events_default?: number
  state_default?: number
  redact?: number
  invite?: number
  kick?: number
  ban?: number
}

/** Level needed to send an event type: its `events` entry, else state_default / events_default (like gomuks). */
export function eventPowerLevel(powerLevels: PowerLevelsContent | undefined, eventType: string, state = false): number {
  const specific = powerLevels?.events?.[eventType]
  if (typeof specific === 'number') return specific
  const fallback = state ? powerLevels?.state_default : powerLevels?.events_default
  return typeof fallback === 'number' ? fallback : state ? 50 : 0
}

export function userPowerLevel(
  powerLevels: PowerLevelsContent | undefined,
  createEvent: TimelineEvent | undefined,
  userID: UserID,
): number {
  const create = createEvent?.content as { room_version?: string; additional_creators?: UserID[] } | undefined
  if (
    createEvent &&
    create &&
    !PRE_V12_ROOM_VERSIONS.has(create.room_version) &&
    (createEvent.sender === userID || create.additional_creators?.includes(userID))
  ) {
    return Infinity
  }
  const level = powerLevels?.users?.[userID] ?? powerLevels?.users_default ?? 0
  return typeof level === 'number' ? level : Number(level) || 0
}

export type Role = 'creator' | 'admin' | 'moderator' | 'member'

export function roleForLevel(level: number): Role {
  if (level === Infinity) return 'creator'
  if (level >= 100) return 'admin'
  if (level >= 50) return 'moderator'
  return 'member'
}

export const ROLE_GROUP_LABELS: Record<Role, string> = {
  creator: 'Creators',
  admin: 'Admins',
  moderator: 'Moderators',
  member: 'Members',
}

export const ROLE_LABELS: Record<Role, string> = {
  creator: 'Room creator',
  admin: 'Admin',
  moderator: 'Moderator',
  member: 'Member',
}

/** One level that differs between two power level events. `undefined` is "not set", i.e. the default applies. */
export interface PowerLevelChange {
  from: number | undefined
  to: number | undefined
}

export interface PowerLevelsDiff {
  users: (PowerLevelChange & { userID: UserID })[]
  /** The room-wide thresholds, labelled for people. */
  settings: (PowerLevelChange & { label: string })[]
  /** Per-event-type overrides. */
  events: (PowerLevelChange & { eventType: string })[]
}

/** The room-wide thresholds a power level event carries, in the order they're listed. */
const POWER_SETTINGS: [label: string, get: (content: PowerLevelsContent) => unknown][] = [
  ['Default level for everyone', c => c.users_default],
  ['Send messages', c => c.events_default],
  ['Change room settings', c => c.state_default],
  ['Invite people', c => c.invite],
  ['Remove people', c => c.kick],
  ['Ban people', c => c.ban],
  ["Delete others' messages", c => c.redact],
  ['Notify the whole room', c => (c as { notifications?: { room?: unknown } }).notifications?.room],
]

const levelOf = (value: unknown) => (typeof value === 'number' ? value : undefined)

/**
 * What a power level event changed. A user's level is their entry, else users_default, so a user
 * whose entry is dropped shows the default they fall back to; users_default itself is listed as a
 * setting, since it moves everyone without an entry at once.
 */
export function diffPowerLevels(prev: PowerLevelsContent | undefined, next: PowerLevelsContent): PowerLevelsDiff {
  const before = prev ?? {}
  const userLevel = (content: PowerLevelsContent, userID: UserID) => levelOf(content.users?.[userID]) ?? levelOf(content.users_default) ?? 0
  const userIDs = new Set([...Object.keys(before.users ?? {}), ...Object.keys(next.users ?? {})])
  const users = [...userIDs]
    .map(userID => ({ userID, from: prev ? userLevel(before, userID) : undefined, to: userLevel(next, userID) }))
    .filter(change => change.from !== change.to)
    // Biggest promotions and demotions first.
    .sort((a, b) => Math.abs((b.to ?? 0) - (b.from ?? 0)) - Math.abs((a.to ?? 0) - (a.from ?? 0)))
  const settings = POWER_SETTINGS.map(([label, get]) => ({ label, from: levelOf(get(before)), to: levelOf(get(next)) })).filter(
    change => change.from !== change.to,
  )
  const eventTypes = new Set([...Object.keys(before.events ?? {}), ...Object.keys(next.events ?? {})])
  const events = [...eventTypes]
    .sort()
    .map(eventType => ({ eventType, from: levelOf(before.events?.[eventType]), to: levelOf(next.events?.[eventType]) }))
    .filter(change => change.from !== change.to)
  return { users, settings, events }
}

export const powerLevelChangeCount = (diff: PowerLevelsDiff) => diff.users.length + diff.settings.length + diff.events.length
