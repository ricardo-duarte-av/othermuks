// Custom emoji and sticker packs (MSC2545 image packs), modelled on gomuks web: packs are room
// state events, the packs a user subscribed to are listed in account data, and recently used
// emoji are shared with Element and gomuks through io.element.recent_emoji.
import { useMemo } from 'react'
import { client } from '@/api/client'
import type { ContentURI, EventID, MediaInfo, MessageEventContent, RoomID } from '@/api/types'
import { applyStateEvents, selectOwnUserID, sendMedia, useChat, type ChatSnapshot } from './chat'
import type { TimelineEvent } from './events'
import { usePreference } from './preferences'

export const PACK_EVENT_TYPE = 'm.room.image_pack'
export const LEGACY_PACK_EVENT_TYPE = 'im.ponies.room_emotes'
export const PACK_ROOMS_TYPE = 'm.image_pack.rooms'
export const LEGACY_PACK_ROOMS_TYPE = 'im.ponies.emote_rooms'
export const RECENT_EMOJI_TYPE = 'io.element.recent_emoji'
const PACK_EVENT_TYPES = [PACK_EVENT_TYPE, LEGACY_PACK_EVENT_TYPE]
const RECENT_EMOJI_LIMIT = 100

export interface CustomEmoji {
  /** mxc:// URI of the image; also the reaction key. */
  key: ContentURI
  shortcode: string
  /** Normalized shortcodes (all names pointing at this image), for searching. */
  search: string[]
  title: string
  info?: MediaInfo
  packID: string
  order?: number
}

export interface ImagePack {
  id: string
  roomID: RoomID
  stateKey: string
  name: string
  icon?: ContentURI
  emojis: CustomEmoji[]
  stickers: CustomEmoji[]
  /** Changes whenever the pack is re-parsed, so hooks can tell packs apart cheaply. */
  revision: number
}

export interface PackEntry {
  pack: ImagePack
  subscribed: boolean
  /** Defined in the room the picker was opened for. */
  fromRoom: boolean
}

export interface PackKey {
  roomID: RoomID
  stateKey: string
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const usageOf = (value: unknown) => (Array.isArray(value) ? value.filter((u): u is string => typeof u === 'string') : [])

export const normalizeShortcode = (shortcode: string) => shortcode.toLowerCase().replaceAll('_', '').replaceAll(' ', '')

export const packIDOf = (roomID: RoomID, stateKey: string) => `${roomID}/${stateKey}`

/** Parses an image pack state event's content (same rules as gomuks's parseCustomEmojiPack). */
export function parseImagePack(content: unknown, roomID: RoomID, stateKey: string, fallbackName: string): ImagePack | null {
  if (!isObject(content) || !isObject(content.images)) return null
  const meta = isObject(content.pack) ? content.pack : {}
  const id = packIDOf(roomID, stateKey)
  const packUsage = usageOf(meta.usage)
  const defaultEmoji = !packUsage.length || packUsage.includes('emoticon')
  const defaultSticker = !packUsage.length || packUsage.includes('sticker')

  const byURL = new Map<string, CustomEmoji>()
  const emojis: CustomEmoji[] = []
  const stickers: CustomEmoji[] = []
  let hasOrder = false
  for (const [shortcode, image] of Object.entries(content.images)) {
    if (!isObject(image) || typeof image.url !== 'string' || !image.url.startsWith('mxc://')) continue
    const existing = byURL.get(image.url)
    if (existing) {
      // Several shortcodes for the same image: one entry, searchable by every name.
      existing.search.push(normalizeShortcode(shortcode))
      continue
    }
    const rawOrder = image['fi.mau.msc4389.order']
    const order = typeof rawOrder === 'number' && Number.isFinite(rawOrder) ? rawOrder : undefined
    hasOrder ||= order !== undefined
    const emoji: CustomEmoji = {
      key: image.url,
      shortcode,
      search: [normalizeShortcode(shortcode)],
      title: typeof image.body === 'string' && image.body ? image.body : shortcode,
      info: isObject(image.info) ? (image.info as MediaInfo) : undefined,
      packID: id,
      order,
    }
    byURL.set(image.url, emoji)
    const usage = usageOf(image.usage)
    if (usage.length ? usage.includes('emoticon') : defaultEmoji) emojis.push(emoji)
    if (usage.length ? usage.includes('sticker') : defaultSticker) stickers.push(emoji)
  }
  if (hasOrder) {
    const byOrder = (a: CustomEmoji, b: CustomEmoji) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
    emojis.sort(byOrder)
    stickers.sort(byOrder)
  }
  const name = typeof meta.display_name === 'string' && meta.display_name ? meta.display_name : fallbackName
  const avatar = typeof meta.avatar_url === 'string' && meta.avatar_url.startsWith('mxc://') ? meta.avatar_url : undefined
  return { id, roomID, stateKey, name, icon: avatar ?? (emojis[0] ?? stickers[0])?.key, emojis, stickers, revision: 0 }
}

// ---- Reading packs from the store ----

const packCache = new WeakMap<TimelineEvent, { name: string; pack: ImagePack | null }>()
let nextRevision = 1

function packEvent(chat: ChatSnapshot, roomID: RoomID, stateKey: string): TimelineEvent | undefined {
  const room = chat.rooms[roomID]
  if (!room) return undefined
  for (const type of PACK_EVENT_TYPES) {
    const rowid = room.state[type]?.[stateKey]
    const evt = rowid === undefined ? undefined : chat.events[rowid]
    if (evt) return evt
  }
  return undefined
}

export function getPack(chat: ChatSnapshot, roomID: RoomID, stateKey: string): ImagePack | null {
  const evt = packEvent(chat, roomID, stateKey)
  if (!evt || evt.redacted_by) return null
  const roomName = chat.rooms[roomID]?.meta.name ?? roomID
  const name = stateKey ? `${roomName} - ${stateKey}` : roomName
  const cached = packCache.get(evt)
  if (cached && cached.name === name) return cached.pack
  const pack = parseImagePack(evt.content, roomID, stateKey, name)
  if (pack) pack.revision = nextRevision++
  packCache.set(evt, { name, pack })
  return pack
}

let subscriptionsCache: { content: unknown; keys: PackKey[] } | null = null

/** Packs the user subscribed to (m.image_pack.rooms, falling back to the legacy im.ponies.emote_rooms). */
export function subscribedPackKeys(chat: ChatSnapshot): PackKey[] {
  const content = (chat.accountData[PACK_ROOMS_TYPE] ?? chat.accountData[LEGACY_PACK_ROOMS_TYPE])?.content
  if (subscriptionsCache && subscriptionsCache.content === content) return subscriptionsCache.keys
  const keys: PackKey[] = []
  if (isObject(content) && isObject(content.rooms)) {
    for (const [roomID, packs] of Object.entries(content.rooms)) {
      if (isObject(packs)) for (const stateKey of Object.keys(packs)) keys.push({ roomID, stateKey })
    }
  }
  subscriptionsCache = { content, keys }
  return keys
}

function roomPackKeys(chat: ChatSnapshot, roomID: RoomID): string[] {
  const room = chat.rooms[roomID]
  if (!room) return []
  return [...new Set(PACK_EVENT_TYPES.flatMap(type => Object.keys(room.state[type] ?? {})))]
}

/** Subscribed packs first (in account data order), then the room's own packs. */
export function listPackEntries(chat: ChatSnapshot, roomID: RoomID | null, includeRoomPacks: boolean): PackEntry[] {
  const subscribed = subscribedPackKeys(chat)
  const subscribedIDs = new Set(subscribed.map(key => packIDOf(key.roomID, key.stateKey)))
  const entries: PackEntry[] = []
  const seen = new Set<string>()
  for (const key of subscribed) {
    const pack = getPack(chat, key.roomID, key.stateKey)
    if (!pack || seen.has(pack.id)) continue
    seen.add(pack.id)
    entries.push({ pack, subscribed: true, fromRoom: key.roomID === roomID })
  }
  if (roomID && includeRoomPacks) {
    for (const stateKey of roomPackKeys(chat, roomID)) {
      const pack = getPack(chat, roomID, stateKey)
      if (!pack || seen.has(pack.id)) continue
      seen.add(pack.id)
      entries.push({ pack, subscribed: subscribedIDs.has(pack.id), fromRoom: true })
    }
  }
  return entries
}

/** Packs available in a room: subscribed ones plus the room's own (if show_room_emoji_packs is on). */
export function useImagePacks(roomID: RoomID | null): PackEntry[] {
  const showRoomPacks = usePreference('show_room_emoji_packs', roomID)
  const signature = useChat(s =>
    listPackEntries(s, roomID, showRoomPacks)
      .map(entry => `${entry.pack.id}#${entry.pack.revision}${entry.subscribed ? '+' : ''}${entry.fromRoom ? '@' : ''}`)
      .join('\n'),
  )
  return useMemo(
    () => listPackEntries(useChat.getState(), roomID, showRoomPacks),
    // The signature captures every change that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature, roomID, showRoomPacks],
  )
}

/** The shortcode of a custom emoji (by mxc URI) from the known packs, e.g. for reaction tooltips. */
export function customEmojiShortcode(chat: ChatSnapshot, roomID: RoomID, key: string): string | undefined {
  for (const { pack } of listPackEntries(chat, roomID, true)) {
    const emoji = pack.emojis.find(e => e.key === key) ?? pack.stickers.find(e => e.key === key)
    if (emoji) return emoji.shortcode
  }
  return undefined
}

// ---- Loading and subscribing ----

const requestedPacks = new Set<string>()

/** Fetches the state events of subscribed packs whose rooms aren't loaded (like gomuks's loadSpecificRoomState). */
export async function loadSubscribedPacks() {
  const chat = useChat.getState()
  const missing = subscribedPackKeys(chat).filter(({ roomID, stateKey }) => {
    const id = packIDOf(roomID, stateKey)
    return !!chat.rooms[roomID] && !packEvent(chat, roomID, stateKey) && !requestedPacks.has(id)
  })
  if (!missing.length) return
  for (const key of missing) requestedPacks.add(packIDOf(key.roomID, key.stateKey))
  try {
    const events = await client.getSpecificRoomState(
      missing.flatMap(({ roomID, stateKey }) => PACK_EVENT_TYPES.map(type => ({ room_id: roomID, type, state_key: stateKey }))),
    )
    if (events?.length) applyStateEvents(events)
  } catch (err) {
    for (const key of missing) requestedPacks.delete(packIDOf(key.roomID, key.stateKey))
    console.error('Failed to load subscribed emoji packs', err)
  }
}

/** Builds the new subscription content; returns null when nothing changes. */
export function updatedSubscriptions(content: unknown, roomID: RoomID, stateKey: string, subscribed: boolean): Record<string, unknown> | null {
  const base = isObject(content) ? content : {}
  const rooms = { ...(isObject(base.rooms) ? base.rooms : {}) }
  const packs = { ...(isObject(rooms[roomID]) ? rooms[roomID] : {}) }
  if (subscribed === stateKey in packs) return null
  if (subscribed) packs[stateKey] = {}
  else delete packs[stateKey]
  if (Object.keys(packs).length) rooms[roomID] = packs
  else delete rooms[roomID]
  return { ...base, rooms }
}

/** Writes both the new and legacy account data types, like gomuks (the new one only if it's in use). */
export async function setPackSubscribed(roomID: RoomID, stateKey: string, subscribed: boolean) {
  const { accountData } = useChat.getState()
  const hasNewType = !!accountData[PACK_ROOMS_TYPE]
  const current = (accountData[PACK_ROOMS_TYPE] ?? accountData[LEGACY_PACK_ROOMS_TYPE])?.content
  const content = updatedSubscriptions(current, roomID, stateKey, subscribed)
  if (!content) return
  await Promise.all([
    hasNewType ? client.setAccountData(PACK_ROOMS_TYPE, content) : undefined,
    client.setAccountData(LEGACY_PACK_ROOMS_TYPE, content),
  ])
}

// ---- Recently used ----

let recentCache: { content: unknown; list: [string, number][]; frequent: Map<string, number> } | null = null

function recentState(chat: ChatSnapshot) {
  const content = chat.accountData[RECENT_EMOJI_TYPE]?.content
  if (recentCache && recentCache.content === content) return recentCache
  const raw = isObject(content) && Array.isArray(content.recent_emoji) ? content.recent_emoji : []
  const list = raw.filter(
    (entry): entry is [string, number] => Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number',
  )
  const frequent = new Map([...list].sort((a, b) => b[1] - a[1]))
  recentCache = { content, list, frequent }
  return recentCache
}

/** Emoji keys (unicode or mxc) by use count, most used first. */
export const frequentEmoji = (chat: ChatSnapshot) => recentState(chat).frequent

/** Moves key to the front with its count increased (Element's io.element.recent_emoji format). */
export function bumpRecentEmoji(list: [string, number][], key: string, limit = RECENT_EMOJI_LIMIT): [string, number][] {
  const index = list.findIndex(([k]) => k === key)
  const count = index >= 0 ? list[index][1] + 1 : 1
  return [[key, count] as [string, number], ...list.filter((_, i) => i !== index)].slice(0, limit)
}

export function recordEmojiUse(key: string) {
  const s = useChat.getState()
  const existing = s.accountData[RECENT_EMOJI_TYPE]
  const content = { ...existing?.content, recent_emoji: bumpRecentEmoji(recentState(s).list, key) }
  // Update locally right away so the picker reflects it; the sync echo replaces it.
  useChat.setState({
    accountData: {
      ...s.accountData,
      [RECENT_EMOJI_TYPE]: { user_id: existing?.user_id ?? selectOwnUserID(s) ?? '', type: RECENT_EMOJI_TYPE, content },
    },
  })
  client.setAccountData(RECENT_EMOJI_TYPE, content).catch(err => console.error('Failed to save recently used emoji', err))
}

// ---- Sending ----

/** Markdown that gomuks turns into <img data-mx-emoticon> when the message is sent. */
export function customEmojiMarkdown(emoji: Pick<CustomEmoji, 'key' | 'shortcode' | 'title'>): string {
  const title = emoji.title && emoji.title !== emoji.shortcode ? emoji.title : `:${emoji.shortcode}:`
  const escaped = title.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  return `![:${emoji.shortcode}:](${emoji.key} "Emoji: ${escaped}")`
}

export function sendSticker(roomID: RoomID, emoji: CustomEmoji, threadRoot?: EventID) {
  const content = { msgtype: 'm.sticker', body: emoji.title, url: emoji.key, info: emoji.info ?? {} } as MessageEventContent
  return sendMedia(roomID, content, threadRoot)
}
