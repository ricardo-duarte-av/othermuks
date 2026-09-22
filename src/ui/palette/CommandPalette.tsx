import { Command } from 'cmdk'
import { DoorOpen, PanelRight, Palette } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RoomID } from '@/api/types'
import { useChat } from '@/store/chat'
import { parseMatrixURI, type MatrixTarget } from '@/lib/matrixURI'
import { openMatrixTarget } from '@/store/navigation'
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

/**
 * A room the palette can send us to but isn't in the list: typed as an ID or alias, or pasted as a
 * matrix.to / matrix: link. Rooms already joined are left to the list above.
 */
type RoomTarget = Extract<MatrixTarget, { kind: 'room' }>

function typedRoomTarget(text: string): RoomTarget | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const parsed = parseMatrixURI(trimmed)
  if (parsed?.kind === 'room') return parsed
  if (/^[#!][^\s:]+:\S+$/.test(trimmed)) {
    return trimmed.startsWith('#') ? { kind: 'room', alias: trimmed, via: [] } : { kind: 'room', roomID: trimmed, via: [] }
  }
  return null
}

export function CommandPalette() {
  const open = useUI(s => s.paletteOpen)
  const hasRoom = useUI(s => !!s.activeRoomID)
  const roomOrder = useChat(s => s.roomOrder)
  const [search, setSearch] = useState('')
  const typed = typedRoomTarget(search)
  // Only offer joining when it isn't a room we're already in, which the list above already shows.
  const typedIsKnown = useChat(s => !!typed?.roomID && !!s.rooms[typed.roomID])
  const listRef = useRef<HTMLDivElement>(null)
  const close = () => useUI.setState({ paletteOpen: false })

  // Each keystroke re-filters the list; cmdk then scrolls its (first) selected item into view using
  // pre-filter positions, which can leave the list mid-way. Pin it to the top instead, also after
  // cmdk's own scroll on the next frame.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    list.scrollTop = 0
    const frame = requestAnimationFrame(() => {
      list.scrollTop = 0
    })
    return () => cancelAnimationFrame(frame)
  }, [search])

  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

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
        value={search}
        onValueChange={setSearch}
        placeholder="Jump to a room or run a command…"
        className="h-12 w-full border-b border-border bg-transparent px-4 text-[15px] outline-none placeholder:text-muted"
      />
      <Command.List ref={listRef} className="max-h-[min(440px,60vh)] overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted">
        <Command.Empty className="px-2 py-6 text-center text-sm text-muted">No matches</Command.Empty>
        <Command.Group heading="Rooms">
          {roomOrder.map(roomID => (
            <PaletteRoom key={roomID} roomID={roomID} />
          ))}
        </Command.Group>
        {typed && !typedIsKnown && (
          <Command.Group heading="Go to">
            <Command.Item
              value={search.trim()}
              keywords={['join', 'room', 'alias']}
              onSelect={() => {
                close()
                void openMatrixTarget(typed)
              }}
              className={itemClass}
            >
              <DoorOpen size={16} className="text-muted" />
              <span className="min-w-0 truncate">
                Join <span className="font-mono">{typed.alias ?? typed.roomID}</span>
              </span>
            </Command.Item>
          </Command.Group>
        )}
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
          <Command.Item
            value="customize-appearance"
            keywords={['appearance', 'theme editor', 'colors', 'custom css', 'style']}
            onSelect={() => {
              close()
              requestAnimationFrame(() => useUI.setState({ appearanceOpen: true }))
            }}
            className={itemClass}
          >
            <Palette size={16} className="text-muted" /> Customize appearance…
          </Command.Item>
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
