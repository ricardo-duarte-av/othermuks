import { Command } from 'cmdk'
import { PanelRight, Palette } from 'lucide-react'
import { memo } from 'react'
import type { RoomID } from '@/api/types'
import { useChat } from '@/store/chat'
import { openRoom, setTheme, THEMES, useUI } from '@/store/ui'
import { Avatar } from '@/ui/primitives'

const itemClass =
  'flex h-10 cursor-default select-none items-center gap-3 rounded-lg px-2 text-sm outline-none data-[selected=true]:bg-hover'

const PaletteRoom = memo(function PaletteRoom({ roomID }: { roomID: RoomID }) {
  const meta = useChat(s => s.rooms[roomID]?.meta)
  if (!meta) return null
  const unread = meta.unread_highlights || meta.unread_notifications
  return (
    <Command.Item
      value={roomID}
      keywords={[meta.name ?? '', meta.canonical_alias ?? '', meta.dm_user_id ?? '']}
      onSelect={() => openRoom(roomID)}
      className={itemClass}
    >
      <Avatar mxc={meta.avatar} id={meta.dm_user_id ?? roomID} name={meta.name} size={24} />
      <span className="truncate">{meta.name ?? roomID}</span>
      {meta.canonical_alias && <span className="truncate text-xs text-muted">{meta.canonical_alias}</span>}
      {unread > 0 && (
        <span className="unread-badge ml-auto" data-level={meta.unread_highlights ? 'highlight' : 'notify'}>
          {unread}
        </span>
      )}
    </Command.Item>
  )
})

export function CommandPalette() {
  const open = useUI(s => s.paletteOpen)
  const hasRoom = useUI(s => !!s.activeRoomID)
  const roomOrder = useChat(s => s.roomOrder)
  const close = () => useUI.setState({ paletteOpen: false })

  return (
    <Command.Dialog
      open={open}
      onOpenChange={paletteOpen => useUI.setState({ paletteOpen })}
      label="Command palette"
      loop
      overlayClassName="palette-overlay fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
      contentClassName="palette fixed left-1/2 top-[14vh] z-50 w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface text-fg shadow-2xl"
    >
      <Command.Input
        placeholder="Jump to a room or run a command…"
        className="h-12 w-full border-b border-border bg-transparent px-4 text-[15px] outline-none placeholder:text-muted"
      />
      <Command.List className="max-h-[min(440px,60vh)] overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted">
        <Command.Empty className="px-2 py-6 text-center text-sm text-muted">No matches</Command.Empty>
        <Command.Group heading="Rooms">
          {roomOrder.map(roomID => (
            <PaletteRoom key={roomID} roomID={roomID} />
          ))}
        </Command.Group>
        <Command.Group heading="Actions">
          {hasRoom && (
            <Command.Item
              value="toggle-room-details"
              keywords={['room details', 'drawer', 'members', 'info']}
              onSelect={() => {
                useUI.setState(s => ({ drawerOpen: !s.drawerOpen }))
                close()
              }}
              className={itemClass}
            >
              <PanelRight size={16} className="text-muted" /> Toggle room details
            </Command.Item>
          )}
          {THEMES.map(theme => (
            <Command.Item
              key={theme.id}
              value={`theme-${theme.id}`}
              keywords={['theme', theme.label]}
              onSelect={() => {
                setTheme(theme.id)
                close()
              }}
              className={itemClass}
            >
              <Palette size={16} className="text-muted" /> Theme: {theme.label}
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  )
}
