// Pinned messages (m.room.pinned_events), following gomuks web: the state event's `pinned` list holds
// event IDs, oldest pin first. Pinning needs the power level for sending that state event.
import { useMemo } from 'react'
import { client } from '@/api/client'
import type { EventID, RoomID } from '@/api/types'
import { selectOwnUserID, useChat, type ChatSnapshot } from './chat'
import { useRoomPowerContext } from './hooks'
import { eventPowerLevel, userPowerLevel, type PowerLevelsContent } from './power'
import type { TimelineEvent } from './events'

export const PINNED_EVENTS_TYPE = 'm.room.pinned_events'

const NO_PINS: EventID[] = []

function pinnedContent(chat: ChatSnapshot, roomID: RoomID): Record<string, unknown> | undefined {
  const rowid = chat.rooms[roomID]?.state[PINNED_EVENTS_TYPE]?.['']
  return rowid === undefined ? undefined : chat.events[rowid]?.content
}

export function pinnedList(content: Record<string, unknown> | undefined): EventID[] {
  const list = content?.pinned
  return Array.isArray(list) ? list.filter((id): id is EventID => typeof id === 'string' && id.startsWith('$')) : NO_PINS
}

export const pinnedEventIDs = (chat: ChatSnapshot, roomID: RoomID) => pinnedList(pinnedContent(chat, roomID))

/** The room's pinned event IDs, oldest pin first. */
export function usePinnedEvents(roomID: RoomID): EventID[] {
  const content = useChat(s => pinnedContent(s, roomID))
  return useMemo(() => pinnedList(content), [content])
}

export function useIsPinned(roomID: RoomID, eventID: EventID): boolean {
  return useChat(s => pinnedEventIDs(s, roomID).includes(eventID))
}

export function canPin(powerLevels: PowerLevelsContent | undefined, createEvent: TimelineEvent | undefined, userID: string | undefined): boolean {
  return !!userID && userPowerLevel(powerLevels, createEvent, userID) >= eventPowerLevel(powerLevels, PINNED_EVENTS_TYPE, true)
}

/** Whether the room's power levels let this user pin and unpin messages. */
export function useCanPin(roomID: RoomID): boolean {
  const { powerLevels, createEvent } = useRoomPowerContext(roomID)
  const ownUserID = useChat(selectOwnUserID)
  return canPin(powerLevels, createEvent, ownUserID)
}

/** Adds or removes a pin, keeping the rest of the state event's content. */
export async function setPinned(roomID: RoomID, eventID: EventID, pinned: boolean) {
  const chat = useChat.getState()
  const content = pinnedContent(chat, roomID)
  const current = pinnedList(content)
  if (current.includes(eventID) === pinned) return
  const next = pinned ? [...current, eventID] : current.filter(id => id !== eventID)
  await client.setState(roomID, PINNED_EVENTS_TYPE, '', { ...content, pinned: next })
}
