// Space filtering for the room list, modelled on gomuks web's SpaceEdgeStore:
// a space contains its child rooms plus, recursively, the rooms of its child spaces.
import type { DBSpaceEdge, RoomID } from '@/api/types'
import type { RoomData } from './chat'

export const HOME_SPACE = 'othermuks.home'
export const DM_SPACE = 'othermuks.direct'

interface SpaceSource {
  rooms: Record<RoomID, RoomData>
  roomOrder: RoomID[]
  spaceEdges: Record<RoomID, DBSpaceEdge[]>
}

const isSpace = (src: SpaceSource, roomID: RoomID) =>
  roomID in src.spaceEdges || src.rooms[roomID]?.meta.creation_content?.type === 'm.space'

function collectRooms(src: SpaceSource, spaceID: RoomID, out: Set<RoomID>, seen: Set<RoomID>) {
  if (seen.has(spaceID)) return
  seen.add(spaceID)
  for (const edge of src.spaceEdges[spaceID] ?? []) {
    if (isSpace(src, edge.child_id)) collectRooms(src, edge.child_id, out, seen)
    else out.add(edge.child_id)
  }
}

let flattenedCache = { edges: null as SpaceSource['spaceEdges'] | null, bySpace: new Map<RoomID, Set<RoomID>>() }

export function flattenedRooms(src: SpaceSource, spaceID: RoomID): Set<RoomID> {
  if (flattenedCache.edges !== src.spaceEdges) flattenedCache = { edges: src.spaceEdges, bySpace: new Map() }
  let rooms = flattenedCache.bySpace.get(spaceID)
  if (!rooms) {
    rooms = new Set()
    collectRooms(src, spaceID, rooms, new Set())
    flattenedCache.bySpace.set(spaceID, rooms)
  }
  return rooms
}

/** Row keys for the room list: "r:<roomID>" for rooms and "h:<spaceID>" for sub-space section headers. */
export type RoomListRow = `r:${string}` | `h:${string}`

const roomRow = (roomID: RoomID): RoomListRow => `r:${roomID}`

let rowsCache: { order: RoomID[]; edges: SpaceSource['spaceEdges']; spaceID: string; rows: RoomListRow[] } | null = null

/** A space's direct rooms first, then one section per sub-space (nested spaces flattened into it). */
export function spaceListRows(src: SpaceSource, spaceID: string): RoomListRow[] {
  const cached = rowsCache
  if (cached && cached.order === src.roomOrder && cached.edges === src.spaceEdges && cached.spaceID === spaceID) {
    return cached.rows
  }

  let rows: RoomListRow[]
  if (spaceID === HOME_SPACE) {
    rows = src.roomOrder.map(roomRow)
  } else if (spaceID === DM_SPACE) {
    rows = src.roomOrder.filter(roomID => src.rooms[roomID]?.meta.dm_user_id).map(roomRow)
  } else {
    const direct = new Set<RoomID>()
    const subspaces: RoomID[] = []
    for (const edge of src.spaceEdges[spaceID] ?? []) {
      if (isSpace(src, edge.child_id)) subspaces.push(edge.child_id)
      else direct.add(edge.child_id)
    }
    rows = src.roomOrder.filter(roomID => direct.has(roomID)).map(roomRow)
    for (const subspaceID of subspaces) {
      const nested = new Set<RoomID>()
      collectRooms(src, subspaceID, nested, new Set([spaceID]))
      const sectionRooms = src.roomOrder.filter(roomID => nested.has(roomID) && !direct.has(roomID))
      if (sectionRooms.length) rows.push(`h:${subspaceID}`, ...sectionRooms.map(roomRow))
    }
  }
  rowsCache = { order: src.roomOrder, edges: src.spaceEdges, spaceID, rows }
  return rows
}

export function roomIDsInRows(rows: RoomListRow[]): RoomID[] {
  return rows.filter(row => row.startsWith('r:')).map(row => row.slice(2))
}

export interface SpaceUnread {
  highlights: number
  notifications: number
  unread: boolean
}

let unreadCache = {
  rooms: null as SpaceSource['rooms'] | null,
  edges: null as SpaceSource['spaceEdges'] | null,
  bySpace: new Map<string, SpaceUnread>(),
}

/** Summed unread counts for a space. Cached until rooms or space edges change, so 100+ rail icons stay cheap. */
export function spaceUnread(src: SpaceSource, spaceID: string): SpaceUnread {
  if (unreadCache.rooms !== src.rooms || unreadCache.edges !== src.spaceEdges) {
    unreadCache = { rooms: src.rooms, edges: src.spaceEdges, bySpace: new Map() }
  }
  const cached = unreadCache.bySpace.get(spaceID)
  if (cached) return cached
  const result: SpaceUnread = { highlights: 0, notifications: 0, unread: false }
  unreadCache.bySpace.set(spaceID, result)
  const visit = (roomID: RoomID) => {
    const meta = src.rooms[roomID]?.meta
    if (!meta) return
    result.highlights += meta.unread_highlights
    result.notifications += meta.unread_notifications
    result.unread ||= meta.unread_messages > 0 || meta.marked_unread
  }
  if (spaceID === HOME_SPACE) src.roomOrder.forEach(visit)
  else if (spaceID === DM_SPACE) src.roomOrder.filter(roomID => src.rooms[roomID]?.meta.dm_user_id).forEach(visit)
  else flattenedRooms(src, spaceID).forEach(visit)
  return result
}
