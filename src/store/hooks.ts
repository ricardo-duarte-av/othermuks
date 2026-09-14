import { useShallow } from 'zustand/react/shallow'
import type { EventRowID, MemberEventContent, RoomID, UserID } from '@/api/types'
import { useChat } from './chat'
import { displayNameOf } from './events'
import type { PowerLevelsContent } from './power'

export function useMember(roomID: RoomID, userID: UserID | undefined): MemberEventContent | undefined {
  return useChat(s => {
    if (!userID) return undefined
    const rowid = s.rooms[roomID]?.state['m.room.member']?.[userID]
    return rowid === undefined ? undefined : (s.events[rowid]?.content as unknown as MemberEventContent | undefined)
  })
}

/** Per-room display name, falling back to the capitalized localpart. */
export function useDisplayName(roomID: RoomID, userID: UserID | undefined): string {
  const member = useMember(roomID, userID)
  return userID ? displayNameOf(userID, member) : ''
}

export function useEvent(rowid: EventRowID | null | undefined) {
  return useChat(s => (rowid == null ? undefined : s.events[rowid]))
}

/** The room's power levels content and create event, needed to work out each user's power level. */
export function useRoomPowerContext(roomID: RoomID) {
  const powerLevels = useChat(s => {
    const rowid = s.rooms[roomID]?.state['m.room.power_levels']?.['']
    return rowid === undefined ? undefined : (s.events[rowid]?.content as PowerLevelsContent | undefined)
  })
  const createEvent = useChat(s => {
    const rowid = s.rooms[roomID]?.state['m.room.create']?.['']
    return rowid === undefined ? undefined : s.events[rowid]
  })
  return { powerLevels, createEvent }
}

const NO_USERS: UserID[] = []

export function useJoinedMembers(roomID: RoomID): UserID[] {
  return useChat(
    useShallow(s => {
      const members = s.rooms[roomID]?.state['m.room.member']
      if (!members) return NO_USERS
      const joined: UserID[] = []
      for (const [userID, rowid] of Object.entries(members)) {
        if (s.events[rowid]?.content.membership === 'join') joined.push(userID)
      }
      return joined
    }),
  )
}
