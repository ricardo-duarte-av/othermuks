// Getting into rooms: pending invites, joining by ID or alias, and knocking when a room only takes
// requests. gomuks keeps invites out of the room list (they have no timeline yet), so they live in
// their own state here until a sync turns one into a joined room or drops it.
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { client } from '@/api/client'
import type { DBInvitedRoom, EventID, RoomID, RoomSummary, StrippedStateEvent, UserID } from '@/api/types'
import { selectOwnUserID, useChat } from './chat'
import { fallbackDisplayName } from './events'
import { showToast, useUI } from './ui'
import { openWhenJoined } from './userActions'

const asString = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

/** What an invite's stripped state says about the room and who invited us. */
export interface InviteDetails {
  roomID: RoomID
  name?: string
  avatar?: string
  topic?: string
  canonicalAlias?: string
  /** Who sent our own m.room.member invite event. */
  inviter?: UserID
  inviterName?: string
  isDM: boolean
  encrypted: boolean
  isSpace: boolean
  joinRule?: string
  reason?: string
  createdAt: number
}

/**
 * The stripped state an invite describes the room with. gomuks passes the invite through as the
 * homeserver sent it, which in practice is our own m.room.member event with the room's state tucked
 * into its unsigned.invite_room_state; servers may also list that state directly, so take both.
 */
function strippedState(invite: DBInvitedRoom): StrippedStateEvent[] {
  const events: StrippedStateEvent[] = []
  for (const evt of invite.invite_state ?? []) {
    events.push(evt)
    for (const nested of evt.unsigned?.invite_room_state ?? []) events.push(nested)
  }
  return events
}

/**
 * Invites carry stripped state rather than a room: whatever the server chose to include, which is
 * usually the name, avatar, topic and our own member event.
 */
export function inviteDetails(invite: DBInvitedRoom, ownUserID: UserID | undefined): InviteDetails {
  const details: InviteDetails = { roomID: invite.room_id, isDM: false, encrypted: false, isSpace: false, createdAt: invite.created_at }
  const memberNames = new Map<UserID, string>()
  for (const evt of strippedState(invite)) {
    switch (evt.type) {
      case 'm.room.name':
        details.name = asString(evt.content.name)
        break
      case 'm.room.avatar':
        details.avatar = asString(evt.content.url)
        break
      case 'm.room.topic':
        details.topic = asString(evt.content.topic)
        break
      case 'm.room.canonical_alias':
        details.canonicalAlias = asString(evt.content.alias)
        break
      case 'm.room.join_rules':
        details.joinRule = asString(evt.content.join_rule)
        break
      case 'm.room.encryption':
        details.encrypted = !!evt.content.algorithm
        break
      case 'm.room.create':
        details.isSpace = evt.content.type === 'm.space'
        break
      case 'm.room.member': {
        const name = asString(evt.content.displayname)
        if (name) memberNames.set(evt.state_key, name)
        // Our own invite event names the inviter and says whether this is a DM.
        if (ownUserID && evt.state_key === ownUserID && evt.content.membership === 'invite') {
          details.inviter = evt.sender
          details.isDM = evt.content.is_direct === true
          details.reason = asString(evt.content.reason)
        }
        break
      }
    }
  }
  if (details.inviter) details.inviterName = memberNames.get(details.inviter) ?? fallbackDisplayName(details.inviter)
  // A DM has no name of its own, so it shows as whoever invited us.
  if (!details.name && details.isDM && details.inviter) details.name = details.inviterName
  return details
}

/** Pending invites, newest first. */
export function useInvites(): InviteDetails[] {
  const ownUserID = useChat(selectOwnUserID)
  return useChat(
    useShallow(s => s.invites.map(invite => inviteDetails(invite, ownUserID)).sort((a, b) => b.createdAt - a.createdAt)),
  )
}

export function useInvite(roomID: RoomID | null): InviteDetails | undefined {
  const ownUserID = useChat(selectOwnUserID)
  return useChat(s => {
    const invite = roomID ? s.invites.find(i => i.room_id === roomID) : undefined
    return invite && inviteDetails(invite, ownUserID)
  })
}

/** Accepts an invite and opens the room once the join lands in a sync. */
export async function acceptInvite(roomID: RoomID) {
  await client.joinRoom(roomID, { fromInvite: true })
  openWhenJoined(roomID)
}

/** Rejects an invite. gomuks drops it from the invite list on the next sync. */
export function declineInvite(roomID: RoomID, reason?: string) {
  return client.leaveRoom(roomID, reason)
}

/** Join rules that mean "you can't just walk in, but you may ask". */
export function canKnock(joinRule: string | undefined): boolean {
  return joinRule === 'knock' || joinRule === 'knock_restricted'
}

export async function fetchRoomSummary(reference: RoomID | string, via?: string[]): Promise<RoomSummary> {
  return client.getRoomSummary(reference, via)
}

/**
 * A room we're not in, shown before joining: what the server will say about it (MSC3266), plus how
 * we got here, so joining can pick up where the link left off.
 */
export interface RoomPreviewState {
  /** What to join by: the alias when we have one, else the room ID. */
  reference: string
  roomID?: RoomID
  alias?: string
  /** Servers to try, from the link that brought us here. */
  via: string[]
  /** A message the link pointed at, jumped to once we're in. */
  eventID?: EventID
  status: 'loading' | 'ready' | 'error'
  summary?: RoomSummary
  error?: string
}

export const useRoomPreview = create<{ preview: RoomPreviewState | null }>()(() => ({ preview: null }))

export function closeRoomPreview() {
  if (useRoomPreview.getState().preview) useRoomPreview.setState({ preview: null })
}

/**
 * Opens the join screen for a room we're not in. The summary is best-effort: a server without
 * MSC3266 (or one that won't talk about the room) still leaves a screen that can try to join.
 */
export async function openRoomPreview(target: { roomID?: RoomID; alias?: string; eventID?: EventID; via?: string[] }) {
  const reference = target.alias ?? target.roomID
  if (!reference) return
  const via = target.via ?? []
  const base: RoomPreviewState = { reference, roomID: target.roomID, alias: target.alias, via, eventID: target.eventID, status: 'loading' }
  useRoomPreview.setState({ preview: base })
  const stillWanted = () => useRoomPreview.getState().preview?.reference === reference
  try {
    const summary = await client.getRoomSummary(reference, via)
    if (!stillWanted()) return
    useRoomPreview.setState({ preview: { ...base, roomID: summary.room_id ?? target.roomID, status: 'ready', summary } })
  } catch (err) {
    if (!stillWanted()) return
    useRoomPreview.setState({ preview: { ...base, status: 'error', error: err instanceof Error ? err.message : String(err) } })
  }
}

/**
 * Joins (or knocks on) the previewed room and follows it in: gomuks answers with the room ID, which
 * the room list picks up a moment later.
 */
export async function joinPreviewedRoom({ knock, reason }: { knock?: boolean; reason?: string } = {}) {
  const preview = useRoomPreview.getState().preview
  if (!preview) return
  const { reference, via, eventID } = preview
  if (knock) {
    await client.knockRoom(reference, { via, reason })
    closeRoomPreview()
    showToast('Asked to join. You’ll get an invite if someone lets you in.')
    return
  }
  const { room_id } = await client.joinRoom(reference, { via, reason })
  closeRoomPreview()
  openWhenJoined(room_id ?? preview.roomID ?? reference, eventID)
}

// Navigating anywhere else (picking a room, following another link) puts the join screen away, so it
// never sits on top of a room the user has since opened.
useUI.subscribe((state, prev) => {
  if (state.activeRoomID !== prev.activeRoomID) closeRoomPreview()
})
