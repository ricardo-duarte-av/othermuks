import { motion } from 'motion/react'
import type { RoomID } from '@/api/types'
import { MIN_TIMELINE_WIDTH, RIGHT_PANEL_DEFAULT_WIDTH, setRightPanelWidth, useUI } from '@/store/ui'
import { ResizeHandle } from '@/ui/ResizeHandle'
import { WidgetListPanel, WidgetPanel } from '@/ui/widget/WidgetPanels'
import { RoomDetails } from './RoomDrawer'
import { ThreadView } from './ThreadPanel'
import { UserProfilePanel } from './UserProfilePanel'

export type RightPanelKind = 'details' | 'thread' | 'user' | 'widgets' | 'widget'

/** The resizable right sidebar. Switching between its views swaps content without re-animating the panel. */
export function RightPanel({ roomID, kind }: { roomID: RoomID; kind: RightPanelKind }) {
  const width = useUI(s => s.rightPanelWidth)
  const threadRoot = useUI(s => s.threadRoot)
  const profileUserID = useUI(s => s.profileUserID)
  const widgetView = useUI(s => s.widgetView)

  return (
    <motion.aside
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 520, damping: 46, mass: 0.8 }}
      className="right-panel absolute inset-y-0 right-0 z-20 flex flex-col border-l border-border bg-[var(--drawer-bg)]"
      // Can grow until only MIN_TIMELINE_WIDTH of the room is left, e.g. for a call.
      style={{ width, maxWidth: `calc(100% - ${MIN_TIMELINE_WIDTH}px)` }}
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
      {kind === 'widgets' && <WidgetListPanel roomID={roomID} />}
      {kind === 'widget' && widgetView?.mode === 'widget' && <WidgetPanel roomID={roomID} widgetID={widgetView.widgetID} />}
    </motion.aside>
  )
}
