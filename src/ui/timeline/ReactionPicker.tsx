import type { ReactNode } from 'react'
import type { RoomID } from '@/api/types'
import { EmojiPopover } from '@/ui/emoji/EmojiPopover'
import type { PickerSelection } from '@/ui/emoji/items'

interface ReactionPickerProps {
  roomID: RoomID
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (selection: PickerSelection) => void
  /** The trigger button. */
  children: ReactNode
}

export function ReactionPicker({ roomID, open, onOpenChange, onSelect, children }: ReactionPickerProps) {
  return (
    <EmojiPopover roomID={roomID} open={open} onOpenChange={onOpenChange} tabs={['emoji']} allowFreeform onSelect={onSelect}>
      {children}
    </EmojiPopover>
  )
}
