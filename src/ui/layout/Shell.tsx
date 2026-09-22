import { AnimatePresence } from 'motion/react'
import { MessagesSquare } from 'lucide-react'
import { useEffect } from 'react'
import { useChat } from '@/store/chat'
import { closeRoomPreview, useInvite, useRoomPreview } from '@/store/membership'
import { getRoomSort } from '@/store/preferences'
import { roomIDsInRows, spaceListRows } from '@/store/spaces'
import { closeRoomTool, MIN_TIMELINE_WIDTH, openRoom, openRoomTool, useUI } from '@/store/ui'
import { AppearanceDialog } from '@/ui/AppearanceDialog'
import { Lightbox } from '@/ui/Lightbox'
import { CommandPalette } from '@/ui/palette/CommandPalette'
import { Kbd, Spinner } from '@/ui/primitives'
import { MessageDialogs, Toaster } from '@/ui/room/MessageDialogs'
import { StateExplorer } from '@/ui/room/StateExplorer'
import { RightPanel, type RightPanelKind } from '@/ui/room/RightPanel'
import { InviteView } from '@/ui/room/InviteView'
import { JoinRoomView } from '@/ui/room/JoinRoomView'
import { RoomView } from '@/ui/room/RoomView'
import { installMatrixLinkHandler } from '@/ui/matrixLinks'
import { SettingsDialog } from '@/ui/settings/SettingsDialog'
import { PermissionDialog } from '@/ui/widget/PermissionDialog'
import { Sidebar } from '@/ui/sidebar/Sidebar'
import { SpaceRail } from '@/ui/sidebar/SpaceRail'

function isEditable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
  )
}

/** Moves to the previous/next room in the currently shown room list. */
function stepRoom(delta: number) {
  const { activeSpaceID, activeRoomID } = useUI.getState()
  const roomIDs = roomIDsInRows(spaceListRows(useChat.getState(), activeSpaceID, getRoomSort()))
  const index = roomIDs.indexOf(activeRoomID ?? '')
  const next = roomIDs[Math.min(Math.max(index + delta, 0), roomIDs.length - 1)]
  if (next) openRoom(next)
}

function useGlobalShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const ui = useUI.getState()
      // Modal overlays handle their own keys (Esc closes them, R rotates in the lightbox).
      const overlayOpen = ui.paletteOpen || !!ui.dialog || !!ui.stateExplorer || !!ui.lightbox || ui.appearanceOpen || !!ui.settings
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        useUI.setState({ paletteOpen: !ui.paletteOpen })
      } else if (overlayOpen) {
        return
      } else if (mod && e.key === '.') {
        e.preventDefault()
        // Shows room details (replacing a thread or profile on top), or hides them.
        const detailsVisible = ui.drawerOpen && !ui.threadRoot && !ui.profileUserID && !ui.widgetView && !ui.roomTool
        useUI.setState({ drawerOpen: !detailsVisible, threadRoot: null, profileUserID: null, widgetView: null, roomTool: null })
      } else if (mod && e.key.toLowerCase() === 'f' && ui.activeRoomID) {
        // Same binding gomuks uses for its search panel, in place of the browser's find.
        e.preventDefault()
        const searchVisible = ui.roomTool === 'search' && !ui.threadRoot && !ui.profileUserID && !ui.widgetView
        if (searchVisible) closeRoomTool()
        else openRoomTool('search')
      } else if (e.key === 'Escape' && !isEditable(e.target) && useRoomPreview.getState().preview) {
        closeRoomPreview()
      } else if (
        e.key === 'Escape' &&
        !isEditable(e.target) &&
        (ui.profileUserID || ui.threadRoot || ui.widgetView?.mode === 'list' || (!ui.widgetView && (!!ui.roomTool || ui.drawerOpen)))
      ) {
        // Close the top-most right panel view, revealing what's underneath. An open widget (a call)
        // isn't closed by Esc, which is too easy to hit by accident.
        if (ui.profileUserID) useUI.setState({ profileUserID: null })
        else if (ui.threadRoot) useUI.setState({ threadRoot: null })
        else if (ui.widgetView) useUI.setState({ widgetView: null })
        else if (ui.roomTool) useUI.setState({ roomTool: null })
        else useUI.setState({ drawerOpen: false })
      } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        stepRoom(e.key === 'ArrowUp' ? -1 : 1)
      } else if (!mod && !e.altKey && e.key.length === 1 && !isEditable(e.target)) {
        // Type anywhere to start composing.
        document.getElementById('composer-input')?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

function ConnectionBanner() {
  const connection = useChat(s => s.connection)
  const syncStatus = useChat(s => s.syncStatus)

  let message: string | null = null
  if (!connection.connected) {
    const retry = connection.nextAttempt ? `, retrying at ${new Date(connection.nextAttempt).toLocaleTimeString()}` : ''
    message = connection.error ? `${connection.error}${retry}` : 'Connecting to gomuks…'
  } else if (syncStatus && (syncStatus.type === 'erroring' || syncStatus.type === 'permanently-failed')) {
    message = `Homeserver sync is failing${syncStatus.error ? `: ${syncStatus.error}` : ''}`
  }
  if (!message) return null
  return (
    <div className="connection-banner flex shrink-0 items-center justify-center gap-2 border-b border-border bg-surface-2 px-4 py-1.5 text-xs text-muted" role="status">
      {connection.reconnecting && <Spinner size={12} />}
      {message}
    </div>
  )
}

function EmptyState() {
  const loading = useChat(s => !s.initComplete && s.roomOrder.length === 0)
  return (
    <div className="grid flex-1 place-items-center p-8 text-center">
      {loading ? (
        <span className="flex items-center gap-2 text-sm text-muted">
          <Spinner size={14} /> Loading rooms…
        </span>
      ) : (
        <div className="flex flex-col items-center gap-3 text-muted">
          <MessagesSquare size={40} strokeWidth={1.25} />
          <p className="text-sm">Pick a room to start chatting</p>
          <p className="flex items-center gap-1.5 text-xs">
            <Kbd>Ctrl K</Kbd> jump to a room · <Kbd>Alt ↑↓</Kbd> cycle rooms
          </p>
        </div>
      )}
    </div>
  )
}

export function Shell() {
  useGlobalShortcuts()
  useEffect(installMatrixLinkHandler, [])
  const activeRoomID = useUI(s => s.activeRoomID)
  const drawerOpen = useUI(s => s.drawerOpen)
  const widgetView = useUI(s => s.widgetView)
  const roomTool = useUI(s => s.roomTool)
  const threadRoot = useUI(s => s.threadRoot)
  const profileUserID = useUI(s => s.profileUserID)
  const rightPanelWidth = useUI(s => s.rightPanelWidth)
  const hasRoom = useChat(s => !!activeRoomID && !!s.rooms[activeRoomID])
  // An invited room has no timeline yet: the main area shows the invite instead.
  const invite = useInvite(hasRoom ? null : activeRoomID)
  // Following a link to a room we're not in takes over the main area until it's dismissed.
  const preview = useRoomPreview(s => s.preview)

  let panel: RightPanelKind | null = null
  if (hasRoom) {
    panel = profileUserID
      ? 'user'
      : threadRoot
        ? 'thread'
        : widgetView
          ? widgetView.mode === 'list'
            ? 'widgets'
            : 'widget'
          : roomTool
            ? roomTool
            : drawerOpen
              ? 'details'
              : null
  }

  return (
    <div className="app-shell flex h-full">
      <SpaceRail />
      <Sidebar />
      <div className="relative flex min-w-0 flex-1 overflow-hidden">
        <main className="flex min-w-0 flex-1 flex-col bg-[var(--timeline-bg)]" style={{ marginRight: panel ? `min(${rightPanelWidth}px, calc(100% - ${MIN_TIMELINE_WIDTH}px))` : 0 }}>
          <ConnectionBanner />
          {preview ? (
            <JoinRoomView key={preview.reference} preview={preview} />
          ) : hasRoom ? (
            <RoomView key={activeRoomID} roomID={activeRoomID!} />
          ) : invite ? (
            <InviteView key={invite.roomID} invite={invite} />
          ) : (
            <EmptyState />
          )}
        </main>
        <AnimatePresence initial={false}>
          {panel && <RightPanel key="right-panel" roomID={activeRoomID!} kind={panel} />}
        </AnimatePresence>
      </div>
      <CommandPalette />
      <MessageDialogs />
      <StateExplorer />
      <AppearanceDialog />
      <SettingsDialog />
      <PermissionDialog />
      <Lightbox />
      <Toaster />
    </div>
  )
}
