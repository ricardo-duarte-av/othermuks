// Global chat state, fed by gomuks RPC events.
// Events live in one rowid-keyed table; rooms hold ordered timeline tuples that point into it.
// Only the rooms/events touched by an update get new object identities, so components
// selecting a single room or event don't re-render for unrelated traffic.
import { create } from 'zustand'
import { client, type ConnectionState } from '@/api/client'
import type {
  ClientState,
  DBAccountData,
  DBInvitedRoom,
  DBReceipt,
  DBRoom,
  DBRoomAccountData,
  DBSpaceEdge,
  EventID,
  EventRowID,
  EventType,
  ManualPaginationResponse,
  MessageEventContent,
  RawDBEvent,
  RelatesTo,
  RoomID,
  RPCEvent,
  SyncCompleteData,
  SyncStatus,
  TimelineRowTuple,
  UserID,
} from '@/api/types'
import { markOnce } from '@/lib/perf'
import { isPendingEvent, normalizeEvent, threadRootOf, type TimelineEvent } from './events'
import { getPreference } from './preferences'

/** A user's latest read receipt in the main timeline, resolved to the event's rowid. */
export interface RoomReceipt extends DBReceipt {
  event_rowid: EventRowID
}

export interface RoomData {
  meta: DBRoom
  /** Sorted ascending by timeline_rowid. */
  timeline: TimelineRowTuple[]
  /** Local echoes that haven't appeared in the timeline yet. */
  pending: EventRowID[]
  state: Record<EventType, Record<string, EventRowID>>
  /** Room account data, e.g. m.tag (favourite/low priority) and m.marked_unread. */
  accountData: Record<EventType, DBRoomAccountData>
  /** One receipt per user: the furthest event in the timeline they've read. */
  receipts: Record<UserID, RoomReceipt>
  typing: UserID[]
  hasMore: boolean
  paginating: boolean
  membersLoaded: boolean
}

interface ChatState {
  connection: ConnectionState
  clientState: ClientState | null
  syncStatus: SyncStatus | null
  initComplete: boolean
  rooms: Record<RoomID, RoomData>
  /** Non-space rooms, most recent activity first. */
  roomOrder: RoomID[]
  spaces: RoomID[]
  /** Children of each space, in the order gomuks provides. Replaced per space on sync. */
  spaceEdges: Record<RoomID, DBSpaceEdge[]>
  topLevelSpaces: RoomID[]
  events: Record<EventRowID, TimelineEvent>
  eventIDs: Record<EventID, EventRowID>
  /** Known replies per thread root, in arrival order. */
  threads: Record<EventID, EventRowID[]>
  invites: DBInvitedRoom[]
  accountData: Record<EventType, DBAccountData>
}

export type ChatSnapshot = ChatState

export const useChat = create<ChatState>()(() => ({
  connection: { connected: false, reconnecting: true, error: null },
  clientState: null,
  syncStatus: null,
  initComplete: false,
  rooms: {},
  roomOrder: [],
  spaces: [],
  spaceEdges: {},
  topLevelSpaces: [],
  events: {},
  eventIDs: {},
  threads: {},
  invites: [],
  accountData: {},
}))

const get = useChat.getState
const set = useChat.setState

/** Called after each sync has been applied to the store (open widgets forward new events from here). */
export const syncListeners = new Set<(data: SyncCompleteData) => void>()

export const selectOwnUserID = (s: ChatState): UserID | undefined =>
  s.clientState?.is_logged_in ? s.clientState.user_id : undefined

function newRoom(meta: DBRoom): RoomData {
  return {
    meta,
    timeline: [],
    pending: [],
    state: {},
    accountData: {},
    receipts: {},
    typing: [],
    hasMore: true,
    paginating: false,
    membersLoaded: false,
  }
}

let syntheticRowID = -1_000_000_000

/** Copy-on-write view of the event tables for applying a batch of events in one store update. */
class EventTables {
  events: Record<EventRowID, TimelineEvent>
  eventIDs: Record<EventID, EventRowID>
  threads: Record<EventID, EventRowID[]>
  #threadsCopied: boolean

  constructor(s: ChatState, clear = false) {
    this.events = clear ? {} : { ...s.events }
    this.eventIDs = clear ? {} : { ...s.eventIDs }
    this.threads = clear ? {} : s.threads
    this.#threadsCopied = clear
  }

  add(raws: RawDBEvent[] | null | undefined) {
    for (const raw of raws ?? []) {
      // Events fetched straight from the homeserver (e.g. thread pages) may lack a local rowid.
      const rowid = raw.rowid || (raw.event_id && this.eventIDs[raw.event_id]) || syntheticRowID--
      const evt = normalizeEvent(rowid === raw.rowid ? raw : { ...raw, rowid })
      this.events[rowid] = evt
      if (evt.event_id) this.eventIDs[evt.event_id] = rowid
      const root = threadRootOf(evt)
      if (root) {
        if (!this.#threadsCopied) {
          this.threads = { ...this.threads }
          this.#threadsCopied = true
        }
        const replies = this.threads[root]
        if (!replies) this.threads[root] = [rowid]
        else if (!replies.includes(rowid)) this.threads[root] = [...replies, rowid]
      }
    }
  }

  get patch() {
    return { events: this.events, eventIDs: this.eventIDs, threads: this.threads }
  }
}

/** Adds events to the tables without touching rooms. */
export function storeEvents(raws: RawDBEvent[]) {
  const tables = new EventTables(get())
  tables.add(raws)
  set(tables.patch)
}

const byTimelineRowID = (a: TimelineRowTuple, b: TimelineRowTuple) => a.timeline_rowid - b.timeline_rowid

function mergeTimeline(existing: TimelineRowTuple[], incoming: TimelineRowTuple[]): TimelineRowTuple[] {
  if (!incoming.length) return existing
  const sorted = incoming.toSorted(byTimelineRowID)
  if (!existing.length) return sorted
  if (sorted[0].timeline_rowid > existing[existing.length - 1].timeline_rowid) return existing.concat(sorted)
  if (sorted[sorted.length - 1].timeline_rowid < existing[0].timeline_rowid) return sorted.concat(existing)
  const merged = new Map<number, TimelineRowTuple>()
  for (const tuple of existing) merged.set(tuple.timeline_rowid, tuple)
  for (const tuple of sorted) merged.set(tuple.timeline_rowid, tuple)
  return [...merged.values()].sort(byTimelineRowID)
}

/**
 * Applies receipts the way gomuks web does: a user's receipt only moves forward in the timeline, and
 * receipts for events that aren't in the loaded timeline are ignored. Thread receipts are skipped so
 * reading a thread doesn't move someone's avatar in the main timeline.
 */
function mergeReceipts(
  room: RoomData,
  incoming: Record<EventID, DBReceipt[]> | null | undefined,
  eventIDs: Record<EventID, EventRowID>,
): Record<UserID, RoomReceipt> {
  if (!incoming || !room.timeline.length) return room.receipts
  let positions: Map<EventRowID, number> | undefined
  const positionOf = (rowid: EventRowID | undefined) => {
    if (rowid === undefined) return undefined
    positions ??= new Map(room.timeline.map(tuple => [tuple.event_rowid, tuple.timeline_rowid]))
    return positions.get(rowid)
  }

  let receipts = room.receipts
  let copied = false
  for (const [eventID, list] of Object.entries(incoming)) {
    const rowid = eventIDs[eventID]
    const position = positionOf(rowid)
    if (rowid === undefined || position === undefined) continue
    for (const receipt of list) {
      if (receipt.thread_id && receipt.thread_id !== 'main') continue
      const existing = receipts[receipt.user_id]
      const existingPosition = existing ? positionOf(existing.event_rowid) : undefined
      if (existingPosition !== undefined && existingPosition >= position) continue
      if (!copied) {
        receipts = { ...receipts }
        copied = true
      }
      receipts[receipt.user_id] = { ...receipt, event_rowid: rowid }
    }
  }
  return receipts
}

const sameIDs = (a: RoomID[], b: RoomID[]) => a.length === b.length && a.every((id, i) => id === b[i])

function computeOrder(rooms: Record<RoomID, RoomData>, prev: ChatState) {
  const roomOrder: RoomID[] = []
  const spaces: RoomID[] = []
  const sorted = Object.values(rooms).sort((a, b) => b.meta.sorting_timestamp - a.meta.sorting_timestamp)
  for (const room of sorted) {
    ;(room.meta.creation_content?.type === 'm.space' ? spaces : roomOrder).push(room.meta.room_id)
  }
  return {
    roomOrder: sameIDs(roomOrder, prev.roomOrder) ? prev.roomOrder : roomOrder,
    spaces: sameIDs(spaces, prev.spaces) ? prev.spaces : spaces,
  }
}

function patchRoom(roomID: RoomID, patch: Partial<RoomData>) {
  const room = get().rooms[roomID]
  if (room) set({ rooms: { ...get().rooms, [roomID]: { ...room, ...patch } } })
}

function applySync(data: SyncCompleteData) {
  const started = performance.now()
  const s = get()
  const clear = !!data.clear_state
  const rooms = clear ? {} : { ...s.rooms }
  const tables = new EventTables(s, clear)
  let orderDirty = clear

  for (const [roomID, sync] of Object.entries(data.rooms ?? {})) {
    tables.add(sync.events)
    const prev = rooms[roomID]
    if (!prev && !sync.meta) continue
    const room = prev ? { ...prev } : newRoom(sync.meta!)
    if (sync.meta) {
      orderDirty ||= !prev || prev.meta.sorting_timestamp !== sync.meta.sorting_timestamp
      room.meta = sync.meta
    }
    if (sync.reset) {
      room.timeline = []
      room.hasMore = true
    }
    if (sync.timeline?.length) {
      room.timeline = mergeTimeline(room.timeline, sync.timeline)
      if (room.pending.length) {
        const arrived = new Set(sync.timeline.map(tuple => tuple.event_rowid))
        room.pending = room.pending.filter(rowid => !arrived.has(rowid))
      }
    }
    if (sync.state) {
      const state = { ...room.state }
      for (const [type, keys] of Object.entries(sync.state)) state[type] = { ...state[type], ...keys }
      room.state = state
    }
    if (sync.account_data && Object.keys(sync.account_data).length) {
      room.accountData = { ...room.accountData, ...sync.account_data }
    }
    room.receipts = mergeReceipts(room, sync.receipts, tables.eventIDs)
    rooms[roomID] = room
  }

  for (const roomID of data.left_rooms ?? []) {
    if (rooms[roomID]) {
      delete rooms[roomID]
      orderDirty = true
    }
  }

  let invites = clear ? [] : s.invites
  const incomingInvites = data.invited_rooms ?? []
  const resolved = (id: RoomID) => !!rooms[id] || !!data.left_rooms?.includes(id)
  if (incomingInvites.length || invites.some(invite => resolved(invite.room_id))) {
    const incomingIDs = new Set(incomingInvites.map(invite => invite.room_id))
    invites = [
      ...invites.filter(invite => !incomingIDs.has(invite.room_id) && !resolved(invite.room_id)),
      ...incomingInvites,
    ]
  }

  const baseAccountData = clear ? {} : s.accountData
  const accountData = data.account_data ? { ...baseAccountData, ...data.account_data } : baseAccountData

  const baseEdges = clear ? {} : s.spaceEdges
  const spaceEdges =
    data.space_edges && Object.keys(data.space_edges).length ? { ...baseEdges, ...data.space_edges } : baseEdges
  const topLevelSpaces = data.top_level_spaces ?? (clear ? [] : s.topLevelSpaces)

  set({
    rooms,
    ...tables.patch,
    invites,
    accountData,
    spaceEdges,
    topLevelSpaces: sameIDs(topLevelSpaces, s.topLevelSpaces) ? s.topLevelSpaces : topLevelSpaces,
    ...(orderDirty ? computeOrder(rooms, s) : {}),
  })
  for (const listener of syncListeners) listener(data)

  if (data.rooms && Object.keys(data.rooms).length) {
    const roomCount = Object.keys(rooms).length
    markOnce('first sync applied', `${roomCount} rooms, ${Math.round(performance.now() - started)} ms to apply`)
  }
}

export function handleRPCEvent(evt: RPCEvent) {
  switch (evt.command) {
    case 'client_state':
      set({ clientState: evt.data })
      break
    case 'sync_status':
      set({ syncStatus: evt.data })
      break
    case 'init_complete':
      set({ initComplete: true })
      break
    case 'sync_complete':
      applySync(evt.data)
      break
    case 'events_decrypted': {
      const s = get()
      const tables = new EventTables(s)
      tables.add(evt.data.events)
      const room = s.rooms[evt.data.room_id]
      if (room && evt.data.preview_event_rowid) {
        const meta = {
          ...room.meta,
          preview_event_rowid: evt.data.preview_event_rowid,
          sorting_timestamp: evt.data.sorting_timestamp ?? room.meta.sorting_timestamp,
        }
        const rooms = { ...s.rooms, [room.meta.room_id]: { ...room, meta } }
        set({ ...tables.patch, rooms, ...computeOrder(rooms, s) })
      } else {
        set(tables.patch)
      }
      break
    }
    case 'send_complete':
      // The event carries the real event ID now (same rowid as the ~txn local echo). Its send_error is
      // still the "not sent" placeholder even on success, so a real failure comes from data.error.
      storeEvents([evt.data.error ? { ...evt.data.event, send_error: evt.data.error } : evt.data.event])
      break
    case 'typing':
      patchRoom(evt.data.room_id, { typing: evt.data.user_ids })
      break
  }
}

function addLocalEcho(roomID: RoomID, raw: RawDBEvent, pending: boolean) {
  const s = get()
  const room = s.rooms[roomID]
  const inTimeline = room?.timeline.some(tuple => tuple.event_rowid === raw.rowid)
  const tables = new EventTables(s)
  tables.add([raw])
  if (!room || !pending || inTimeline || room.pending.includes(raw.rowid)) {
    set(tables.patch)
    return
  }
  set({ ...tables.patch, rooms: { ...s.rooms, [roomID]: { ...room, pending: [...room.pending, raw.rowid] } } })
}

export async function loadOlder(roomID: RoomID) {
  const room = get().rooms[roomID]
  if (!room || room.paginating || !room.hasMore) return
  patchRoom(roomID, { paginating: true })
  try {
    const resp = await client.paginate(roomID, room.timeline[0]?.timeline_rowid ?? 0, 50)
    const s = get()
    const current = s.rooms[roomID]
    if (!current) return
    const tables = new EventTables(s)
    tables.add(resp.events)
    tables.add(resp.related_events)
    const tuples = resp.events.map(evt => ({ timeline_rowid: evt.timeline_rowid, event_rowid: evt.rowid }))
    const updated: RoomData = {
      ...current,
      timeline: mergeTimeline(current.timeline, tuples),
      hasMore: resp.has_more && tuples.length > 0,
      paginating: false,
    }
    updated.receipts = mergeReceipts(updated, resp.receipts, tables.eventIDs)
    set({ ...tables.patch, rooms: { ...s.rooms, [roomID]: updated } })
  } catch (err) {
    console.error('Pagination failed for', roomID, err)
    patchRoom(roomID, { paginating: false })
  }
}

/** Loads full room state (including members) so sender names and avatars resolve. */
export async function loadRoomState(roomID: RoomID) {
  const room = get().rooms[roomID]
  if (!room || room.membersLoaded) return
  patchRoom(roomID, { membersLoaded: true })
  try {
    const stateEvents = await client.getRoomState(roomID, true, !room.meta.has_member_list)
    const s = get()
    const current = s.rooms[roomID]
    if (!current) return
    const tables = new EventTables(s)
    tables.add(stateEvents)
    const fresh: Record<EventType, Record<string, EventRowID>> = {}
    for (const evt of stateEvents) {
      if (evt.state_key !== undefined) (fresh[evt.type] ??= {})[evt.state_key] = evt.rowid
    }
    const state = { ...current.state }
    for (const [type, keys] of Object.entries(fresh)) state[type] = { ...state[type], ...keys }
    set({ ...tables.patch, rooms: { ...s.rooms, [roomID]: { ...current, state } } })
  } catch (err) {
    console.error('Failed to load room state for', roomID, err)
    patchRoom(roomID, { membersLoaded: false })
  }
}

/** Merges individually fetched state events (e.g. emoji packs from get_specific_room_state) into their rooms. */
export function applyStateEvents(stateEvents: RawDBEvent[]) {
  const s = get()
  const tables = new EventTables(s)
  tables.add(stateEvents)
  const rooms = { ...s.rooms }
  let changed = false
  for (const raw of stateEvents) {
    const room = rooms[raw.room_id]
    if (!room || raw.state_key === undefined) continue
    const rowid = raw.event_id ? tables.eventIDs[raw.event_id] : raw.rowid
    if (rowid === undefined) continue
    rooms[raw.room_id] = { ...room, state: { ...room.state, [raw.type]: { ...room.state[raw.type], [raw.state_key]: rowid } } }
    changed = true
  }
  set({ ...tables.patch, ...(changed ? { rooms } : {}) })
}

const fetchingEvents = new Set<EventID>()

/** Fetches an event that isn't in the store yet (e.g. an old reply target). Tried once per event. */
export async function fetchEvent(roomID: RoomID, eventID: EventID) {
  if (get().eventIDs[eventID] !== undefined || fetchingEvents.has(eventID)) return
  fetchingEvents.add(eventID)
  try {
    storeEvents([await client.getEvent(roomID, eventID)])
  } catch (err) {
    console.warn('Failed to fetch event', eventID, err)
  }
}

/** Loads a page of thread replies (newest first from the server); returns the token for older replies. */
export async function loadThreadPage(roomID: RoomID, threadRoot: EventID, since = ''): Promise<string | undefined> {
  const resp = await client.exec<ManualPaginationResponse>('paginate_manual', {
    room_id: roomID,
    since,
    direction: 'b',
    limit: 50,
    thread_root: threadRoot,
  })
  storeEvents(resp.events)
  return resp.next_batch || undefined
}

function sortedThreadReplies(s: ChatState, threadRoot: EventID): EventRowID[] {
  return (s.threads[threadRoot] ?? []).toSorted((a, b) => (s.events[a]?.timestamp ?? 0) - (s.events[b]?.timestamp ?? 0))
}

/** Thread relation as gomuks web builds it: replies fall back to the latest thread event. */
function threadRelation(threadRoot: EventID, replyTo?: TimelineEvent): RelatesTo {
  const s = get()
  const replies = sortedThreadReplies(s, threadRoot)
  let latest: EventID = threadRoot
  for (let i = replies.length - 1; i >= 0; i--) {
    const evt = s.events[replies[i]]
    if (evt && !isPendingEvent(evt)) {
      latest = evt.event_id
      break
    }
  }
  return {
    rel_type: 'm.thread',
    event_id: threadRoot,
    is_falling_back: !replyTo,
    'm.in_reply_to': { event_id: replyTo?.event_id ?? latest },
  }
}

export interface SendOptions {
  replyTo?: TimelineEvent
  edit?: TimelineEvent
  threadRoot?: EventID
}

export async function sendText(roomID: RoomID, text: string, { replyTo, edit, threadRoot }: SendOptions = {}) {
  let relates_to: RelatesTo | undefined
  if (edit) relates_to = { rel_type: 'm.replace', event_id: edit.event_id }
  else if (threadRoot) relates_to = threadRelation(threadRoot, replyTo)
  else if (replyTo) relates_to = { 'm.in_reply_to': { event_id: replyTo.event_id } }
  const ownUserID = selectOwnUserID(get())
  const user_ids = replyTo && replyTo.sender !== ownUserID ? [replyTo.sender] : []
  const evt = await client.sendMessage({
    room_id: roomID,
    text,
    relates_to,
    mentions: { user_ids, room: false },
    url_previews: [],
  })
  if (evt) addLocalEcho(roomID, evt, !edit)
}

export async function sendMedia(roomID: RoomID, content: MessageEventContent, threadRoot?: EventID) {
  const evt = await client.sendMessage({
    room_id: roomID,
    text: '',
    base_content: content,
    relates_to: threadRoot ? threadRelation(threadRoot) : undefined,
    mentions: { user_ids: [], room: false },
    url_previews: [],
  })
  if (evt) addLocalEcho(roomID, evt, true)
}

export async function uploadAndSend(roomID: RoomID, files: Iterable<File>, threadRoot?: EventID) {
  const encrypt = !!get().rooms[roomID]?.meta.encryption_event
  for (const file of files) {
    await sendMedia(roomID, await client.upload(file, encrypt), threadRoot)
  }
}

const EDITABLE_MSGTYPES = new Set(['m.text', 'm.emote', 'm.notice'])
const EDIT_LOOKBACK = 200

/** The latest own text message in the main timeline, or in a thread when threadRoot is given. */
export function findLastOwnEditable(roomID: RoomID, threadRoot?: EventID): TimelineEvent | undefined {
  const s = get()
  const room = s.rooms[roomID]
  const ownUserID = selectOwnUserID(s)
  if (!room || !ownUserID) return undefined
  const rowids = threadRoot
    ? sortedThreadReplies(s, threadRoot)
    : [...room.timeline.slice(-EDIT_LOOKBACK).map(tuple => tuple.event_rowid), ...room.pending]
  for (let i = rowids.length - 1; i >= 0; i--) {
    const evt = s.events[rowids[i]]
    if (
      evt?.sender === ownUserID &&
      evt.type === 'm.room.message' &&
      !isPendingEvent(evt) &&
      !evt.redacted_by &&
      evt.relation_type !== 'm.replace' &&
      (threadRoot || !threadRootOf(evt)) &&
      EDITABLE_MSGTYPES.has(evt.content.msgtype as string)
    ) {
      return evt
    }
  }
  return undefined
}

/**
 * The newest event in the room, of any type. A read receipt must point at this one: pointing it at the
 * newest *visible* message would leave later reactions or redactions unread, and the room could never
 * be marked read. Falls back to the preview event when no timeline is loaded (same as gomuks web).
 */
export function latestReadEvent(roomID: RoomID): TimelineEvent | undefined {
  const s = get()
  const room = s.rooms[roomID]
  if (!room) return undefined
  for (let i = room.timeline.length - 1; i >= 0; i--) {
    const evt = s.events[room.timeline[i].event_rowid]
    if (evt && !isPendingEvent(evt)) return evt
  }
  const preview = s.events[room.meta.preview_event_rowid]
  return preview && !isPendingEvent(preview) ? preview : undefined
}

const lastMarkedRead = new Map<RoomID, EventID>()

/** Sends a read receipt for evt, unless the room has nothing unread (or force is set). */
export function markRoomRead(roomID: RoomID, evt: TimelineEvent, force = false) {
  const meta = get().rooms[roomID]?.meta
  if (!meta || isPendingEvent(evt) || lastMarkedRead.get(roomID) === evt.event_id) return
  const unread = meta.unread_messages || meta.unread_notifications || meta.unread_highlights || meta.marked_unread
  if (!unread && !force) return
  lastMarkedRead.set(roomID, evt.event_id)
  const receiptType = getPreference('send_read_receipts', roomID) ? 'm.read' : 'm.read.private'
  client.markRead(roomID, evt.event_id, receiptType).catch(err => {
    console.error('Failed to mark read', roomID, err)
    lastMarkedRead.delete(roomID)
  })
}
