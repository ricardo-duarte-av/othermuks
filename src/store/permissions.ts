// Actions gated by room power levels (rules from gomuks web's message menu).
import type { UserID } from '@/api/types'
import { selectOwnUserID, useChat } from './chat'
import type { TimelineEvent } from './events'
import { useRoomPowerContext } from './hooks'
import { eventPowerLevel, userPowerLevel, type PowerLevelsContent } from './power'

/**
 * Deleting needs the level for sending redactions; deleting someone else's message also needs the
 * room's `redact` level (50 by default), i.e. moderator rights.
 */
export function canRedactEvent(
  powerLevels: PowerLevelsContent | undefined,
  createEvent: TimelineEvent | undefined,
  ownUserID: UserID | undefined,
  sender: UserID,
): boolean {
  if (!ownUserID) return false
  const own = userPowerLevel(powerLevels, createEvent, ownUserID)
  if (own < eventPowerLevel(powerLevels, 'm.room.redaction')) return false
  if (sender === ownUserID) return true
  const redactOthers = typeof powerLevels?.redact === 'number' ? powerLevels.redact : 50
  return own >= redactOthers
}

export function useCanRedact(roomID: string, sender: UserID): boolean {
  const { powerLevels, createEvent } = useRoomPowerContext(roomID)
  const ownUserID = useChat(selectOwnUserID)
  return canRedactEvent(powerLevels, createEvent, ownUserID, sender)
}

/**
 * Whether messages can be sent at all. In an encrypted room the server checks the level for
 * m.room.encrypted, the type messages go out as, rather than m.room.message. Until the room's power
 * levels are known this says yes: blocking on missing state would lock people out of rooms that
 * simply haven't loaded it yet.
 */
export function canSendMessages(
  powerLevels: PowerLevelsContent | undefined,
  createEvent: TimelineEvent | undefined,
  ownUserID: UserID | undefined,
  encrypted: boolean,
): boolean {
  if (!powerLevels || !ownUserID) return true
  const own = userPowerLevel(powerLevels, createEvent, ownUserID)
  return own >= eventPowerLevel(powerLevels, encrypted ? 'm.room.encrypted' : 'm.room.message')
}

export function useCanSendMessages(roomID: string): boolean {
  const { powerLevels, createEvent } = useRoomPowerContext(roomID)
  const ownUserID = useChat(selectOwnUserID)
  const encrypted = useChat(s => !!s.rooms[roomID]?.meta.encryption_event)
  return canSendMessages(powerLevels, createEvent, ownUserID, encrypted)
}
