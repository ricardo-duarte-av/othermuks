import { AnimatePresence } from 'motion/react'
import { MessagesSquare } from 'lucide-react'
import { useEffect } from 'react'
import { useChat } from '@/store/chat'
import { roomIDsInRows, spaceListRows } from '@/store/spaces'
import { openRoom, useUI } from '@/store/ui'
import { CommandPalette } from '@/ui/palette/CommandPalette'
import { Kbd, Spinner } from '@/ui/primitives'
import { MessageDialogs, Toaster } from '@/ui/room/MessageDialogs'
import { RightPanel, type RightPanelKind } from '@/ui/room/RightPanel'
import { RoomView } from '@/ui/room/RoomView'
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
  const roomIDs = roomIDsInRows(spaceListRows(useChat.getState(), activeSpaceID))
  const index = roomIDs.indexOf(activeRoomID ?? '')
  const next = roomIDs[Math.min(Math.max(index + delta, 0), roomIDs.length - 1)]
  if (next) openRoom(next)
}

function useGlobalShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const ui = useUI.getState()
      const overlayOpen = ui.paletteOpen || !!ui.dialog
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        useUI.setState({ paletteOpen: !ui.paletteOpen })
      } else if (mod && e.key === '.') {
        e.preventDefault()
        // Shows room details (replacing a thread or profile on top), or hides them.
        const detailsVisible = ui.drawerOpen && !ui.threadRoot && !ui.profileUserID
        useUI.setState({ drawerOpen: !detailsVisible, threadRoot: null, profileUserID: null })
      } else if (e.key === 'Escape' && !isEditable(e.target) && !overlayOpen && (ui.profileUserID || ui.threadRoot || ui.drawerOpen)) {
        // Close the top-most right panel view, revealing what's underneath.
        if (ui.profileUserID) useUI.setState({ profileUserID: null })
        else if (ui.threadRoot) useUI.setState({ threadRoot: null })
        else useUI.setState({ drawerOpen: false })
      } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        stepRoom(e.key === 'ArrowUp' ? -1 : 1)
      } else if (!mod && !e.altKey && e.key.length === 1 && !isEditable(e.target) && !overlayOpen) {
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
  const activeRoomID = useUI(s => s.activeRoomID)
  const drawerOpen = useUI(s => s.drawerOpen)
  const threadRoot = useUI(s => s.threadRoot)
  const profileUserID = useUI(s => s.profileUserID)
  const rightPanelWidth = useUI(s => s.rightPanelWidth)
  const hasRoom = useChat(s => !!activeRoomID && !!s.rooms[activeRoomID])

  let panel: RightPanelKind | null = null
  if (hasRoom) panel = profileUserID ? 'user' : threadRoot ? 'thread' : drawerOpen ? 'details' : null

  return (
    <div className="app-shell flex h-full">
      <SpaceRail />
      <Sidebar />
      <div className="relative flex min-w-0 flex-1 overflow-hidden">
        <main className="flex min-w-0 flex-1 flex-col bg-[var(--timeline-bg)]" style={{ marginRight: panel ? rightPanelWidth : 0 }}>
          <ConnectionBanner />
          {hasRoom ? <RoomView key={activeRoomID} roomID={activeRoomID!} /> : <EmptyState />}
        </main>
        <AnimatePresence initial={false}>
          {panel && <RightPanel key="right-panel" roomID={activeRoomID!} kind={panel} />}
        </AnimatePresence>
      </div>
      <CommandPalette />
      <MessageDialogs />
      <Toaster />
    </div>
  )
}
