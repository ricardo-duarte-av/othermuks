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
] as const

export type ThemeID = (typeof THEMES)[number]['id']

export const SIDEBAR_DEFAULT_WIDTH = 288
const SIDEBAR_MIN_WIDTH = 220
const SIDEBAR_MAX_WIDTH = 520

export const RIGHT_PANEL_DEFAULT_WIDTH = 360
const RIGHT_PANEL_MIN_WIDTH = 280
const RIGHT_PANEL_MAX_WIDTH = 720

export interface MessageDialog {
  type: 'source' | 'delete' | 'original' | 'edits' | 'reactions'
  rowid: EventRowID
}

export function openMessageDialog(type: MessageDialog['type'], rowid: EventRowID) {
  useUI.setState({ dialog: { type, rowid } })
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
  lightbox: { url: string; name?: string } | null
  dialog: MessageDialog | null
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
    replyTo: null,
    editing: null,
    highlight: null,
    paletteOpen: false,
  })
}

export function openThread(threadRoot: EventID) {
  useUI.setState({ threadRoot, profileUserID: null })
}

export function openProfile(userID: UserID) {
  useUI.setState({ profileUserID: userID })
}

export function openLightbox(url: string, name?: string) {
  useUI.setState({ lightbox: { url, name } })
}

export function setActiveSpace(spaceID: string) {
  useUI.setState({ activeSpaceID: spaceID })
}

const clamp = (value: number, min: number, max: number) => Math.round(Math.min(Math.max(value, min), max))

export function setSidebarWidth(width: number) {
  useUI.setState({ sidebarWidth: clamp(width, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH) })
}

export function setRightPanelWidth(width: number) {
  useUI.setState({ rightPanelWidth: clamp(width, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH) })
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
