import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ArrowLeftRight, LogOut, Server } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useChat } from '@/store/chat'
import { showBackendPicker, signOut, useSession } from '@/store/session'
import { Avatar } from '@/ui/primitives'

const itemClass =
  'flex cursor-default select-none items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-hover'

export function AccountMenu({ expanded }: { expanded: boolean }) {
  const clientState = useChat(s => s.clientState)
  const backendURL = useSession(s => s.backendURL)
  if (!clientState?.is_logged_in) return <div className="size-9 rounded-full bg-surface-2" />
  const host = backendURL ? new URL(backendURL).host : location.host

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Account and backend"
        className={cn(
          'own-profile flex min-w-0 items-center gap-3 rounded-lg p-0.5 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-hover',
          expanded && 'flex-1 pr-2',
        )}
      >
        <Avatar mxc={clientState.avatar_url} id={clientState.user_id} name={clientState.displayname} size={36} />
        {expanded && (
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold">{clientState.displayname ?? clientState.user_id}</div>
            <div className="truncate text-xs text-muted">{clientState.user_id}</div>
          </div>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="right"
          align="end"
          sideOffset={10}
          className="account-menu z-50 min-w-64 rounded-lg border border-border bg-surface p-1 text-fg shadow-xl"
        >
          <div className="px-2 py-1.5 leading-tight">
            <div className="truncate text-sm font-semibold">{clientState.displayname ?? clientState.user_id}</div>
            <div className="truncate text-xs text-muted">{clientState.user_id}</div>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Label className="flex items-center gap-2 px-2 py-1 text-xs text-muted">
            <Server size={13} />
            <span className="truncate">
              {host}
              {backendURL ? '' : ' (this site)'}
            </span>
          </DropdownMenu.Label>
          <DropdownMenu.Item onSelect={showBackendPicker} className={itemClass}>
            <ArrowLeftRight size={15} className="text-muted" /> Change backend…
          </DropdownMenu.Item>
          {backendURL && (
            <DropdownMenu.Item onSelect={signOut} className={itemClass}>
              <LogOut size={15} className="text-muted" /> Sign out
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
