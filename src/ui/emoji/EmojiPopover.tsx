import * as Popover from '@radix-ui/react-popover'
import { lazy, Suspense, type ReactNode } from 'react'
import type { RoomID } from '@/api/types'
import { Spinner } from '@/ui/primitives'
import type { PickerSelection, PickerTab } from './items'

// The picker and its emoji data only load the first time someone opens it.
const MediaPicker = lazy(() => import('./MediaPicker'))

interface EmojiPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  roomID: RoomID | null
  tabs?: PickerTab[]
  initialTab?: PickerTab
  allowFreeform?: boolean
  onSelect: (selection: PickerSelection) => void
  /** Return focus to the trigger on close (off when the caller focuses something itself). */
  restoreFocus?: boolean
  side?: 'top' | 'bottom'
  align?: 'start' | 'center' | 'end'
  /** The trigger button. */
  children: ReactNode
}

export function EmojiPopover({
  open,
  onOpenChange,
  roomID,
  tabs = ['emoji'],
  initialTab,
  allowFreeform,
  onSelect,
  restoreFocus = true,
  side = 'top',
  align = 'end',
  children,
}: EmojiPopoverProps) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={12}
          onCloseAutoFocus={restoreFocus ? undefined : e => e.preventDefault()}
          className="emoji-picker z-50 overflow-hidden rounded-2xl border border-border bg-surface text-fg shadow-2xl"
        >
          <Suspense
            fallback={
              <div className="grid h-[440px] w-[388px] max-w-[calc(100vw-24px)] place-items-center text-muted">
                <Spinner />
              </div>
            }
          >
            <MediaPicker
              roomID={roomID}
              tabs={tabs}
              initialTab={initialTab}
              allowFreeform={allowFreeform}
              onSelect={selection => {
                onSelect(selection)
                onOpenChange(false)
              }}
            />
          </Suspense>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
