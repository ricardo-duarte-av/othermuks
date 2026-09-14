import * as Popover from '@radix-ui/react-popover'
import { lazy, Suspense, type ReactNode } from 'react'
import { Spinner } from '@/ui/primitives'

// The picker and its emoji data only load the first time someone opens it.
const EmojiPickerPanel = lazy(() => import('./EmojiPickerPanel'))

interface ReactionPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (emoji: string) => void
  /** The trigger button. */
  children: ReactNode
}

export function ReactionPicker({ open, onOpenChange, onSelect, children }: ReactionPickerProps) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="emoji-picker z-50 overflow-hidden rounded-xl border border-border bg-surface text-fg shadow-2xl"
        >
          <Suspense
            fallback={
              <div className="grid h-[360px] w-[340px] place-items-center text-muted">
                <Spinner />
              </div>
            }
          >
            <EmojiPickerPanel
              onSelect={emoji => {
                onSelect(emoji)
                onOpenChange(false)
              }}
            />
          </Suspense>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
