import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { EventID, EventRowID, RoomID, UserID } from '@/api/types'
import { HOME_SPACE } from './spaces'

/** `codeblock` is the chroma style served by /_gomuks/codeblock/{style}.css for highlighted code. */
export const THEMES = [
  { id: 'midnight', label: 'Midnight', codeblock: 'github-dark' },
  { id: 'daylight', label: 'Daylight', codeblock: 'github' },
  { id: 'dracula', label: 'Dracula', codeblock: 'dracula' },
  { id: 'mocha', label: 'Catppuccin Mocha', codeblock: 'catppuccin-mocha' },
  { id: 'nord', label: 'Nord', codeblock: 'nord' },
  { id: 'gruvbox', label: 'Gruvbox', codeblock: 'gruvbox' },
  { id: 'gruvbox-light', label: 'Gruvbox Light', codeblock: 'gruvbox-light' },
] as const

export type ThemeID = (typeof THEMES)[number]['id']

export const SIDEBAR_DEFAULT_WIDTH = 288
const SIDEBAR_MIN_WIDTH = 220
const SIDEBAR_MAX_WIDTH = 520

export const RIGHT_PANEL_DEFAULT_WIDTH = 360
const RIGHT_PANEL_MIN_WIDTH = 280
/** The right panel can grow until only this much of the room timeline is left. */
export const MIN_TIMELINE_WIDTH = 360
/** Widgets (calls especially) open at least this wide. */
const WIDGET_PANEL_MIN_WIDTH = 560
/** Space rail width estimate for clamping; CSS enforces the exact limit. */
const RAIL_WIDTH_ESTIMATE = 72

function rightPanelMaxWidth(sidebarWidth: number) {
  if (typeof window === 'undefined') return 1600
  return Math.max(RIGHT_PANEL_MIN_WIDTH, window.innerWidth - sidebarWidth - RAIL_WIDTH_ESTIMATE - MIN_TIMELINE_WIDTH)
}

/** Right panel views that belong to the room rather than to a message or person. */
export type RoomTool = 'pins' | 'search' | 'mentions'

export interface MessageDialog {
  type: 'source' | 'delete' | 'original' | 'edits' | 'reactions' | 'receipts'
  rowid: EventRowID
  /** Receipts dialog: whose receipts are shown on the row. */
  userIDs?: UserID[]
}

export function openMessageDialog(type: MessageDialog['type'], rowid: EventRowID, extra: Pick<MessageDialog, 'userIDs'> = {}) {
  useUI.setState({ dialog: { type, rowid, ...extra } })
}

interface UIState {
  theme: ThemeID
  /** CSS custom property values (without the leading --) layered over the base theme. */
  themeOverrides: Record<string, string>
  customCSS: string
  appearanceOpen: boolean
  activeSpaceID: string
  railExpanded: boolean
  activeRoomID: RoomID | null
  sidebarWidth: number
  rightPanelWidth: number
  // Right panel: a profile shows above a thread, which shows above room details.
  // Closing the top one reveals whatever was open underneath.
  drawerOpen: boolean
  threadRoot: EventID | null
  profileUserID: UserID | null
  paletteOpen: boolean
  replyTo: EventRowID | null
  editing: EventRowID | null
  /** Which composer replyTo/editing belong to: a thread root, or null for the main timeline. */
  composerScope: EventID | null
  /** Message being jumped to; nonce distinguishes repeated jumps to the same message. */
  highlight: { rowid: EventRowID; nonce: number } | null
  lightbox: LightboxImage | null
  dialog: MessageDialog | null
  /** Settings dialog, optionally showing the room scopes for a room. */
  settings: { roomID: RoomID | null } | null
  /** Right panel widgets view: the room's widget list, or one widget (CALL_WIDGET_ID for Element Call). */
  widgetView: { mode: 'list' } | { mode: 'widget'; widgetID: string } | null
  /** Right panel tool view (sits above room details, below widgets). */
  roomTool: RoomTool | null
  toast: { id: number; message: string } | null
}

export const useUI = create<UIState>()(
  persist(
    (): UIState => ({
      theme: 'midnight',
      themeOverrides: {},
      customCSS: '',
      appearanceOpen: false,
      activeSpaceID: HOME_SPACE,
      railExpanded: false,
      activeRoomID: null,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      rightPanelWidth: RIGHT_PANEL_DEFAULT_WIDTH,
      drawerOpen: false,
      threadRoot: null,
      profileUserID: null,
      paletteOpen: false,
      replyTo: null,
      editing: null,
      composerScope: null,
      highlight: null,
      lightbox: null,
      dialog: null,
      settings: null,
      widgetView: null,
      roomTool: null,
      toast: null,
    }),
    {
      name: 'othermuks-ui',
      partialize: s => ({
        theme: s.theme,
        themeOverrides: s.themeOverrides,
        customCSS: s.customCSS,
        activeSpaceID: s.activeSpaceID,
        railExpanded: s.railExpanded,
        activeRoomID: s.activeRoomID,
        sidebarWidth: s.sidebarWidth,
        rightPanelWidth: s.rightPanelWidth,
        drawerOpen: s.drawerOpen,
      }),
    },
  ),
)

export function openRoom(roomID: RoomID) {
  useUI.setState({
    activeRoomID: roomID,
    threadRoot: null,
    profileUserID: null,
    // Widgets belong to their room; a call that asked to stay on screen pops out instead.
    widgetView: null,
    replyTo: null,
    editing: null,
    highlight: null,
    paletteOpen: false,
  })
}

export function openRoomTool(tool: RoomTool) {
  useUI.setState({ roomTool: tool, widgetView: null, threadRoot: null, profileUserID: null })
}

export function closeRoomTool() {
  useUI.setState({ roomTool: null })
}

export function openWidgetList() {
  useUI.setState({ widgetView: { mode: 'list' }, roomTool: null, threadRoot: null, profileUserID: null })
}

export function openWidget(widgetID: string) {
  useUI.setState(s => ({
    widgetView: { mode: 'widget', widgetID },
    roomTool: null,
    threadRoot: null,
    profileUserID: null,
    rightPanelWidth: Math.max(s.rightPanelWidth, Math.min(WIDGET_PANEL_MIN_WIDTH, rightPanelMaxWidth(s.sidebarWidth))),
  }))
}

export function closeWidgets() {
  useUI.setState({ widgetView: null })
}

export function openSettings(roomID: RoomID | null = null) {
  useUI.setState({ settings: { roomID } })
}

export function closeSettings() {
  useUI.setState({ settings: null })
}

export function openThread(threadRoot: EventID) {
  useUI.setState({ threadRoot, profileUserID: null })
}

export function openProfile(userID: UserID) {
  useUI.setState({ profileUserID: userID })
}

export interface LightboxImage {
  url: string
  name?: string
  /** Blurhash placeholder (data: URL) plus the image's size, shown until the full image loads. */
  placeholder?: string
  width?: number
  height?: number
  /** Where it was opened from, so the viewer can zoom out of it: the box on screen and what filled it. */
  from?: { rect: { top: number; left: number; width: number; height: number }; url?: string }
}

export function openLightbox(url: string, name?: string, extra: Omit<LightboxImage, 'url' | 'name'> = {}) {
  useUI.setState({ lightbox: { url, name, ...extra } })
}

export function setActiveSpace(spaceID: string) {
  useUI.setState({ activeSpaceID: spaceID })
}

const clamp = (value: number, min: number, max: number) => Math.round(Math.min(Math.max(value, min), max))

export function setSidebarWidth(width: number) {
  useUI.setState({ sidebarWidth: clamp(width, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH) })
}

export function setRightPanelWidth(width: number) {
  useUI.setState(s => ({ rightPanelWidth: clamp(width, RIGHT_PANEL_MIN_WIDTH, rightPanelMaxWidth(s.sidebarWidth)) }))
}

export function setTheme(theme: ThemeID) {
  useUI.setState({ theme })
}

/** Sets (or with null, removes) a theme token override, e.g. setThemeOverride('accent', '#ff00aa'). */
export function setThemeOverride(token: string, value: string | null) {
  useUI.setState(s => {
    const themeOverrides = { ...s.themeOverrides }
    if (value) themeOverrides[token] = value
    else delete themeOverrides[token]
    return { themeOverrides }
  })
}

export function resetThemeOverrides() {
  useUI.setState({ themeOverrides: {} })
}

export function setCustomCSS(customCSS: string) {
  useUI.setState({ customCSS })
}

let toastID = 0

export function showToast(message: string) {
  useUI.setState({ toast: { id: ++toastID, message } })
}

export function applyTheme(theme: ThemeID) {
  document.documentElement.dataset.theme = theme
}

/** Code highlighting CSS for a theme, fetched from the backend (it needs auth, so no plain <link>). */
export function codeblockStyleFor(theme: ThemeID): string {
  return THEMES.find(t => t.id === theme)?.codeblock ?? 'github-dark'
}

const THEME_OVERRIDES_ID = 'othermuks-theme-overrides'
const CUSTOM_CSS_ID = 'othermuks-custom-css'

function setStyleElement(id: string, css: string) {
  let style = document.getElementById(id) as HTMLStyleElement | null
  if (!css) {
    style?.remove()
    return
  }
  if (!style) {
    style = document.createElement('style')
    style.id = id
    document.head.append(style)
  }
  style.textContent = css
}

/** User CSS must come after every other stylesheet so it wins. */
function keepCustomCSSLast() {
  const custom = document.getElementById(CUSTOM_CSS_ID)
  if (custom && custom !== document.head.lastElementChild) document.head.append(custom)
}

export function setCodeblockCSS(css: string) {
  setStyleElement('codeblock-theme', css)
  keepCustomCSSLast()
}

function applyUserStyles({ themeOverrides, customCSS }: Pick<UIState, 'themeOverrides' | 'customCSS'>) {
  const declarations = Object.entries(themeOverrides)
    .map(([token, value]) => `  --${token}: ${value};`)
    .join('\n')
  // :root:root outranks the [data-theme] palettes without !important.
  setStyleElement(THEME_OVERRIDES_ID, declarations ? `:root:root {\n${declarations}\n}` : '')
  setStyleElement(CUSTOM_CSS_ID, customCSS)
  keepCustomCSSLast()
}

applyUserStyles(useUI.getState())
useUI.subscribe((state, prev) => {
  if (state.themeOverrides !== prev.themeOverrides || state.customCSS !== prev.customCSS) applyUserStyles(state)
})
