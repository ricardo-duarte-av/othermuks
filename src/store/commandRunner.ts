// Runs a slash command resolved from the composer. Most go to gomuks (or a bot) as MSC4391 command
// blocks; /join and /devtools are handled here, as gomuks web handles them in the client too.
import { client } from '@/api/client'
import type { RoomID } from '@/api/types'
import { parseMatrixURI, type MatrixTarget } from '@/lib/matrixURI'
import { addGomuksNotice, sendCommand, useChat } from './chat'
import { argumentsForSource, AVATAR_COMMANDS, GOMUKS_SENDER, type ArgumentValue, type CommandSpec } from './commands'
import type { TimelineEvent } from './events'
import { jumpToEvent, openMatrixTarget } from './navigation'
import { openRoom, openStateExplorer, showToast } from './ui'

export interface CommandContext {
  roomID: RoomID
  /** The text as typed, used as the message body for bots. */
  body: string
  replyTo?: TimelineEvent
  threadRoot?: string
  /** An image attached to the command (the avatar commands need one). */
  attachment?: File
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

const escapeHTML = (value: string) =>
  value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

/** The room commands work on: the one given, or the room a matrix: link or alias points to. */
function referenceTarget(reference: string): MatrixTarget | { kind: 'event'; eventID: string } | null {
  const link = /^\[.+]\(([^)]+)\)$/.exec(reference)
  if (link) reference = link[1]
  const parsed = parseMatrixURI(reference)
  if (parsed) return parsed
  switch (reference[0]) {
    case '!':
      return { kind: 'room', roomID: reference, via: [] }
    case '#':
      return { kind: 'room', alias: reference, via: [] }
    case '@':
      return { kind: 'user', userID: reference }
    case '$':
      return { kind: 'event', eventID: reference }
  }
  return null
}

/** Opens the room once it shows up in a sync, for rooms joined by command. */
function openWhenJoined(roomID: RoomID) {
  if (useChat.getState().rooms[roomID]) {
    openRoom(roomID)
    return
  }
  const unsubscribe = useChat.subscribe(s => {
    if (!s.rooms[roomID]) return
    unsubscribe()
    clearTimeout(timeout)
    openRoom(roomID)
  })
  const timeout = setTimeout(unsubscribe, 60_000)
}

/**
 * /join jumps to rooms that are already joined (and to users and messages, like gomuks web), and asks
 * gomuks to join the rest, opening them once they arrive.
 */
async function join(spec: CommandSpec, args: Record<string, ArgumentValue>, ctx: CommandContext) {
  const reference = String(args.room_reference ?? '').trim()
  const target = referenceTarget(reference)
  if (!target) {
    addGomuksNotice(ctx.roomID, `Invalid room reference <code>${escapeHTML(reference)}</code>`)
    return
  }
  if (target.kind === 'event') {
    jumpToEvent(ctx.roomID, target.eventID)
    return
  }
  if (target.kind === 'user') {
    await openMatrixTarget(target)
    return
  }
  let roomID = target.roomID
  const rooms = useChat.getState().rooms
  if (!roomID && target.alias) {
    roomID = Object.values(rooms).find(room => room.meta.canonical_alias === target.alias)?.meta.room_id
    if (!roomID) {
      try {
        roomID = (await client.resolveAlias(target.alias)).room_id
      } catch (err) {
        addGomuksNotice(ctx.roomID, `Failed to resolve alias <code>${escapeHTML(target.alias)}</code>: ${escapeHTML(errorText(err))}`)
        return
      }
    }
  }
  if (roomID && useChat.getState().rooms[roomID]) {
    await openMatrixTarget({ ...target, roomID })
    return
  }
  const via = [...new Set([...(Array.isArray(args.via) ? args.via.map(String) : []), ...target.via])]
  // gomuks joins by the raw reference, so hand it the ID or alias rather than a link.
  const joinArgs: Record<string, ArgumentValue> = { room_reference: target.roomID ?? target.alias ?? reference }
  if (typeof args.reason === 'string' && args.reason) joinArgs.reason = args.reason
  if (via.length) joinArgs.via = via
  showToast('Joining…')
  await sendCommand(ctx.roomID, ctx.body, { command: spec.command, arguments: joinArgs }, GOMUKS_SENDER, ctx)
  if (roomID) openWhenJoined(roomID)
}

export async function runCommand(spec: CommandSpec, args: Record<string, ArgumentValue>, ctx: CommandContext) {
  if (spec.source === GOMUKS_SENDER) {
    if (spec.command === 'devtools') {
      openStateExplorer(ctx.roomID)
      return
    }
    if (spec.command === 'join') {
      await join(spec, args, ctx)
      return
    }
  }
  let media
  if (ctx.attachment) {
    // Avatars have to be readable by everyone, so their image is never encrypted (gomuks refuses those).
    const encrypt = !AVATAR_COMMANDS.has(spec.command) && !!useChat.getState().rooms[ctx.roomID]?.meta.encryption_event
    media = await client.upload(ctx.attachment, encrypt)
  }
  await sendCommand(
    ctx.roomID,
    ctx.body,
    { command: spec.command, arguments: argumentsForSource(spec, args, ctx.roomID) },
    spec.source,
    { replyTo: ctx.replyTo, threadRoot: ctx.threadRoot, media },
  )
}
