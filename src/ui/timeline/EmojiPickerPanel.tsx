import { EmojiPicker } from 'frimousse'

/** Emoji data is served from our own origin (/emojibase, see vite.config.ts), never from a CDN. */
export default function EmojiPickerPanel({ onSelect }: { onSelect: (emoji: string) => void }) {
  return (
    <EmojiPicker.Root
      emojibaseUrl={`${import.meta.env.BASE_URL}emojibase`}
      columns={9}
      onEmojiSelect={({ emoji }) => onSelect(emoji)}
      className="isolate flex h-[360px] w-fit flex-col"
    >
      <EmojiPicker.Search
        autoFocus
        placeholder="Search emoji…"
        className="z-10 mx-2 mt-2 appearance-none rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
      />
      <EmojiPicker.Viewport className="relative flex-1 outline-none">
        <EmojiPicker.Loading className="absolute inset-0 flex items-center justify-center text-sm text-muted">
          Loading…
        </EmojiPicker.Loading>
        <EmojiPicker.Empty className="absolute inset-0 flex items-center justify-center text-sm text-muted">
          No emoji found
        </EmojiPicker.Empty>
        <EmojiPicker.List
          className="select-none pb-1.5"
          components={{
            CategoryHeader: ({ category, ...props }) => (
              <div className="bg-surface px-3 pb-1.5 pt-3 text-xs font-medium text-muted" {...props}>
                {category.label}
              </div>
            ),
            Row: ({ children, ...props }) => (
              <div className="scroll-my-1.5 px-1.5" {...props}>
                {children}
              </div>
            ),
            Emoji: ({ emoji, ...props }) => (
              <button className="flex size-9 items-center justify-center rounded-md text-xl data-[active]:bg-hover" {...props}>
                {emoji.emoji}
              </button>
            ),
          }}
        />
      </EmojiPicker.Viewport>
    </EmojiPicker.Root>
  )
}
