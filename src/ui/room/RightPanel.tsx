import { motion } from 'motion/react'
import type { RoomID } from '@/api/types'
import { RIGHT_PANEL_DEFAULT_WIDTH, setRightPanelWidth, useUI } from '@/store/ui'
import { ResizeHandle } from '@/ui/ResizeHandle'
import { RoomDetails } from './RoomDrawer'
import { ThreadView } from './ThreadPanel'
import { UserProfilePanel } from './UserProfilePanel'

export type RightPanelKind = 'details' | 'thread' | 'user'

/** The resizable right sidebar. Switching between its views swaps content without re-animating the panel. */
export function RightPanel({ roomID, kind }: { roomID: RoomID; kind: RightPanelKind }) {
  const width = useUI(s => s.rightPanelWidth)
  const threadRoot = useUI(s => s.threadRoot)
  const profileUserID = useUI(s => s.profileUserID)

  return (
    <motion.aside
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 520, damping: 46, mass: 0.8 }}
      className="right-panel absolute inset-y-0 right-0 z-20 flex flex-col border-l border-border bg-[var(--drawer-bg)]"
      style={{ width }}
      data-kind={kind}
    >
      <ResizeHandle
        edge="left"
        getWidth={() => useUI.getState().rightPanelWidth}
        onResize={setRightPanelWidth}
        defaultWidth={RIGHT_PANEL_DEFAULT_WIDTH}
        label="Resize side panel"
      />
      {kind === 'details' && <RoomDetails roomID={roomID} />}
      {kind === 'thread' && threadRoot && <ThreadView key={threadRoot} roomID={roomID} rootID={threadRoot} />}
      {kind === 'user' && profileUserID && <UserProfilePanel key={profileUserID} roomID={roomID} userID={profileUserID} />}
    </motion.aside>
  )
}
