import * as Tooltip from '@radix-ui/react-tooltip'
import { House, MessageCircle, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { RoomID } from '@/api/types'
import { cn } from '@/lib/cn'
import { useChat } from '@/store/chat'
import { DM_SPACE, HOME_SPACE, spaceUnread } from '@/store/spaces'
import { setActiveSpace, useUI } from '@/store/ui'
import { Avatar } from '@/ui/primitives'
import { AccountMenu } from './AccountMenu'
import { ThemeMenu } from './ThemeMenu'

const RAIL_COLLAPSED_WIDTH = 68
const RAIL_EXPANDED_WIDTH = 248

/** Tooltips are only needed while the rail hides names. */
function RailTooltip({ label, enabled, children }: { label: string; enabled: boolean; children: ReactNode }) {
  if (!enabled) return children
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={10}
          className="tooltip z-50 max-w-64 truncate rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-fg shadow-lg"
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

function RailBadge({ spaceID, inline }: { spaceID: string; inline: boolean }) {
  const { highlights, notifications, unread } = useChat(useShallow(s => spaceUnread(s, spaceID)))
  const count = highlights || notifications
  if (count > 0) {
    return (
      <span
        className={cn('unread-badge', !inline && 'absolute -bottom-1 -right-1.5 ring-2 ring-[var(--rail-bg)]')}
        data-level={highlights ? 'highlight' : 'notify'}
      >
        {count > 99 ? '99+' : count}
      </span>
    )
  }
  if (unread) {
    return (
      <span
        className={cn(
          'space-unread-dot size-2.5 rounded-full bg-fg',
          !inline && 'absolute -right-0.5 -top-0.5 ring-2 ring-[var(--rail-bg)]',
        )}
      />
    )
  }
  return null
}

function RailItem({ spaceID, label, children }: { spaceID: string; label: string; children: ReactNode }) {
  const active = useUI(s => s.activeSpaceID === spaceID)
  const expanded = useUI(s => s.railExpanded)
  return (
    <RailTooltip label={label} enabled={!expanded}>
      <button
        type="button"
        aria-label={label}
        aria-current={active || undefined}
        data-active={active || undefined}
        onClick={() => setActiveSpace(spaceID)}
        className={cn(
          'space-rail-item group relative flex w-full shrink-0 items-center text-muted transition-colors hover:text-fg data-[active]:text-fg',
          expanded ? 'gap-3 rounded-xl px-3 py-0.5 hover:bg-hover data-[active]:bg-surface-2' : 'justify-center',
        )}
      >
        <span
          aria-hidden
          className="space-rail-indicator absolute left-0 top-1/2 h-0 w-1 -translate-y-1/2 rounded-r-full bg-fg transition-[height] duration-150 group-hover:h-4 group-data-[active]:h-8"
        />
        <span className="space-rail-icon relative grid size-11 shrink-0 place-items-center rounded-[14px] bg-surface-2 transition-[border-radius,background-color,color] duration-150 group-hover:rounded-xl group-data-[active]:rounded-xl group-data-[active]:bg-accent group-data-[active]:text-accent-fg">
          {children}
          {!expanded && <RailBadge spaceID={spaceID} inline={false} />}
        </span>
        {expanded && (
          <>
            <span className="space-rail-label min-w-0 flex-1 truncate text-left text-sm font-medium">{label}</span>
            <RailBadge spaceID={spaceID} inline />
          </>
        )}
      </button>
    </RailTooltip>
  )
}

function SpaceItem({ spaceID }: { spaceID: RoomID }) {
  const meta = useChat(s => s.rooms[spaceID]?.meta)
  if (!meta) return null
  return (
    <RailItem spaceID={spaceID} label={meta.name ?? spaceID}>
      <Avatar mxc={meta.avatar} id={spaceID} name={meta.name} size={44} className="rounded-[inherit]" />
    </RailItem>
  )
}

export function SpaceRail() {
  const topLevelSpaces = useChat(s => s.topLevelSpaces)
  const expanded = useUI(s => s.railExpanded)
  const toggleLabel = expanded ? 'Collapse spaces' : 'Expand spaces'

  return (
    <nav
      aria-label="Spaces"
      data-expanded={expanded || undefined}
      className="space-rail flex shrink-0 flex-col border-r border-border bg-[var(--rail-bg)] transition-[width] duration-200 ease-out"
      style={{ width: expanded ? RAIL_EXPANDED_WIDTH : RAIL_COLLAPSED_WIDTH }}
    >
      <div className={cn('flex h-14 shrink-0 items-center border-b border-border', expanded ? 'px-3' : 'justify-center')}>
        {expanded && <span className="flex-1 truncate pl-1 text-[15px] font-semibold">Spaces</span>}
        <RailTooltip label={toggleLabel} enabled={!expanded}>
          <button
            type="button"
            aria-label={toggleLabel}
            aria-expanded={expanded}
            onClick={() => useUI.setState({ railExpanded: !expanded })}
            className="grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg"
          >
            {expanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
        </RailTooltip>
      </div>
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden py-3 [scrollbar-width:none]',
          expanded ? 'px-2' : 'items-center',
        )}
      >
        <RailItem spaceID={HOME_SPACE} label="All rooms">
          <House size={20} />
        </RailItem>
        <RailItem spaceID={DM_SPACE} label="Direct messages">
          <MessageCircle size={20} />
        </RailItem>
        {topLevelSpaces.length > 0 && <div className="mx-auto my-0.5 h-px w-8 shrink-0 bg-border" />}
        {topLevelSpaces.map(spaceID => (
          <SpaceItem key={spaceID} spaceID={spaceID} />
        ))}
      </div>
      <div
        className={cn(
          'flex shrink-0 gap-2 border-t border-border py-3',
          expanded ? 'flex-row-reverse items-center px-3' : 'flex-col items-center',
        )}
      >
        <ThemeMenu />
        <AccountMenu expanded={expanded} />
      </div>
    </nav>
  )
}
