import { useShallow } from 'zustand/react/shallow'
import type { EventRowID, MemberEventContent, RoomID, UserID } from '@/api/types'
import { useChat } from './chat'

export function useMember(roomID: RoomID, userID: UserID | undefined): MemberEventContent | undefined {
  return useChat(s => {
    if (!userID) return undefined
    const rowid = s.rooms[roomID]?.state['m.room.member']?.[userID]
    return rowid === undefined ? undefined : (s.events[rowid]?.content as unknown as MemberEventContent | undefined)
  })
}

export function useEvent(rowid: EventRowID | null | undefined) {
  return useChat(s => (rowid == null ? undefined : s.events[rowid]))
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
