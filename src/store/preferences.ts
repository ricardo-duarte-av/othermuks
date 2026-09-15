// Scoped preferences, compatible with gomuks web (web/src/api/types/preferences).
// A preference can be set per account (account data), per device (localStorage), per room for the
// account (room account data) and per room on this device. The most specific defined value wins.
import { useCallback, useMemo } from 'react'
import { create } from 'zustand'
import { client } from '@/api/client'
import type { RoomID } from '@/api/types'
import { useChat, type ChatSnapshot } from './chat'
import type { TimelineFilter } from './events'
import type { RoomSortOptions } from './spaces'

export const PREFERENCES_EVENT_TYPE = 'fi.mau.gomuks.preferences'

export const PreferenceContext = {
  Account: 'account',
  Device: 'device',
  RoomAccount: 'room_account',
  RoomDevice: 'room_device',
} as const

export type PreferenceContext = (typeof PreferenceContext)[keyof typeof PreferenceContext]

/** Resolution order, most specific first (same as gomuks). */
const anyContext: PreferenceContext[] = [PreferenceContext.RoomDevice, PreferenceContext.RoomAccount, PreferenceContext.Device, PreferenceContext.Account]
const anyGlobalContext: PreferenceContext[] = [PreferenceContext.Device, PreferenceContext.Account]
const deviceOnly: PreferenceContext[] = [PreferenceContext.Device]

export type PreferenceValue = boolean | number | string

export type PreferenceGroup = 'Privacy' | 'Notifications' | 'Timeline' | 'Media' | 'Composer' | 'Code' | 'Room list'

export interface Preference<T extends PreferenceValue = PreferenceValue> {
  displayName: string
  description: string
  group: PreferenceGroup
  allowedContexts: PreferenceContext[]
  defaultValue: T
  allowedValues?: readonly T[]
  valueLabels?: readonly string[]
  minValue?: number
  maxValue?: number
  numberType?: 'number' | 'range'
}

export const CODE_BLOCK_STYLES = [
  'auto', 'abap', 'algol_nu', 'algol', 'arduino', 'autumn', 'average', 'base16-snazzy', 'borland', 'bw',
  'catppuccin-frappe', 'catppuccin-latte', 'catppuccin-macchiato', 'catppuccin-mocha', 'colorful', 'doom-one2',
  'doom-one', 'dracula', 'emacs', 'friendly', 'fruity', 'github-dark', 'github', 'gruvbox-light', 'gruvbox',
  'hrdark', 'hr_high_contrast', 'igor', 'lovelace', 'manni', 'modus-operandi', 'modus-vivendi', 'monokailight',
  'monokai', 'murphy', 'native', 'nord', 'onedark', 'onesenterprise', 'paraiso-dark', 'paraiso-light', 'pastie',
  'perldoc', 'pygments', 'rainbow_dash', 'rose-pine-dawn', 'rose-pine-moon', 'rose-pine', 'rrt', 'solarized-dark256',
  'solarized-dark', 'solarized-light', 'swapoff', 'tango', 'tokyonight-day', 'tokyonight-moon', 'tokyonight-night',
  'tokyonight-storm', 'trac', 'vim', 'vs', 'vulcan', 'witchhazel', 'xcode-dark', 'xcode',
] as const

const bool = (
  group: PreferenceGroup,
  displayName: string,
  description: string,
  defaultValue: boolean,
  allowedContexts = anyContext,
): Preference<boolean> => ({ group, displayName, description, defaultValue, allowedContexts })

/** Only preferences othermuks implements; keys and meanings match gomuks web so values are shared. */
export const preferences = {
  send_read_receipts: bool(
    'Privacy',
    'Send read receipts',
    'Should read receipts be sent to other users? If disabled, read receipts will use the m.read.private type, which only syncs to your own devices.',
    true,
  ),
  send_typing_notifications: bool('Privacy', 'Send typing notifications', 'Should typing notifications be sent to other users?', true),

  web_push: bool(
    'Notifications',
    'Push notifications',
    'Get notified by gomuks through web push, even when othermuks is closed. Each browser registers separately, so this can only be set per device.',
    false,
    deviceOnly,
  ),

  display_read_receipts: bool('Timeline', 'Display read receipts', 'Should read receipts be rendered in the timeline?', true),
  show_hidden_events: bool('Timeline', 'Show hidden events', 'Whether hidden events (e.g. member events that change nothing) should be visible in the room timeline.', true),
  show_redacted_events: bool('Timeline', 'Show redacted event placeholders', 'Whether redacted events should leave a placeholder behind in the room timeline.', true),
  show_membership_events: bool('Timeline', 'Show membership events', 'Whether any membership events should be visible in the room timeline.', true),
  show_profile_changes: bool('Timeline', 'Show profile change events', 'Whether profile changes should be visible in the room timeline.', true),
  show_date_separators: bool('Timeline', 'Show date separators', 'Whether messages in different days should have a date separator between them in the room timeline.', true),
  small_replies: bool('Timeline', 'Compact reply style', 'Whether to use a Discord-like compact style for replies instead of the traditional style.', false),

  show_media_previews: bool(
    'Media',
    'Show image and video previews',
    'If disabled, images and videos will only be visible after clicking and will not be downloaded automatically.',
    true,
  ),
  show_inline_images: bool('Media', 'Show inline images', 'If disabled, custom emojis and other inline images will not be rendered and the alt text will be shown instead.', true),
  autoplay_gifs: bool('Media', 'Autoplay GIFs', 'Whether animated GIFs should play automatically instead of requiring hover.', true),
  max_image_width: {
    group: 'Media',
    displayName: 'Max image width',
    description: 'Maximum width of images in the timeline, in pixels.',
    allowedContexts: anyContext,
    defaultValue: 420,
    minValue: 80,
    maxValue: 1920,
    numberType: 'number',
  } satisfies Preference<number>,

  ctrl_enter_send: bool('Composer', 'Use Ctrl+Enter to send', 'Disable sending on Enter and use Ctrl+Enter for sending instead.', false),
  refocus_input_after_send: bool('Composer', 'Re-focus composer after send', 'Should the composer text area be immediately focused again after the send button is clicked?', true),
  ctrl_arrow_reply: bool('Composer', 'Use Ctrl+Arrow to reply', "Should Ctrl+Arrow Up/Down change the message you're replying to?", true),
  show_room_emoji_packs: bool(
    'Composer',
    'Show room emoji packs',
    'Whether custom emoji and sticker packs defined in the current room are offered in the picker, in addition to the packs you subscribed to.',
    true,
  ),

  code_block_line_wrap: bool('Code', 'Code block line wrap', 'Whether to wrap long lines in code blocks instead of scrolling horizontally.', false),
  code_block_theme: {
    group: 'Code',
    displayName: 'Code block theme',
    description: 'The syntax highlighting theme to use for code blocks. "auto" follows the othermuks theme.',
    // gomuks allows per-room themes; othermuks loads one stylesheet, so only global scopes apply here.
    allowedContexts: anyGlobalContext,
    defaultValue: 'auto',
    allowedValues: CODE_BLOCK_STYLES,
  } satisfies Preference<string>,

  room_list_preview: bool('Room list', 'Previews in room list', 'Should the room list have previews of message contents?', true),
  compact_room_list: bool('Room list', 'Compact room list', "Use a compact room list that takes less space and doesn't have message previews.", false, anyGlobalContext),
  pin_favorites: bool('Room list', 'Pin favorites to top', 'Always keep favorited rooms at the top of the room list, ignoring recent activity.', false, anyGlobalContext),
  pin_low_priority: bool('Room list', 'Pin low priority to bottom', 'Always keep low priority rooms at the bottom of the room list, ignoring recent activity.', false, anyGlobalContext),
  mute_low_priority: bool('Room list', 'No unreads in low priority', 'Disable the unread message counter in low priority rooms. Notifications and highlights are still counted.', false, anyGlobalContext),
  alphabetical_order: bool('Room list', 'Alphabetical room list', 'Sort rooms by name instead of recent activity.', false, anyGlobalContext),
} satisfies Record<string, Preference>

export type PreferenceKey = keyof typeof preferences
export type PreferenceValueOf<K extends PreferenceKey> = (typeof preferences)[K]['defaultValue'] extends boolean
  ? boolean
  : (typeof preferences)[K]['defaultValue'] extends number
    ? number
    : string

export type PreferenceValues = Partial<Record<string, unknown>>

// ---- Device-local storage (same localStorage keys as gomuks web) ----

const GLOBAL_KEY = 'global_prefs'
const roomKey = (roomID: RoomID) => `prefs-${roomID}`

function readStorage(key: string): PreferenceValues {
  try {
    const raw = localStorage.getItem(key)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as PreferenceValues) : {}
  } catch {
    return {}
  }
}

function writeStorage(key: string, values: PreferenceValues) {
  try {
    if (Object.keys(values).length) localStorage.setItem(key, JSON.stringify(values))
    else localStorage.removeItem(key)
  } catch {
    // Storage blocked or full: the value still applies for this session.
  }
}

interface LocalPrefsState {
  global: PreferenceValues
  rooms: Record<RoomID, PreferenceValues>
}

export const useLocalPrefs = create<LocalPrefsState>()(() => ({ global: readStorage(GLOBAL_KEY), rooms: {} }))

const EMPTY: PreferenceValues = {}

/** Room device prefs are read from storage the first time a room asks for them. */
function localRoomPrefs(s: LocalPrefsState, roomID: RoomID): PreferenceValues {
  const cached = s.rooms[roomID]
  if (cached) return cached
  const stored = readStorage(roomKey(roomID))
  // Cache outside of a render-time setState; the object identity stays stable afterwards.
  s.rooms[roomID] = Object.keys(stored).length ? stored : EMPTY
  return s.rooms[roomID]
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key === GLOBAL_KEY) useLocalPrefs.setState({ global: readStorage(GLOBAL_KEY) })
    else if (e.key?.startsWith('prefs-')) {
      const roomID = e.key.slice('prefs-'.length)
      useLocalPrefs.setState(s => ({ rooms: { ...s.rooms, [roomID]: readStorage(e.key!) } }))
    }
  })
}

// ---- Resolution ----

function accountPrefs(chat: ChatSnapshot): PreferenceValues {
  return chat.accountData[PREFERENCES_EVENT_TYPE]?.content ?? EMPTY
}

function roomAccountPrefs(chat: ChatSnapshot, roomID: RoomID): PreferenceValues {
  return chat.rooms[roomID]?.accountData[PREFERENCES_EVENT_TYPE]?.content ?? EMPTY
}

/** The stored values for one scope. */
export function scopeValues(context: PreferenceContext, chat: ChatSnapshot, local: LocalPrefsState, roomID?: RoomID | null): PreferenceValues {
  switch (context) {
    case PreferenceContext.Account:
      return accountPrefs(chat)
    case PreferenceContext.Device:
      return local.global
    case PreferenceContext.RoomAccount:
      return roomID ? roomAccountPrefs(chat, roomID) : EMPTY
    case PreferenceContext.RoomDevice:
      return roomID ? localRoomPrefs(local, roomID) : EMPTY
  }
}

export function isValidValue(key: PreferenceKey, value: unknown): value is PreferenceValue {
  const pref: Preference = preferences[key]
  if (typeof value !== typeof pref.defaultValue) return false
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return false
    if (pref.minValue !== undefined && value < pref.minValue) return false
    if (pref.maxValue !== undefined && value > pref.maxValue) return false
  }
  if (pref.allowedValues && !pref.allowedValues.includes(value as PreferenceValue)) return false
  return true
}

export function resolvePreference<K extends PreferenceKey>(
  key: K,
  chat: ChatSnapshot,
  local: LocalPrefsState,
  roomID?: RoomID | null,
): PreferenceValueOf<K> {
  const pref: Preference = preferences[key]
  for (const context of pref.allowedContexts) {
    const value = scopeValues(context, chat, local, roomID)[key]
    if (value !== undefined && isValidValue(key, value)) return value as PreferenceValueOf<K>
  }
  return pref.defaultValue as PreferenceValueOf<K>
}

/** Current value outside React. */
export function getPreference<K extends PreferenceKey>(key: K, roomID?: RoomID | null): PreferenceValueOf<K> {
  return resolvePreference(key, useChat.getState(), useLocalPrefs.getState(), roomID)
}

/** Effective value of a preference, optionally for a room; re-renders only when that value changes. */
export function usePreference<K extends PreferenceKey>(key: K, roomID?: RoomID | null): PreferenceValueOf<K> {
  const local = useLocalPrefs()
  const select = useCallback((chat: ChatSnapshot) => resolvePreference(key, chat, local, roomID), [key, local, roomID])
  return useChat(select)
}

/** Timeline visibility preferences for a room, as one stable object. */
export function useTimelineFilter(roomID: RoomID): TimelineFilter {
  const showHidden = usePreference('show_hidden_events', roomID)
  const showRedacted = usePreference('show_redacted_events', roomID)
  const showMembership = usePreference('show_membership_events', roomID)
  const showProfileChanges = usePreference('show_profile_changes', roomID)
  return useMemo(
    () => ({ showHidden, showRedacted, showMembership, showProfileChanges }),
    [showHidden, showRedacted, showMembership, showProfileChanges],
  )
}

/** Room list ordering preferences (global scopes only). */
export function useRoomSort(): RoomSortOptions {
  const alphabetical = usePreference('alphabetical_order')
  const pinFavourites = usePreference('pin_favorites')
  const pinLowPriority = usePreference('pin_low_priority')
  return useMemo(() => ({ alphabetical, pinFavourites, pinLowPriority }), [alphabetical, pinFavourites, pinLowPriority])
}

export function getRoomSort(): RoomSortOptions {
  return {
    alphabetical: getPreference('alphabetical_order'),
    pinFavourites: getPreference('pin_favorites'),
    pinLowPriority: getPreference('pin_low_priority'),
  }
}

// ---- Writing ----

export async function setPreference(context: PreferenceContext, key: PreferenceKey, value: PreferenceValue | undefined, roomID?: RoomID | null) {
  const update = (values: PreferenceValues) => {
    const next = { ...values }
    if (value === undefined) delete next[key]
    else next[key] = value
    return next
  }
  switch (context) {
    case PreferenceContext.Account: {
      // Keep every other key, including ones only gomuks web knows about.
      await client.setAccountData(PREFERENCES_EVENT_TYPE, update(accountPrefs(useChat.getState())))
      break
    }
    case PreferenceContext.RoomAccount: {
      if (!roomID) return
      await client.setAccountData(PREFERENCES_EVENT_TYPE, update(roomAccountPrefs(useChat.getState(), roomID)), roomID)
      break
    }
    case PreferenceContext.Device: {
      const global = update(useLocalPrefs.getState().global)
      writeStorage(GLOBAL_KEY, global)
      useLocalPrefs.setState({ global })
      break
    }
    case PreferenceContext.RoomDevice: {
      if (!roomID) return
      const values = update(localRoomPrefs(useLocalPrefs.getState(), roomID))
      writeStorage(roomKey(roomID), values)
      useLocalPrefs.setState(s => ({ rooms: { ...s.rooms, [roomID]: values } }))
      break
    }
  }
}
