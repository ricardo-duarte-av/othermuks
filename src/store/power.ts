// Room power levels, following gomuks web's util/powerlevel.ts.
import type { UserID } from '@/api/types'
import type { TimelineEvent } from './events'

/** Room versions before 12 don't give room creators an implicit infinite power level. */
const PRE_V12_ROOM_VERSIONS = new Set<string | undefined>([undefined, '', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'])

export interface PowerLevelsContent {
  users?: Record<UserID, number>
  users_default?: number
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
