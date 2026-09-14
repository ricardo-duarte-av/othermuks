import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { EventID, EventRowID, RoomID } from '@/api/types'
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

export interface MessageDialog {
  type: 'source' | 'delete'
  rowid: EventRowID
}

interface UIState {
  theme: ThemeID
  activeSpaceID: string
  railExpanded: boolean
  activeRoomID: RoomID | null
  sidebarWidth: number
  drawerOpen: boolean
  /** Root event of the thread shown in the right panel (takes precedence over room details). */
  threadRoot: EventID | null
  paletteOpen: boolean
  replyTo: EventRowID | null
  editing: EventRowID | null
  /** Which composer replyTo/editing belong to: a thread root, or null for the main timeline. */
  composerScope: EventID | null
  dialog: MessageDialog | null
  toast: { id: number; message: string } | null
}

export const useUI = create<UIState>()(
  persist(
    (): UIState => ({
      theme: 'midnight',
      activeSpaceID: HOME_SPACE,
      railExpanded: false,
      activeRoomID: null,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      drawerOpen: false,
      threadRoot: null,
      paletteOpen: false,
      replyTo: null,
      editing: null,
      composerScope: null,
      dialog: null,
      toast: null,
    }),
    {
      name: 'othermuks-ui',
      partialize: s => ({
        theme: s.theme,
        activeSpaceID: s.activeSpaceID,
        railExpanded: s.railExpanded,
        activeRoomID: s.activeRoomID,
        sidebarWidth: s.sidebarWidth,
        drawerOpen: s.drawerOpen,
      }),
    },
  ),
)

export function openRoom(roomID: RoomID) {
  useUI.setState({ activeRoomID: roomID, threadRoot: null, replyTo: null, editing: null, paletteOpen: false })
}

export function openThread(threadRoot: EventID) {
  useUI.setState({ threadRoot })
}

export function setActiveSpace(spaceID: string) {
  useUI.setState({ activeSpaceID: spaceID })
}

export function setSidebarWidth(width: number) {
  useUI.setState({ sidebarWidth: Math.round(Math.min(Math.max(width, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH)) })
}

export function setTheme(theme: ThemeID) {
  useUI.setState({ theme })
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

export function setCodeblockCSS(css: string) {
  let style = document.getElementById('codeblock-theme') as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = 'codeblock-theme'
    document.head.append(style)
  }
  style.textContent = css
}
