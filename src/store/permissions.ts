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
