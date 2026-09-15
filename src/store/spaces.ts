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

/** Room list ordering preferences (pin_favorites, pin_low_priority, alphabetical_order). */
export interface RoomSortOptions {
  alphabetical: boolean
  pinFavourites: boolean
  pinLowPriority: boolean
}

export const DEFAULT_ROOM_SORT: RoomSortOptions = { alphabetical: false, pinFavourites: false, pinLowPriority: false }

const sortKey = (sort: RoomSortOptions) => `${+sort.alphabetical}${+sort.pinFavourites}${+sort.pinLowPriority}`

function roomTags(src: SpaceSource, roomID: RoomID): Record<string, unknown> {
  const tags = (src.rooms[roomID]?.accountData['m.tag']?.content as { tags?: unknown } | undefined)?.tags
  return tags && typeof tags === 'object' ? (tags as Record<string, unknown>) : {}
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
let orderCache: { order: RoomID[]; rooms: SpaceSource['rooms']; key: string; result: RoomID[] } | null = null

/** roomOrder (most recent first) re-sorted by the user's room list preferences. */
function sortedOrder(src: SpaceSource, sort: RoomSortOptions): RoomID[] {
  const key = sortKey(sort)
  if (key === '000') return src.roomOrder
  const cached = orderCache
  if (cached && cached.order === src.roomOrder && cached.rooms === src.rooms && cached.key === key) return cached.result

  // Rank: favourites 0, normal 1, low priority 2 (only for the pins that are enabled).
  const rank = (roomID: RoomID) => {
    const tags = roomTags(src, roomID)
    if (sort.pinFavourites && 'm.favourite' in tags) return 0
    if (sort.pinLowPriority && 'm.lowpriority' in tags) return 2
    return 1
  }
  const ranks = new Map(src.roomOrder.map(roomID => [roomID, rank(roomID)]))
  const position = new Map(src.roomOrder.map((roomID, i) => [roomID, i]))
  const result = [...src.roomOrder].sort((a, b) => {
    const byRank = ranks.get(a)! - ranks.get(b)!
    if (byRank) return byRank
    if (sort.alphabetical) {
      const byName = collator.compare(src.rooms[a]?.meta.name ?? a, src.rooms[b]?.meta.name ?? b)
      if (byName) return byName
    }
    return position.get(a)! - position.get(b)!
  })
  // Keep the previous array when nothing moved, so the room list rows stay cached.
  const same = cached && cached.key === key && cached.result.length === result.length && cached.result.every((id, i) => id === result[i])
  orderCache = { order: src.roomOrder, rooms: src.rooms, key, result: same ? cached.result : result }
  return orderCache.result
}

/** Row keys for the room list: "r:<roomID>" for rooms and "h:<spaceID>" for sub-space section headers. */
export type RoomListRow = `r:${string}` | `h:${string}`

const roomRow = (roomID: RoomID): RoomListRow => `r:${roomID}`

let rowsCache: { order: RoomID[]; edges: SpaceSource['spaceEdges']; spaceID: string; rows: RoomListRow[] } | null = null

/** A space's direct rooms first, then one section per sub-space (nested spaces flattened into it). */
export function spaceListRows(src: SpaceSource, spaceID: string, sort: RoomSortOptions = DEFAULT_ROOM_SORT): RoomListRow[] {
  const order = sortedOrder(src, sort)
  const cached = rowsCache
  if (cached && cached.order === order && cached.edges === src.spaceEdges && cached.spaceID === spaceID) {
    return cached.rows
  }

  let rows: RoomListRow[]
  if (spaceID === HOME_SPACE) {
    rows = order.map(roomRow)
  } else if (spaceID === DM_SPACE) {
    rows = order.filter(roomID => src.rooms[roomID]?.meta.dm_user_id).map(roomRow)
  } else {
    const direct = new Set<RoomID>()
    const subspaces: RoomID[] = []
    for (const edge of src.spaceEdges[spaceID] ?? []) {
      if (isSpace(src, edge.child_id)) subspaces.push(edge.child_id)
      else direct.add(edge.child_id)
    }
    rows = order.filter(roomID => direct.has(roomID)).map(roomRow)
    for (const subspaceID of subspaces) {
      const nested = new Set<RoomID>()
      collectRooms(src, subspaceID, nested, new Set([spaceID]))
      const sectionRooms = order.filter(roomID => nested.has(roomID) && !direct.has(roomID))
      if (sectionRooms.length) rows.push(`h:${subspaceID}`, ...sectionRooms.map(roomRow))
    }
  }
  rowsCache = { order, edges: src.spaceEdges, spaceID, rows }
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
