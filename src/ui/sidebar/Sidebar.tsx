import { useVirtualizer } from '@tanstack/react-virtual'
import { BellOff, MailPlus, Search, Star } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { RoomID } from '@/api/types'
import { cn } from '@/lib/cn'
import { formatRoomTime } from '@/lib/format'
import { markOnce } from '@/lib/perf'
import { useChat, type ChatSnapshot } from '@/store/chat'
import { fallbackDisplayName, isMessageLike, previewText } from '@/store/events'
import { useInvites } from '@/store/membership'
import { usePreference, useRoomSort } from '@/store/preferences'
import { FAVOURITE_TAG, isRoomMuted, LOW_PRIORITY_TAG, roomTagsOf } from '@/store/roomActions'
import { DM_SPACE, HOME_SPACE, spaceListRows, type RoomListRow } from '@/store/spaces'
import { openRoom, setSidebarWidth, SIDEBAR_DEFAULT_WIDTH, useUI } from '@/store/ui'
import { Avatar, Kbd } from '@/ui/primitives'
import { ResizeHandle } from '@/ui/ResizeHandle'
import { LeaveRoomDialog, RoomContextMenu } from './RoomContextMenu'

const ROOM_ROW_HEIGHT = 56
const COMPACT_ROOM_ROW_HEIGHT = 36
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

interface RoomListItemProps {
  roomID: RoomID
  active: boolean
  compact: boolean
  muteLowPriority: boolean
}

const RoomListItem = memo(function RoomListItem({ roomID, active, compact, muteLowPriority }: RoomListItemProps) {
  const meta = useChat(s => s.rooms[roomID]?.meta)
  const showPreview = usePreference('room_list_preview', roomID) && !compact
  const preview = useChat(s => {
    const rowid = showPreview ? s.rooms[roomID]?.meta.preview_event_rowid : undefined
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
  const lowPriority = useChat(s => LOW_PRIORITY_TAG in roomTagsOf(s, roomID))
  const muted = useChat(s => isRoomMuted(s, roomID))
  if (!meta) return null

  // mute_low_priority drops plain unread counts in low priority rooms; notifications still count.
  const unreadMessages = lowPriority && muteLowPriority ? 0 : meta.unread_messages
  const count = meta.unread_highlights || meta.unread_notifications || unreadMessages
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
        data-compact={compact || undefined}
        aria-current={active || undefined}
        className={cn(
          'room-list-item flex w-full items-center gap-3 rounded-lg px-2 text-left transition-colors data-[state=open]:bg-hover',
          compact ? 'h-8 gap-2' : 'h-[52px]',
        )}
      >
        <Avatar mxc={meta.avatar} id={meta.dm_user_id ?? roomID} name={meta.name} size={compact ? 24 : 36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className={cn('room-name truncate text-sm', unread ? 'font-semibold text-fg' : 'font-medium text-fg/85')}>
              {meta.name ?? roomID}
            </span>
            {favourite && <Star size={11} className="room-favourite shrink-0 self-center fill-current text-accent" aria-label="Favourite" />}
            {muted && <BellOff size={11} className="room-muted shrink-0 self-center text-muted" aria-label="Muted" />}
            {compact ? (
              count > 0 && <UnreadBadge count={count} level={muted && level !== 'highlight' ? 'normal' : level} />
            ) : (
              <span className="room-time ml-auto shrink-0 pl-1 text-[11px] tabular-nums text-muted">{formatRoomTime(meta.sorting_timestamp)}</span>
            )}
          </div>
          {!compact && (
            <div className="flex items-center gap-2">
              <span className={cn('room-preview truncate text-xs', unread ? 'text-fg/75' : 'text-muted')}>
                {showSender && <span className="room-preview-sender font-medium text-fg/80">{senderName}: </span>}
                {preview && (isEmote ? `* ${senderName} ${preview.content.body}` : previewText(preview))}
              </span>
              {count > 0 && <UnreadBadge count={count} level={muted && level !== 'highlight' ? 'normal' : level} />}
            </div>
          )}
        </div>
      </button>
    </RoomContextMenu>
  )
})

function UnreadBadge({ count, level }: { count: number; level: string }) {
  return (
    <span className="unread-badge ml-auto" data-level={level}>
      {count > 99 ? '99+' : count}
    </span>
  )
}

/**
 * A section's rooms summed into one badge, so a collapsed or pinned header says whether the loud
 * notification is in there. Each room counts the same badge it shows itself, and the section takes
 * the loudest level any of its rooms has.
 */
function sectionUnread(s: ChatSnapshot, roomIDs: RoomID[], muteLowPriority: boolean) {
  let count = 0
  let level = 'normal'
  for (const roomID of roomIDs) {
    const meta = s.rooms[roomID]?.meta
    if (!meta) continue
    const lowPriority = LOW_PRIORITY_TAG in roomTagsOf(s, roomID)
    const unreadMessages = lowPriority && muteLowPriority ? 0 : meta.unread_messages
    count += meta.unread_highlights || meta.unread_notifications || unreadMessages
    // A muted room still flags its section when it mentions us, matching how its own badge is drawn.
    if (meta.unread_highlights) level = 'highlight'
    else if (meta.unread_notifications && level === 'normal' && !isRoomMuted(s, roomID)) level = 'notify'
  }
  return { count, level }
}

const NO_ROOMS: RoomID[] = []

const SectionHeader = memo(function SectionHeader({
  spaceID,
  roomIDs,
  muteLowPriority,
}: {
  spaceID: RoomID
  roomIDs: RoomID[]
  muteLowPriority: boolean
}) {
  const name = useChat(s => s.rooms[spaceID]?.meta.name)
  const { count, level } = useChat(useShallow(s => sectionUnread(s, roomIDs, muteLowPriority)))
  return (
    <div className="space-section-header flex h-full items-end gap-1.5 px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
      <span className="truncate">{name ?? spaceID}</span>
      {count > 0 && <UnreadBadge count={count} level={level} />}
    </div>
  )
})

/**
 * Which sub-space headers are pinned where. The list is virtualized, so its rows are positioned
 * absolutely and CSS sticky can't hold a header in place: the pinned copies are drawn over the
 * scroller instead, from the same measurements the virtualizer uses.
 *
 * Headers stack like nested sticky headers: the i-th one sticks at `i` header heights from the top
 * once it scrolls up to there, and at `n - i` header heights from the bottom until it scrolls up
 * past there. Pinned headers are therefore always a run from the start and a run from the end.
 */
interface SectionPins {
  /** Sub-space IDs in list order, with each header's scroll offset. */
  sections: { spaceID: RoomID; offset: number }[]
  /** How many sections from the start are pinned to the top. */
  top: number
  /** How many sections from the end are pinned to the bottom. */
  bottom: number
}

function useSectionPins(rows: RoomListRow[], roomRowHeight: number, scrollRef: RefObject<HTMLDivElement | null>): SectionPins {
  // Every row has a fixed height, so offsets follow from the row list alone.
  const sections = useMemo(() => {
    const out: SectionPins['sections'] = []
    let y = 0
    for (const row of rows) {
      if (row.startsWith('h:')) {
        out.push({ spaceID: row.slice(2), offset: y })
        y += SECTION_HEADER_HEIGHT
      } else {
        y += roomRowHeight
      }
    }
    return out
  }, [rows, roomRowHeight])

  const [counts, setCounts] = useState({ top: 0, bottom: 0 })

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !sections.length) {
      setCounts(prev => (prev.top || prev.bottom ? { top: 0, bottom: 0 } : prev))
      return
    }
    let queued = false
    const update = () => {
      queued = false
      const scrollTop = el.scrollTop
      const height = el.clientHeight
      const n = sections.length
      let top = 0
      while (top < n && sections[top].offset - scrollTop < top * SECTION_HEADER_HEIGHT) top++
      let bottom = 0
      // A header already held at the top never also joins the bottom stack.
      while (bottom < n - top && sections[n - 1 - bottom].offset - scrollTop > height - (bottom + 1) * SECTION_HEADER_HEIGHT) bottom++
      setCounts(prev => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }))
    }
    const onScroll = () => {
      if (queued) return
      queued = true
      requestAnimationFrame(update)
    }
    update()
    el.addEventListener('scroll', onScroll, { passive: true })
    const observer = new ResizeObserver(onScroll)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [sections, scrollRef])

  return { sections, ...counts }
}

/** A stack of sub-space headers held at the top or bottom of the list while their rooms are out of view. */
function PinnedHeaders({
  spaceIDs,
  sectionRooms,
  muteLowPriority,
  edge,
  onJump,
}: {
  spaceIDs: RoomID[]
  sectionRooms: Map<RoomID, RoomID[]>
  muteLowPriority: boolean
  edge: 'top' | 'bottom'
  onJump: (spaceID: RoomID) => void
}) {
  if (!spaceIDs.length) return null
  return (
    <div
      aria-hidden
      className={cn('pinned-section-headers absolute inset-x-0 z-10 bg-[var(--sidebar-bg)] px-2', edge === 'top' ? 'top-0' : 'bottom-0')}
    >
      {spaceIDs.map(spaceID => (
        <button
          key={spaceID}
          type="button"
          tabIndex={-1}
          className="pinned-section-header block w-full py-0.5 text-left"
          style={{ height: SECTION_HEADER_HEIGHT }}
          onClick={() => onJump(spaceID)}
        >
          <SectionHeader spaceID={spaceID} roomIDs={sectionRooms.get(spaceID) ?? NO_ROOMS} muteLowPriority={muteLowPriority} />
        </button>
      ))}
    </div>
  )
}

/**
 * Pending invites, above the room list: they have no timeline yet, so they aren't rooms the list can
 * show. Invites belong to no space, so they stay visible whichever space is selected.
 */
function InviteSection() {
  const invites = useInvites()
  const activeRoomID = useUI(s => s.activeRoomID)
  if (!invites.length) return null
  return (
    <div className="invite-section shrink-0 px-2 pb-1">
      <div className="flex h-8 items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-muted">
        <MailPlus size={13} className="text-accent" />
        Invites
        <span className="ml-auto rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold leading-none text-accent-fg tabular-nums">
          {invites.length}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {invites.map(invite => (
          <li key={invite.roomID}>
            <button
              type="button"
              onClick={() => openRoom(invite.roomID)}
              data-active={invite.roomID === activeRoomID || undefined}
              aria-current={invite.roomID === activeRoomID || undefined}
              className="room-list-item invite-row flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors"
            >
              <Avatar mxc={invite.avatar} id={invite.roomID} name={invite.name} size={32} />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-medium">{invite.name ?? invite.canonicalAlias ?? invite.roomID}</span>
                <span className="block truncate text-xs text-accent">
                  {invite.inviterName ? `${invite.inviterName} invited you` : 'Invitation'}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function RoomList({ spaceID }: { spaceID: string }) {
  const sort = useRoomSort()
  const compact = usePreference('compact_room_list')
  const muteLowPriority = usePreference('mute_low_priority')
  const rows = useChat(useShallow(s => spaceListRows(s, spaceID, sort)))
  const activeRoomID = useUI(s => s.activeRoomID)
  const scrollRef = useRef<HTMLDivElement>(null)
  const roomRowHeight = compact ? COMPACT_ROOM_ROW_HEIGHT : ROOM_ROW_HEIGHT
  const pins = useSectionPins(rows, roomRowHeight, scrollRef)
  // The rooms listed under each section header, for the header's own unread badge. A room shown in
  // one section only belongs to that one, so this follows the rows rather than the space edges.
  const sectionRooms = useMemo(() => {
    const map = new Map<RoomID, RoomID[]>()
    let current: RoomID[] | undefined
    for (const row of rows) {
      if (row.startsWith('h:')) map.set(row.slice(2), (current = []))
      else current?.push(row.slice(2))
    }
    return map
  }, [rows])
  // Scroll a section's header to where it sits in the top stack, so its rooms follow right below.
  const jumpToSection = (target: RoomID) => {
    const index = pins.sections.findIndex(section => section.spaceID === target)
    if (index >= 0) scrollRef.current?.scrollTo({ top: pins.sections[index].offset - index * SECTION_HEADER_HEIGHT })
  }
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: index => (rows[index].startsWith('h:') ? SECTION_HEADER_HEIGHT : roomRowHeight),
    getItemKey: index => rows[index],
    overscan: 8,
    useFlushSync: false,
  })

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [spaceID])

  useEffect(() => {
    virtualizer.measure()
  }, [compact, virtualizer])

  useEffect(() => {
    if (rows.length) markOnce('room list rendered', `${rows.length} rows`)
  }, [rows.length])

  if (!rows.length) {
    return <p className="px-4 py-6 text-center text-sm text-muted">No rooms here yet</p>
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <PinnedHeaders
        spaceIDs={pins.sections.slice(0, pins.top).map(s => s.spaceID)}
        sectionRooms={sectionRooms}
        muteLowPriority={muteLowPriority}
        edge="top"
        onJump={jumpToSection}
      />
      <PinnedHeaders
        spaceIDs={pins.sections.slice(pins.sections.length - pins.bottom).map(s => s.spaceID)}
        sectionRooms={sectionRooms}
        muteLowPriority={muteLowPriority}
        edge="bottom"
        onJump={jumpToSection}
      />
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
                {row.startsWith('h:') ? (
                  <SectionHeader spaceID={id} roomIDs={sectionRooms.get(id) ?? NO_ROOMS} muteLowPriority={muteLowPriority} />
                ) : (
                  <RoomListItem roomID={id} active={id === activeRoomID} compact={compact} muteLowPriority={muteLowPriority} />
                )}
              </div>
            )
          })}
        </div>
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
      <InviteSection />
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
