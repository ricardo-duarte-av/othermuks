// Room list actions: mark read, favourite / low priority tags, mute and leave.
// Behaviour follows gomuks web's RoomMenu.
import { create } from 'zustand'
import { client } from '@/api/client'
import type { RoomID } from '@/api/types'
import { latestReadEvent, markRoomRead, useChat, type ChatSnapshot } from './chat'
import { showToast } from './ui'

export const FAVOURITE_TAG = 'm.favourite'
export const LOW_PRIORITY_TAG = 'm.lowpriority'

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))
const failed = (what: string) => (err: unknown) => showToast(`Couldn't ${what}: ${errorText(err)}`)

export function roomTagsOf(s: ChatSnapshot, roomID: RoomID): Record<string, unknown> {
  const tags = (s.rooms[roomID]?.accountData['m.tag']?.content as { tags?: unknown } | undefined)?.tags
  return tags && typeof tags === 'object' ? (tags as Record<string, unknown>) : {}
}

/** A room is muted when its room push rule is enabled and doesn't notify. */
export function isRoomMuted(s: ChatSnapshot, roomID: RoomID): boolean {
  const rules = (s.accountData['m.push_rules']?.content as { global?: { room?: unknown } } | undefined)?.global?.room
  if (!Array.isArray(rules)) return false
  const rule = rules.find(r => (r as { rule_id?: unknown } | null)?.rule_id === roomID) as
    | { enabled?: unknown; actions?: unknown }
    | undefined
  return rule?.enabled === true && !(Array.isArray(rule.actions) && rule.actions.includes('notify'))
}

export function isRoomUnread(s: ChatSnapshot, roomID: RoomID): boolean {
  const meta = s.rooms[roomID]?.meta
  return !!meta && (meta.unread_messages > 0 || meta.unread_notifications > 0 || meta.unread_highlights > 0 || meta.marked_unread)
}

export function markRoomAsRead(roomID: RoomID) {
  const evt = latestReadEvent(roomID)
  if (evt) markRoomRead(roomID, evt, true)
  else showToast("Can't mark the room as read: no events are loaded for it")
  if (useChat.getState().rooms[roomID]?.meta.marked_unread) {
    client.setAccountData('m.marked_unread', { unread: false }, roomID).catch(failed('clear the unread mark'))
  }
}

/** Favourite and low priority exclude each other, like other Matrix clients. */
export function toggleRoomTag(roomID: RoomID, tag: typeof FAVOURITE_TAG | typeof LOW_PRIORITY_TAG) {
  const tags = { ...roomTagsOf(useChat.getState(), roomID) }
  const tagged = tag in tags
  if (tagged) {
    delete tags[tag]
  } else {
    tags[tag] = {}
    delete tags[tag === FAVOURITE_TAG ? LOW_PRIORITY_TAG : FAVOURITE_TAG]
  }
  const what = tag === FAVOURITE_TAG ? 'favourites' : 'low priority'
  client.setAccountData('m.tag', { tags }, roomID).catch(failed(tagged ? `remove the room from ${what}` : `add the room to ${what}`))
}

export function toggleRoomMute(roomID: RoomID) {
  const muted = isRoomMuted(useChat.getState(), roomID)
  client.muteRoom(roomID, !muted).catch(failed(muted ? 'unmute the room' : 'mute the room'))
}

/** Which room the leave confirmation is open for. */
export const useLeaveRoomDialog = create<{ roomID: RoomID | null }>()(() => ({ roomID: null }))

export function requestLeaveRoom(roomID: RoomID) {
  useLeaveRoomDialog.setState({ roomID })
}

export async function leaveRoom(roomID: RoomID, reason?: string) {
  await client.leaveRoom(roomID, reason || undefined)
}
