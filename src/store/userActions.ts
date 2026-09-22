// What can be done to a user from their profile: DMs, membership, power level and cleaning up after them.
import { client } from '@/api/client'
import type { EventID, EventRowID, RoomID, UserID } from '@/api/types'
import { useChat, type ChatSnapshot } from './chat'
import { isPendingEvent, type TimelineEvent } from './events'
import { eventPowerLevel, userPowerLevel, type PowerLevelsContent } from './power'
import { openRoom } from './ui'

/**
 * A joined DM with the user: a room m.direct lists for them, else a room gomuks treats as a DM with
 * them. Rooms in m.direct that were left aren't in the store, so they don't count.
 */
export function findDMRoom(s: ChatSnapshot, userID: UserID): RoomID | undefined {
  const direct = s.accountData['m.direct']?.content as Record<UserID, unknown> | undefined
  const listed = direct?.[userID]
  if (Array.isArray(listed)) {
    const joined = listed.filter((roomID): roomID is RoomID => typeof roomID === 'string' && !!s.rooms[roomID])
    // The most recently active one, if there are several.
    if (joined.length) return joined.sort((a, b) => s.rooms[b].meta.sorting_timestamp - s.rooms[a].meta.sorting_timestamp)[0]
  }
  return Object.values(s.rooms).find(room => room.meta.dm_user_id === userID)?.meta.room_id
}

/**
 * Opens the room once it shows up in a sync (rooms just created or joined take a moment), and jumps
 * to an event in it when one was asked for, e.g. the message a link pointed at before joining.
 */
export function openWhenJoined(roomID: RoomID, eventID?: EventID) {
  const arrive = () => {
    openRoom(roomID)
    // Imported lazily: navigation imports this module for its own room opening.
    if (eventID) void import('./navigation').then(({ jumpToEvent }) => jumpToEvent(roomID, eventID))
  }
  if (useChat.getState().rooms[roomID]) {
    arrive()
    return
  }
  const unsubscribe = useChat.subscribe(s => {
    if (!s.rooms[roomID]) return
    unsubscribe()
    clearTimeout(timeout)
    arrive()
  })
  const timeout = setTimeout(unsubscribe, 60_000)
}

/** Creates a DM (encrypted when the user has devices to encrypt for, as gomuks web does) and opens it. */
export async function createDM(userID: UserID) {
  let encrypt = false
  try {
    encrypt = !!(await client.trackUserDevices(userID)).devices?.length
  } catch (err) {
    console.warn("Couldn't check whether", userID, 'has encryption devices', err)
  }
  const { room_id } = await client.createRoom({
    is_direct: true,
    preset: 'trusted_private_chat',
    invite: [userID],
    initial_state: encrypt ? [{ type: 'm.room.encryption', content: { algorithm: 'm.megolm.v1.aes-sha2' } }] : [],
  })
  openWhenJoined(room_id)
}

export interface ModerationRights {
  ownLevel: number
  userLevel: number
  invite: boolean
  kick: boolean
  ban: boolean
  /** Redacting the user's messages. */
  redact: boolean
  /** Changing the user's power level. */
  setPowerLevel: boolean
  /** The highest level that can be given (one's own). */
  maxLevel: number
}

/** gomuks web's rules: acting on someone needs the action's level and, except for invites and redactions, a higher level than theirs. */
export function moderationRights(
  powerLevels: PowerLevelsContent | undefined,
  createEvent: TimelineEvent | undefined,
  ownUserID: UserID | undefined,
  userID: UserID,
): ModerationRights {
  const ownLevel = ownUserID ? userPowerLevel(powerLevels, createEvent, ownUserID) : -Infinity
  const userLevel = userPowerLevel(powerLevels, createEvent, userID)
  const self = ownUserID === userID
  const has = (action: 'invite' | 'kick' | 'ban' | 'redact') => {
    const needed = powerLevels?.[action] ?? (action === 'invite' ? 0 : 50)
    return ownLevel >= needed && (action === 'invite' || action === 'redact' || ownLevel > userLevel)
  }
  return {
    ownLevel,
    userLevel,
    invite: has('invite'),
    kick: !self && has('kick'),
    ban: !self && has('ban'),
    redact: ownLevel >= eventPowerLevel(powerLevels, 'm.room.redaction') && (self || has('redact')),
    setPowerLevel:
      ownLevel >= eventPowerLevel(powerLevels, 'm.room.power_levels', true) && userLevel !== Infinity && (self || ownLevel > userLevel),
    maxLevel: Math.min(ownLevel, Number.MAX_SAFE_INTEGER),
  }
}

/** Sets one user's power level, keeping the rest of the power levels event as it is. */
export async function setUserPowerLevel(roomID: RoomID, userID: UserID, level: number) {
  const s = useChat.getState()
  const rowid = s.rooms[roomID]?.state['m.room.power_levels']?.['']
  const current = (rowid === undefined ? undefined : s.events[rowid]?.content) ?? {}
  const users: Record<UserID, number> = { ...(current.users as Record<UserID, number> | undefined) }
  if (level === (typeof current.users_default === 'number' ? current.users_default : 0)) delete users[userID]
  else users[userID] = level
  await client.setState(roomID, 'm.room.power_levels', '', { ...current, users })
}

/** The user's events in the loaded timeline that can still be redacted, newest first. */
export function redactableEvents(s: ChatSnapshot, roomID: RoomID, userID: UserID): TimelineEvent[] {
  const room = s.rooms[roomID]
  if (!room) return []
  const out: TimelineEvent[] = []
  for (let i = room.timeline.length - 1; i >= 0; i--) {
    const evt = s.events[room.timeline[i].event_rowid]
    if (evt && evt.sender === userID && !evt.redacted_by && !isPendingEvent(evt) && evt.type !== 'm.room.redaction') out.push(evt)
  }
  return out
}

/** Redacts events one at a time, reporting how many are left; stops at the first failure. */
export async function redactEvents(events: TimelineEvent[], reason: string, onProgress: (remaining: number) => void) {
  let remaining = events.length
  onProgress(remaining)
  for (const evt of events) {
    await client.redactEvent(evt.room_id, evt.event_id, reason)
    onProgress(--remaining)
  }
}

export type SharedRooms = { status: 'loading' } | { status: 'ok'; roomIDs: RoomID[]; approximate: boolean } | { status: 'error'; message: string }

/**
 * Rooms shared with the user, from the homeserver. Servers without MSC2666 get the rooms whose loaded
 * member lists show them joined, which may miss some.
 */
export async function loadSharedRooms(userID: UserID): Promise<SharedRooms> {
  try {
    const resp = await client.getMutualRooms(userID)
    const rooms = useChat.getState().rooms
    return { status: 'ok', roomIDs: resp.joined.filter(roomID => !!rooms[roomID]), approximate: false }
  } catch (err) {
    const s = useChat.getState()
    const roomIDs = Object.values(s.rooms)
      .filter(room => {
        const rowid: EventRowID | undefined = room.state['m.room.member']?.[userID]
        return (rowid !== undefined && s.events[rowid]?.content.membership === 'join') || room.meta.dm_user_id === userID
      })
      .map(room => room.meta.room_id)
    if (roomIDs.length) return { status: 'ok', roomIDs, approximate: true }
    return { status: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}
