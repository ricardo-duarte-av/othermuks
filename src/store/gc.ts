// Keeps memory bounded over long sessions. Every sync adds events to the store, for rooms that were never
// opened as much as for the open one, and a room's timeline and member list only ever grow. So, like
// gomuks web's garbage collection, rooms not among the most recently opened are emptied every so often
// (see collectRooms) and paginated again when next opened.
import type { RoomID } from '@/api/types'
import { log } from '@/lib/log'
import { collectRooms, useChat } from './chat'
import { useEventContext } from './navigation'
import { useUI } from './ui'

/** How many of the most recently opened rooms (the open one among them) keep what they loaded. */
const KEEP_RECENT = 10
const INTERVAL = 10 * 60_000

/** Rooms opened this session, least recently opened first. */
const recentlyOpened = new Set<RoomID>()

useUI.subscribe((state, prev) => {
  const roomID = state.activeRoomID
  if (!roomID || roomID === prev.activeRoomID) return
  recentlyOpened.delete(roomID)
  recentlyOpened.add(roomID)
})

/** Rooms something outside the timeline still needs whole, e.g. a running widget fed their events. */
const keepers = new Set<() => Iterable<RoomID>>()

export function keepRoomsWhile(roomIDs: () => Iterable<RoomID>) {
  keepers.add(roomIDs)
}

/** Empties every room not in use or recently opened. Returns what was dropped, or null when it can't run now. */
export function collectGarbage() {
  const ui = useUI.getState()
  // These list events from any room by rowid; dropping them would blank the list under the user.
  if (ui.roomTool === 'search' || ui.roomTool === 'mentions') return null

  const keep = new Set<RoomID>()
  if (ui.activeRoomID) keep.add(ui.activeRoomID)
  const context = useEventContext.getState().view
  if (context) keep.add(context.roomID)
  for (const roomIDs of keepers) for (const roomID of roomIDs()) keep.add(roomID)
  for (const roomID of [...recentlyOpened].slice(-KEEP_RECENT)) keep.add(roomID)

  const s = useChat.getState()
  const collect = new Set<RoomID>()
  for (const [roomID, room] of Object.entries(s.rooms)) {
    if (keep.has(roomID)) continue
    // Nothing loaded beyond what the room list shows: leave it as it is.
    if (!room.timeline.length && !room.membersLoaded) continue
    collect.add(roomID)
  }
  for (const roomID of recentlyOpened) if (!s.rooms[roomID]) recentlyOpened.delete(roomID)

  const started = performance.now()
  const before = Object.keys(s.events).length
  const stats = collectRooms(collect)
  log.info(
    `gc: emptied ${stats.rooms} rooms, dropped ${stats.events} of ${before} events and ${stats.members} member events in ${Math.round(performance.now() - started)} ms`,
  )
  return stats
}

let timer: ReturnType<typeof setInterval> | null = null

export function startGarbageCollection() {
  timer ??= setInterval(collectGarbage, INTERVAL)
}
