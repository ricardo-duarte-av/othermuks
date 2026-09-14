import { useVirtualizer } from '@tanstack/react-virtual'
import { BellOff, Search, Star } from 'lucide-react'
import { memo, useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { RoomID } from '@/api/types'
import { cn } from '@/lib/cn'
import { formatRoomTime } from '@/lib/format'
import { markOnce } from '@/lib/perf'
import { useChat } from '@/store/chat'
import { fallbackDisplayName, isMessageLike, previewText } from '@/store/events'
import { FAVOURITE_TAG, isRoomMuted, roomTagsOf } from '@/store/roomActions'
import { DM_SPACE, HOME_SPACE, spaceListRows } from '@/store/spaces'
import { openRoom, setSidebarWidth, SIDEBAR_DEFAULT_WIDTH, useUI } from '@/store/ui'
import { Avatar, Kbd } from '@/ui/primitives'
import { ResizeHandle } from '@/ui/ResizeHandle'
import { LeaveRoomDialog, RoomContextMenu } from './RoomContextMenu'

const ROOM_ROW_HEIGHT = 56
const SECTION_HEADER_HEIGHT = 32

/** Falls back to Home when the remembered space was left or hasn't synced. */
function useEffectiveSpaceID() {
  const spaceID = useUI(s => s.activeSpaceID)
  const exists = useChat(s => spaceID === HOME_SPACE || spaceID === DM_SPACE || !!s.rooms[spaceID])
  return exists ? spaceID : HOME_SPACE
}

function SidebarHeader({ spaceID }: { spaceID: string }) {
  const spaceName = useChat(s => s.rooms[spaceID]?.meta.name)
  const title = spaceID === HOME_SPACE ? 'All rooms' : spaceID === DM_SPACE ? 'Direct messages' : (spaceName ?? spaceID)
  return (
    <div className="sidebar-header flex h-14 shrink-0 items-center border-b border-border px-4">
      <h2 className="truncate text-[15px] font-semibold">{title}</h2>
    </div>
  )
}

const RoomListItem = memo(function RoomListItem({ roomID, active }: { roomID: RoomID; active: boolean }) {
  const meta = useChat(s => s.rooms[roomID]?.meta)
  const preview = useChat(s => {
    const rowid = s.rooms[roomID]?.meta.preview_event_rowid
    return rowid ? s.events[rowid] : undefined
  })
  // Per-room display name from room state when known, otherwise the capitalized localpart.
  const senderName = useChat(s => {
    if (!preview) return undefined
    const rowid = s.rooms[roomID]?.state['m.room.member']?.[preview.sender]
    const name = rowid === undefined ? undefined : s.events[rowid]?.content.displayname
    return typeof name === 'string' && name ? name : fallbackDisplayName(preview.sender)
  })
  const favourite = useChat(s => FAVOURITE_TAG in roomTagsOf(s, roomID))
  const muted = useChat(s => isRoomMuted(s, roomID))
  if (!meta) return null

  const count = meta.unread_highlights || meta.unread_notifications || meta.unread_messages
  const level = meta.unread_highlights ? 'highlight' : meta.unread_notifications ? 'notify' : 'normal'
  const unread = count > 0 || meta.marked_unread
  const isEmote = preview?.content.msgtype === 'm.emote' && !preview.redacted_by
  const showSender = !!preview && !!senderName && isMessageLike(preview) && !isEmote

  return (
    <RoomContextMenu roomID={roomID}>
      <button
        type="button"
        onClick={() => openRoom(roomID)}
        data-active={active || undefined}
        data-unread={unread || undefined}
        data-muted={muted || undefined}
        data-favourite={favourite || undefined}
        aria-current={active || undefined}
        className="room-list-item flex h-[52px] w-full items-center gap-3 rounded-lg px-2 text-left transition-colors data-[state=open]:bg-hover"
      >
        <Avatar mxc={meta.avatar} id={meta.dm_user_id ?? roomID} name={meta.name} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className={cn('room-name truncate text-sm', unread ? 'font-semibold text-fg' : 'font-medium text-fg/85')}>
              {meta.name ?? roomID}
            </span>
            {favourite && <Star size={11} className="room-favourite shrink-0 self-center fill-current text-accent" aria-label="Favourite" />}
            {muted && <BellOff size={11} className="room-muted shrink-0 self-center text-muted" aria-label="Muted" />}
            <span className="room-time ml-auto shrink-0 pl-1 text-[11px] tabular-nums text-muted">{formatRoomTime(meta.sorting_timestamp)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn('room-preview truncate text-xs', unread ? 'text-fg/75' : 'text-muted')}>
              {showSender && <span className="room-preview-sender font-medium text-fg/80">{senderName}: </span>}
              {isEmote ? `* ${senderName} ${preview.content.body}` : previewText(preview)}
            </span>
            {count > 0 && (
              <span className="unread-badge ml-auto" data-level={muted && level !== 'highlight' ? 'normal' : level}>
                {count > 99 ? '99+' : count}
              </span>
            )}
          </div>
        </div>
      </button>
    </RoomContextMenu>
  )
})

const SectionHeader = memo(function SectionHeader({ spaceID }: { spaceID: RoomID }) {
  const name = useChat(s => s.rooms[spaceID]?.meta.name)
  return (
    <div className="space-section-header flex h-full items-end truncate px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
      {name ?? spaceID}
    </div>
  )
})

function RoomList({ spaceID }: { spaceID: string }) {
  const rows = useChat(useShallow(s => spaceListRows(s, spaceID)))
  const activeRoomID = useUI(s => s.activeRoomID)
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: index => (rows[index].startsWith('h:') ? SECTION_HEADER_HEIGHT : ROOM_ROW_HEIGHT),
    getItemKey: index => rows[index],
    overscan: 8,
    useFlushSync: false,
  })

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [spaceID])

  useEffect(() => {
    if (rows.length) markOnce('room list rendered', `${rows.length} rows`)
  }, [rows.length])

  if (!rows.length) {
    return <p className="px-4 py-6 text-center text-sm text-muted">No rooms here yet</p>
  }

  return (
    <div ref={scrollRef} className="room-list min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Rooms">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(item => {
          const row = rows[item.index]
          const id = row.slice(2)
          return (
            <div
              key={item.key}
              className="absolute left-0 top-0 w-full py-0.5"
              style={{ height: item.size, transform: `translateY(${item.start}px)` }}
            >
              {row.startsWith('h:') ? <SectionHeader spaceID={id} /> : <RoomListItem roomID={id} active={id === activeRoomID} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function Sidebar() {
  const width = useUI(s => s.sidebarWidth)
  const spaceID = useEffectiveSpaceID()
  return (
    <aside className="sidebar relative flex shrink-0 flex-col border-r border-border bg-[var(--sidebar-bg)]" style={{ width }}>
      <SidebarHeader spaceID={spaceID} />
      <button
        type="button"
        onClick={() => useUI.setState({ paletteOpen: true })}
        className="mx-3 my-2.5 flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border bg-bg/40 px-3 text-sm text-muted transition-colors hover:text-fg"
      >
        <Search size={15} />
        Search rooms
        <span className="ml-auto">
          <Kbd>Ctrl K</Kbd>
        </span>
      </button>
      <RoomList spaceID={spaceID} />
      <ResizeHandle
        edge="right"
        getWidth={() => useUI.getState().sidebarWidth}
        onResize={setSidebarWidth}
        defaultWidth={SIDEBAR_DEFAULT_WIDTH}
        label="Resize room list"
      />
      <LeaveRoomDialog />
    </aside>
  )
}
