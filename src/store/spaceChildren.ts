// A space's rooms, as the space itself lists them: m.space.child state events keyed by the child's
// room ID, whose content carries the servers to join through. gomuks's space_edges also count rooms
// that only name the space as their parent; those can't be taken out from the space's side, so the
// editor works from the child events alone.
import { client } from '@/api/client'
import type { RoomID, UserID } from '@/api/types'
import { selectOwnUserID, useChat, type ChatSnapshot } from './chat'
import { eventPowerLevel, userPowerLevel, type PowerLevelsContent } from './power'

export const SPACE_CHILD_TYPE = 'm.space.child'

/** Rooms the space lists. An event with no via is a removed child (the spec's way to delete one). */
export function spaceChildIDs(s: ChatSnapshot, spaceID: RoomID): RoomID[] {
  const children = s.rooms[spaceID]?.state[SPACE_CHILD_TYPE] ?? {}
  return Object.entries(children)
    .filter(([, rowid]) => {
      const via = s.events[rowid]?.content.via
      return Array.isArray(via) && via.length > 0
    })
    .map(([childID]) => childID)
}

/** Whether the user may add or remove the space's rooms: the level to send m.space.child state. */
export function canEditSpaceChildren(s: ChatSnapshot, spaceID: RoomID): boolean {
  const room = s.rooms[spaceID]
  const ownUserID = selectOwnUserID(s)
  if (!room || !ownUserID) return false
  const plRowid = room.state['m.room.power_levels']?.['']
  const createRowid = room.state['m.room.create']?.['']
  const powerLevels = plRowid === undefined ? undefined : (s.events[plRowid]?.content as PowerLevelsContent | undefined)
  const createEvent = createRowid === undefined ? undefined : s.events[createRowid]
  return userPowerLevel(powerLevels, createEvent, ownUserID) >= eventPowerLevel(powerLevels, SPACE_CHILD_TYPE, true)
}

const serverOf = (id: string) => (id.includes(':') ? id.slice(id.indexOf(':') + 1) : undefined)

/**
 * Lists a room in the space. via names servers others can join it through: the one in its ID, when
 * the room version still has one, and ours, since we're in it.
 */
export function addSpaceChild(spaceID: RoomID, childID: RoomID) {
  const ownUserID = selectOwnUserID(useChat.getState()) as UserID
  const via = [...new Set([serverOf(childID), serverOf(ownUserID)].filter((server): server is string => !!server))]
  return client.setState(spaceID, SPACE_CHILD_TYPE, childID, { via })
}

/** Takes a room out of the space: an empty child event is how the spec removes one. */
export function removeSpaceChild(spaceID: RoomID, childID: RoomID) {
  return client.setState(spaceID, SPACE_CHILD_TYPE, childID, {})
}
