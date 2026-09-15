import { useEffect, useMemo, useState } from 'react'
import type { RoomID } from '@/api/types'
import { cn } from '@/lib/cn'
import { useChat } from '@/store/chat'
import { frequentEmoji, useImagePacks } from '@/store/emoji'
import { EmojiGlyph } from './EmojiGlyph'
import { itemKey, itemName, itemShortcode, searchEmoji, uniqueCustom, type EmojiItem } from './items'
import { loadUnicodeEmoji, readSkinTone, type UnicodeData } from './unicode'

/** Emoji matching a `:query` typed in the composer; null query means no suggestions wanted. */
export function useEmojiSuggestions(query: string | null, roomID: RoomID, limit = 8): EmojiItem[] {
  const [data, setData] = useState<UnicodeData | null>(null)
  const packs = useImagePacks(roomID)
  const frequent = useChat(frequentEmoji)
  const wanted = query !== null

  useEffect(() => {
    if (!wanted || data) return
    let cancelled = false
    loadUnicodeEmoji().then(
      loaded => !cancelled && setData(loaded),
      err => console.error('Failed to load emoji data', err),
    )
    return () => {
      cancelled = true
    }
  }, [wanted, data])

  const custom = useMemo(() => uniqueCustom(packs, 'emojis'), [packs])
  return useMemo(() => (query ? searchEmoji(query, data, custom, frequent, limit) : []), [query, data, custom, frequent, limit])
}

interface EmojiSuggestionsProps {
  items: EmojiItem[]
  active: number
  onHover: (index: number) => void
  onPick: (item: EmojiItem) => void
}

export function EmojiSuggestions({ items, active, onHover, onPick }: EmojiSuggestionsProps) {
  const tone = readSkinTone()
  return (
    <div
      role="listbox"
      aria-label="Emoji suggestions"
      className="emoji-suggestions absolute inset-x-4 bottom-full z-30 mb-1 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-xl"
    >
      <div className="flex items-center justify-between px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
        <span>Emoji</span>
        <span className="normal-case tracking-normal">↑↓ choose · Enter or Tab insert · Esc dismiss</span>
      </div>
      {items.map((item, index) => (
        <button
          key={itemKey(item)}
          type="button"
          role="option"
          aria-selected={index === active}
          onMouseDown={e => e.preventDefault()}
          onMouseEnter={() => onHover(index)}
          onClick={() => onPick(item)}
          className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left text-sm transition-colors', index === active && 'bg-hover')}
        >
          <span className="grid size-7 shrink-0 place-items-center">
            <EmojiGlyph item={item} tone={tone} size={22} />
          </span>
          <span className="shrink-0 font-medium">{itemShortcode(item)}</span>
          <span className="ml-auto min-w-0 truncate text-xs text-muted">{item.kind === 'custom' ? 'Custom emoji' : itemName(item)}</span>
        </button>
      ))}
    </div>
  )
}
