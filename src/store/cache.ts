// Room list cache in IndexedDB, modelled on gomuks web's StateCache: the rooms, spaces, invites and account
// data from the previous session are shown immediately on startup, and the event stream then only sends what
// changed since then (a catch-up sync with last_server_ts) instead of a full initial sync.
// Per room only what the room list needs is kept: metadata, the preview event with its sender's member event
// and last edit. Timelines are loaded when a room is opened, as after a fresh sync.
import type {
  DBAccountData,
  DBInvitedRoom,
  DBRoom,
  DBRoomAccountData,
  DBSpaceEdge,
  RawDBEvent,
  RoomID,
  RPCEvent,
  SyncCompleteData,
  SyncRoom,
} from '@/api/types'
import { log } from '@/lib/log'
import { syncListeners, useChat, type ChatSnapshot } from './chat'
import type { TimelineEvent } from './events'
import { getPreference } from './preferences'

const DB_NAME = 'othermuks-cache'
const DB_VERSION = 1
const KV = 'kv'
const ROOMS = 'rooms'
const ACCOUNT_DATA = 'account_data'
const ROOM_ACCOUNT_DATA = 'room_account_data'
const SPACE_EDGES = 'space_edges'
const INVITES = 'invites'
const STORES = [KV, ROOMS, ACCOUNT_DATA, ROOM_ACCOUNT_DATA, SPACE_EDGES, INVITES]
const FLUSH_INTERVAL = 30_000

interface CachedRoom {
  meta: DBRoom
  events: RawDBEvent[]
  state: Record<string, Record<string, number>>
}

export interface CachedSession {
  userID: string | undefined
  serverTimestamp: number
  roomCount: number
  sync: SyncCompleteData
}

type Write = (txn: IDBTransaction) => void

let db: IDBDatabase | null = null
let cachedUserID: string | undefined
let flushTimer: ReturnType<typeof setInterval> | null = null
let flushing = false
let queue = new Map<string, Write>()

const promisify = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const database = req.result
      // objectStoreNames is live: delete from the end so no store is skipped.
      for (let i = database.objectStoreNames.length - 1; i >= 0; i--) database.deleteObjectStore(database.objectStoreNames[i])
      database.createObjectStore(KV, { keyPath: 'key' })
      database.createObjectStore(ROOMS)
      database.createObjectStore(ACCOUNT_DATA, { keyPath: 'type' })
      database.createObjectStore(ROOM_ACCOUNT_DATA, { keyPath: ['room_id', 'type'] })
      database.createObjectStore(SPACE_EDGES, { keyPath: 'room_id' })
      database.createObjectStore(INVITES, { keyPath: 'room_id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Opening the cache failed'))
    req.onblocked = () => log.warn('room cache open blocked by another tab')
  })
}

/** Events are stored the way gomuks sends them (encrypted type/content plus decrypted_*). */
export function toRawEvent(evt: TimelineEvent): RawDBEvent {
  const raw: RawDBEvent & { encrypted?: boolean; original?: unknown } = { ...evt }
  delete raw.encrypted
  delete raw.original
  if (!evt.original) return raw
  return { ...raw, type: evt.original.type, content: evt.original.content, decrypted: evt.content, decrypted_type: evt.type }
}

/** What the room list needs from a room (like gomuks' getStateForCache). */
export function cachedRoomEntry(chat: ChatSnapshot, roomID: RoomID): CachedRoom | null {
  const room = chat.rooms[roomID]
  if (!room) return null
  const events: RawDBEvent[] = []
  const state: CachedRoom['state'] = {}
  const preview = chat.events[room.meta.preview_event_rowid]
  if (preview) {
    events.push(toRawEvent(preview))
    const memberRowID = room.state['m.room.member']?.[preview.sender]
    const member = memberRowID === undefined ? undefined : chat.events[memberRowID]
    if (member?.state_key !== undefined) {
      events.push(toRawEvent(member))
      state['m.room.member'] = { [member.state_key]: member.rowid }
    }
    const edit = preview.last_edit_rowid ? chat.events[preview.last_edit_rowid] : undefined
    if (edit) events.push(toRawEvent(edit))
  }
  return { meta: room.meta, events, state }
}

async function loadAll(database: IDBDatabase, owner: string): Promise<CachedSession | null> {
  const txn = database.transaction(STORES, 'readonly')
  const [kv, rooms, accountData, roomAccountData, spaceEdges, invites] = await Promise.all([
    promisify(txn.objectStore(KV).getAll() as IDBRequest<{ key: string; value: unknown }[]>),
    promisify(txn.objectStore(ROOMS).getAll() as IDBRequest<CachedRoom[]>),
    promisify(txn.objectStore(ACCOUNT_DATA).getAll() as IDBRequest<DBAccountData[]>),
    promisify(txn.objectStore(ROOM_ACCOUNT_DATA).getAll() as IDBRequest<DBRoomAccountData[]>),
    promisify(txn.objectStore(SPACE_EDGES).getAll() as IDBRequest<{ room_id: RoomID; edges: DBSpaceEdge[] }[]>),
    promisify(txn.objectStore(INVITES).getAll() as IDBRequest<DBInvitedRoom[]>),
  ])
  const values = new Map(kv.map(entry => [entry.key, entry.value]))
  const serverTimestamp = values.get('server_timestamp')
  if (values.get('owner') !== owner || typeof serverTimestamp !== 'number' || !rooms.length) return null

  const syncRooms: Record<RoomID, SyncRoom> = {}
  for (const room of rooms) syncRooms[room.meta.room_id] = { meta: room.meta, events: room.events, state: room.state }
  for (const data of roomAccountData) {
    const room = syncRooms[data.room_id]
    if (room) room.account_data = { ...room.account_data, [data.type]: data }
  }
  const topLevel = values.get('top_level_spaces')
  const userID = values.get('user_id')
  return {
    userID: typeof userID === 'string' ? userID : undefined,
    serverTimestamp,
    roomCount: rooms.length,
    sync: {
      clear_state: true,
      server_timestamp: serverTimestamp,
      rooms: syncRooms,
      account_data: Object.fromEntries(accountData.map(data => [data.type, data])),
      space_edges: Object.fromEntries(spaceEdges.map(entry => [entry.room_id, entry.edges])),
      top_level_spaces: Array.isArray(topLevel) ? (topLevel as RoomID[]) : [],
      invited_rooms: invites,
    },
  }
}

function enqueue(key: string, write: Write) {
  if (db) queue.set(key, write)
}

const putKV = (key: string, value: unknown) => enqueue(`kv:${key}`, txn => txn.objectStore(KV).put({ key, value }))

async function flush() {
  if (!db || flushing || !queue.size) return
  flushing = true
  const writes = queue
  queue = new Map()
  const started = performance.now()
  try {
    await new Promise<void>((resolve, reject) => {
      const txn = db!.transaction(STORES, 'readwrite')
      txn.oncomplete = () => resolve()
      txn.onerror = () => reject(txn.error)
      txn.onabort = () => reject(txn.error ?? new Error('Cache write aborted'))
      for (const write of writes.values()) write(txn)
      txn.commit()
    })
    log.debug(`room cache: saved ${writes.size} items in ${Math.round(performance.now() - started)} ms`)
  } catch (err) {
    // Keep the writes (newer ones for the same key win) and try again later.
    for (const [key, write] of writes) if (!queue.has(key)) queue.set(key, write)
    log.warn('room cache: saving failed', err)
  } finally {
    flushing = false
  }
}

const flushWhenHidden = () => {
  if (document.visibilityState === 'hidden') void flush()
}

// Record every applied sync. A cleared sync (fresh initial sync) replaces the whole cache.
syncListeners.add(data => {
  if (!db) return
  const chat = useChat.getState()
  if (data.clear_state) {
    queue = new Map()
    enqueue('clear', txn => {
      for (const store of STORES) txn.objectStore(store).clear()
    })
    putKV('owner', currentOwner)
  }
  for (const [roomID, sync] of Object.entries(data.rooms ?? {})) {
    const entry = cachedRoomEntry(chat, roomID)
    if (entry) enqueue(`room:${roomID}`, txn => txn.objectStore(ROOMS).put(entry, roomID))
    for (const accountData of Object.values(sync.account_data ?? {})) {
      enqueue(`rad:${roomID}:${accountData.type}`, txn => txn.objectStore(ROOM_ACCOUNT_DATA).put(accountData))
    }
  }
  for (const roomID of data.left_rooms ?? []) enqueue(`room:${roomID}`, txn => txn.objectStore(ROOMS).delete(roomID))
  for (const accountData of Object.values(data.account_data ?? {})) {
    enqueue(`ad:${accountData.type}`, txn => txn.objectStore(ACCOUNT_DATA).put(accountData))
  }
  for (const [spaceID, edges] of Object.entries(data.space_edges ?? {})) {
    enqueue(`space:${spaceID}`, txn => txn.objectStore(SPACE_EDGES).put({ room_id: spaceID, edges }))
  }
  if (data.top_level_spaces) putKV('top_level_spaces', data.top_level_spaces)
  if (data.invited_rooms?.length || data.left_rooms?.length || data.rooms) {
    const invites = chat.invites
    enqueue('invites', txn => {
      const store = txn.objectStore(INVITES)
      store.clear()
      for (const invite of invites) store.put(invite)
    })
  }
  if (data.server_timestamp) putKV('server_timestamp', data.server_timestamp)
  const state = chat.clientState
  if (state?.is_logged_in) putKV('user_id', state.user_id)
})

// A different account behind the same backend: the cached rooms belong to someone else.
useChat.subscribe((state, prev) => {
  const next = state.clientState
  if (!db || next === prev.clientState || !next?.is_logged_in || !cachedUserID || next.user_id === cachedUserID) return
  log.warn(`room cache belongs to ${cachedUserID}, not ${next.user_id}; clearing it`)
  cachedUserID = undefined
  void clearRoomCache().then(() => location.reload())
})

let currentOwner = ''

/**
 * Opens the cache for this backend and returns the previous session's data, if any. The owner identifies
 * the backend, so switching backends never mixes rooms.
 */
export async function openRoomCache(owner: string): Promise<CachedSession | null> {
  if (!getPreference('cache_on_device') || typeof indexedDB === 'undefined') return null
  currentOwner = owner
  const database = await openDB()
  database.onversionchange = () => closeRoomCache()
  let session: CachedSession | null = null
  try {
    session = await loadAll(database, owner)
  } catch (err) {
    log.warn('room cache: reading failed, starting fresh', err)
  }
  if (!session) {
    // Nothing usable (empty, or another backend's rooms): wipe it now rather than on the next save, so data
    // from a previous backend can't come back if this session ends before saving.
    try {
      await new Promise<void>((resolve, reject) => {
        const txn = database.transaction(STORES, 'readwrite')
        txn.oncomplete = () => resolve()
        txn.onerror = () => reject(txn.error)
        txn.onabort = () => reject(txn.error ?? new Error('Clearing the cache was aborted'))
        for (const store of STORES) txn.objectStore(store).clear()
        txn.objectStore(KV).put({ key: 'owner', value: owner })
      })
    } catch (err) {
      log.warn('room cache: clearing stale data failed', err)
    }
  }
  db = database
  cachedUserID = session?.userID
  queue = new Map()
  putKV('owner', owner)
  flushTimer ??= setInterval(() => void flush(), FLUSH_INTERVAL)
  document.addEventListener('visibilitychange', flushWhenHidden)
  window.addEventListener('pagehide', flushWhenHidden)
  return session
}

/** Applies a cached session as if gomuks had just sent it. */
export function applyCachedSession(session: CachedSession, handle: (evt: RPCEvent) => void) {
  handle({ command: 'sync_complete', request_id: 0, data: session.sync } as RPCEvent)
}

export function closeRoomCache() {
  if (flushTimer) clearInterval(flushTimer)
  flushTimer = null
  document.removeEventListener('visibilitychange', flushWhenHidden)
  window.removeEventListener('pagehide', flushWhenHidden)
  db?.close()
  db = null
  queue = new Map()
}

export async function clearRoomCache() {
  closeRoomCache()
  if (typeof indexedDB === 'undefined') return
  await new Promise<void>(resolve => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}
