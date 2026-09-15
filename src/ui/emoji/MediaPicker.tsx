import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Apple,
  Check,
  Clock,
  Flag,
  Hand,
  Lightbulb,
  Package,
  PawPrint,
  Plane,
  Plus,
  Search,
  SearchX,
  Shapes,
  Smile,
  Sticker,
  Trophy,
  X,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { mediaURL } from '@/api/media'
import type { RoomID } from '@/api/types'
import { cn } from '@/lib/cn'
import { useChat } from '@/store/chat'
import { frequentEmoji, recordEmojiUse, setPackSubscribed, useImagePacks, type PackEntry } from '@/store/emoji'
import { showToast } from '@/store/ui'
import { Spinner } from '@/ui/primitives'
import { EMOJI_FONT, EmojiGlyph } from './EmojiGlyph'
import {
  frequentItems,
  itemKey,
  itemName,
  itemShortcode,
  searchEmoji,
  uniqueCustom,
  withTone,
  type EmojiItem,
  type PickerSelection,
  type PickerTab,
} from './items'
import { GROUP_LABELS, useSkinTone, useUnicodeEmoji, type UnicodeData } from './unicode'

const EMOJI_COLUMNS = 9
const EMOJI_CELL = 40
const STICKER_COLUMNS = 4
const STICKER_CELL = 88
const HEADER_HEIGHT = 30

const GROUP_ICONS: Record<number, ReactNode> = {
  0: <Smile size={17} />,
  1: <Hand size={17} />,
  3: <PawPrint size={17} />,
  4: <Apple size={17} />,
  5: <Plane size={17} />,
  6: <Trophy size={17} />,
  7: <Lightbulb size={17} />,
  8: <Shapes size={17} />,
  9: <Flag size={17} />,
}

const TONES = ['✋', '✋🏻', '✋🏼', '✋🏽', '✋🏾', '✋🏿']
const TONE_NAMES = ['Default', 'Light', 'Medium-light', 'Medium', 'Medium-dark', 'Dark']

interface Section {
  id: string
  label: string
  icon: ReactNode
  items: EmojiItem[]
  entry?: PackEntry
}

interface Row {
  kind: 'header' | 'cells'
  section: number
  /** Item range within the section (cells rows). */
  start: number
  end: number
  /** Flat index of the row's first item (cells rows). */
  global: number
}

function PackIcon({ entry }: { entry: PackEntry }) {
  const url = mediaURL(entry.pack.icon)
  return url ? <img src={url} alt="" loading="lazy" draggable={false} className="size-5 rounded object-contain" /> : <Package size={17} />
}

function buildSections(tab: PickerTab, query: string, unicode: UnicodeData | null, packs: PackEntry[], frequent: Map<string, number>): Section[] {
  const stickers = tab === 'stickers'
  const custom = uniqueCustom(packs, stickers ? 'stickers' : 'emojis')
  if (query.trim()) {
    const items = searchEmoji(query, stickers ? null : unicode, custom, frequent, stickers ? 200 : 360)
    return items.length ? [{ id: 'search', label: 'Results', icon: <Search size={17} />, items }] : []
  }
  const sections: Section[] = []
  if (!stickers) {
    const recent = frequentItems(frequent, unicode, custom)
    if (recent.length) sections.push({ id: 'frequent', label: 'Frequently used', icon: <Clock size={17} />, items: recent })
  }
  for (const entry of packs) {
    const list = stickers ? entry.pack.stickers : entry.pack.emojis
    if (!list.length) continue
    sections.push({
      id: `pack:${entry.pack.id}`,
      label: entry.pack.name,
      icon: <PackIcon entry={entry} />,
      entry,
      items: list.map(emoji => ({ kind: 'custom', emoji })),
    })
  }
  if (!stickers) {
    for (const group of unicode?.groups ?? []) {
      sections.push({
        id: `group:${group.id}`,
        label: GROUP_LABELS[group.id],
        icon: GROUP_ICONS[group.id],
        items: group.emojis.map(emoji => ({ kind: 'unicode', emoji })),
      })
    }
  }
  return sections
}

interface MediaPickerProps {
  roomID: RoomID | null
  tabs: PickerTab[]
  initialTab?: PickerTab
  /** Offer reacting with whatever was typed (reactions only). */
  allowFreeform?: boolean
  onSelect: (selection: PickerSelection) => void
}

export default function MediaPicker({ roomID, tabs, initialTab, allowFreeform, onSelect }: MediaPickerProps) {
  const [tab, setTab] = useState<PickerTab>(initialTab && tabs.includes(initialTab) ? initialTab : tabs[0])
  const [query, setQuery] = useState('')
  const [focus, setFocus] = useState(-1)
  const [tone, setTone] = useSkinTone()
  const unicode = useUnicodeEmoji()
  const packs = useImagePacks(roomID)
  const frequent = useChat(frequentEmoji)
  const stickers = tab === 'stickers'
  const columns = stickers ? STICKER_COLUMNS : EMOJI_COLUMNS
  const cellSize = stickers ? STICKER_CELL : EMOJI_CELL

  const sections = useMemo(() => buildSections(tab, query, unicode.data, packs, frequent), [tab, query, unicode.data, packs, frequent])

  const layout = useMemo(() => {
    const rows: Row[] = []
    const starts: number[] = []
    const sectionRows: number[] = []
    const rowOfItem: number[] = []
    const flat: EmojiItem[] = []
    let y = 0
    sections.forEach((section, si) => {
      sectionRows.push(rows.length)
      starts.push(y)
      rows.push({ kind: 'header', section: si, start: 0, end: 0, global: -1 })
      y += HEADER_HEIGHT
      for (let i = 0; i < section.items.length; i += columns) {
        const end = Math.min(i + columns, section.items.length)
        const global = flat.length
        for (let j = i; j < end; j++) {
          rowOfItem.push(rows.length)
          flat.push(section.items[j])
        }
        starts.push(y)
        rows.push({ kind: 'cells', section: si, start: i, end, global })
        y += cellSize
      }
    })
    return { rows, starts, sectionRows, rowOfItem, flat }
  }, [sections, columns, cellSize])

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: layout.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: index => (layout.rows[index].kind === 'header' ? HEADER_HEIGHT : cellSize),
    getItemKey: index => {
      const row = layout.rows[index]
      return `${tab}:${sections[row.section]?.id}:${row.kind}:${row.start}`
    },
    overscan: 6,
    useFlushSync: false,
  })

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
    setFocus(query.trim() ? 0 : -1)
  }, [tab, query])

  // The section at the top of the viewport, for the category rail and the pinned header.
  const offset = virtualizer.scrollOffset ?? 0
  let lo = 0
  let hi = layout.starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (layout.starts[mid] <= offset + 1) lo = mid
    else hi = mid - 1
  }
  const activeSection = layout.rows[lo]?.section ?? 0
  const pinnedHeader = sections.length > 0 && offset > (layout.starts[layout.sectionRows[activeSection]] ?? 0) ? sections[activeSection] : undefined

  const focused = focus >= 0 && focus < layout.flat.length ? focus : -1
  const preview = focused >= 0 ? layout.flat[focused] : undefined

  const select = (item: EmojiItem) => {
    if (stickers && item.kind === 'custom') {
      onSelect({ kind: 'sticker', emoji: item.emoji })
    } else if (item.kind === 'custom') {
      recordEmojiUse(item.emoji.key)
      onSelect({ kind: 'custom', emoji: item.emoji })
    } else {
      const text = item.text ?? withTone(item.emoji, tone)
      recordEmojiUse(text)
      onSelect({ kind: 'unicode', text })
    }
  }

  const focusItem = (index: number) => {
    const clamped = Math.min(Math.max(index, 0), layout.flat.length - 1)
    setFocus(clamped)
    virtualizer.scrollToIndex(layout.rowOfItem[clamped], { align: 'auto' })
  }

  const verticalNeighbour = (index: number, direction: 1 | -1) => {
    const r = layout.rowOfItem[index]
    const column = index - layout.rows[r].global
    for (let i = r + direction; i >= 0 && i < layout.rows.length; i += direction) {
      const row = layout.rows[i]
      if (row.kind === 'cells') return row.global + Math.min(column, row.end - row.start - 1)
    }
    return index
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const total = layout.flat.length
    if (e.key === 'Enter') {
      e.preventDefault()
      if (focused >= 0) select(layout.flat[focused])
      else if (total && query.trim()) select(layout.flat[0])
      else if (allowFreeform && query.trim()) onSelect({ kind: 'unicode', text: query.trim() })
      return
    }
    if (!total) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusItem(focused < 0 ? 0 : verticalNeighbour(focused, 1))
    } else if (e.key === 'ArrowUp' && focused >= 0) {
      e.preventDefault()
      const up = verticalNeighbour(focused, -1)
      if (up === focused) setFocus(-1)
      else focusItem(up)
    } else if (e.key === 'ArrowRight' && focused >= 0) {
      e.preventDefault()
      focusItem(focused + 1)
    } else if (e.key === 'ArrowLeft' && focused >= 0) {
      e.preventDefault()
      focusItem(focused - 1)
    }
  }

  const loading = !stickers && !unicode.data && !unicode.error
  const noun = stickers ? 'stickers' : 'emoji'

  return (
    <div className="media-picker flex h-[440px] w-[388px] max-w-[calc(100vw-24px)] flex-col" onKeyDown={onKeyDown}>
      <div className="flex shrink-0 items-center gap-2 px-3 pt-3">
        {tabs.length > 1 && (
          <div role="tablist" aria-label="Picker" className="flex shrink-0 rounded-lg bg-bg p-0.5">
            {tabs.map(id => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn('relative rounded-md px-2.5 py-1 text-xs font-medium transition-colors', tab === id ? 'text-fg' : 'text-muted hover:text-fg')}
              >
                {tab === id && (
                  <motion.span
                    layoutId="media-picker-tab"
                    className="absolute inset-0 rounded-md bg-surface-2 shadow-sm"
                    transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                  />
                )}
                <span className="relative flex items-center gap-1">
                  {id === 'emoji' ? <Smile size={13} /> : <Sticker size={13} />}
                  {id === 'emoji' ? 'Emoji' : 'Stickers'}
                </span>
              </button>
            ))}
          </div>
        )}
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-bg px-2.5 transition-colors focus-within:border-accent">
          <Search size={15} className="shrink-0 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`Search ${noun}`}
            aria-label={`Search ${noun}`}
            aria-activedescendant={focused >= 0 ? `media-picker-item-${focused}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="rounded p-0.5 text-muted hover:text-fg">
              <X size={14} />
            </button>
          )}
        </label>
      </div>

      {!query.trim() && sections.length > 1 && (
        <CategoryRail
          sections={sections}
          active={activeSection}
          onPick={index => virtualizer.scrollToIndex(layout.sectionRows[index], { align: 'start' })}
        />
      )}

      <div className="relative min-h-0 flex-1">
        {pinnedHeader && (
          <div className="pointer-events-none absolute inset-x-2 top-0 z-10 [&_button]:pointer-events-auto">
            <SectionHeader section={pinnedHeader} />
          </div>
        )}
        <div ref={scrollRef} role="listbox" aria-label={noun} className="h-full overflow-y-auto overflow-x-hidden px-2 pb-2">
          {unicode.error && !stickers && (
            <p className="mx-1 mt-2 flex items-center gap-2 rounded-lg bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
              Couldn't load emoji: {unicode.error}
              <button type="button" onClick={unicode.retry} className="ml-auto font-medium underline">
                Retry
              </button>
            </p>
          )}
          {loading ? (
            <SkeletonGrid />
          ) : layout.rows.length === 0 ? (
            query.trim() ? (
              <EmptyState icon={<SearchX size={28} />} title={`No ${noun} match “${query.trim()}”`} hint="Try a shorter or different name.">
                {allowFreeform && (
                  <button
                    type="button"
                    onClick={() => onSelect({ kind: 'unicode', text: query.trim() })}
                    className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition hover:brightness-110"
                  >
                    React with “{query.trim()}”
                  </button>
                )}
              </EmptyState>
            ) : (
              <EmptyState
                icon={<Sticker size={28} />}
                title="No sticker packs yet"
                hint="Packs you subscribe to show up here, along with the packs of the room you're in. Subscribe from a pack's header in the emoji tab."
              />
            )
          ) : (
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map(virtualRow => {
                const row = layout.rows[virtualRow.index]
                const section = sections[row.section]
                return (
                  <div
                    key={virtualRow.key}
                    className="absolute left-0 top-0 w-full"
                    style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
                  >
                    {row.kind === 'header' ? (
                      <SectionHeader section={section} />
                    ) : (
                      <div className={cn('flex', stickers && 'gap-1')}>
                        {section.items.slice(row.start, row.end).map((item, i) => {
                          const index = row.global + i
                          return (
                            <Cell
                              key={itemKey(item)}
                              id={`media-picker-item-${index}`}
                              item={item}
                              sticker={stickers}
                              tone={tone}
                              focused={index === focused}
                              onHover={() => setFocus(index)}
                              onPick={() => select(item)}
                            />
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <footer className="flex h-14 shrink-0 items-center gap-3 border-t border-border bg-bg/40 px-3">
        {preview ? (
          <>
            <span className="grid size-10 shrink-0 place-items-center">
              <EmojiGlyph item={preview} tone={tone} size={stickers ? 40 : 32} />
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium">{itemName(preview)}</span>
              <span className="block truncate text-xs text-muted">{itemShortcode(preview)}</span>
            </span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs text-muted">
            {stickers ? 'Pick a sticker to send it' : 'Hover or use the arrow keys to preview'}
          </span>
        )}
        {allowFreeform && query.trim() && layout.flat.length > 0 && (
          <button
            type="button"
            onClick={() => onSelect({ kind: 'unicode', text: query.trim() })}
            className="max-w-32 shrink-0 truncate rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-fg"
            title="React with the typed text"
          >
            React “{query.trim()}”
          </button>
        )}
        {!stickers && <SkinTonePicker tone={tone} onChange={setTone} />}
      </footer>
    </div>
  )
}

function CategoryRail({ sections, active, onPick }: { sections: Section[]; active: number; onPick: (index: number) => void }) {
  const railRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    railRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])
  return (
    <div
      ref={railRef}
      role="tablist"
      aria-label="Categories"
      className="mx-3 mt-2 flex shrink-0 gap-0.5 overflow-x-auto border-b border-border pb-1 [scrollbar-width:none]"
    >
      {sections.map((section, index) => (
        <button
          key={section.id}
          type="button"
          role="tab"
          aria-selected={index === active}
          title={section.label}
          aria-label={section.label}
          data-active={index === active || undefined}
          onClick={() => onPick(index)}
          className={cn(
            'relative grid size-8 shrink-0 place-items-center rounded-md transition-colors',
            index === active ? 'text-accent' : 'text-muted hover:bg-hover hover:text-fg',
          )}
        >
          {section.icon}
          {index === active && (
            <motion.span
              layoutId="media-picker-rail"
              className="absolute inset-x-1.5 -bottom-1 h-0.5 rounded-full bg-accent"
              transition={{ type: 'spring', stiffness: 520, damping: 42 }}
            />
          )}
        </button>
      ))}
    </div>
  )
}

function SectionHeader({ section }: { section: Section }) {
  const entry = section.entry
  return (
    <div className="flex h-[30px] items-center gap-2 bg-surface px-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
      <span className="truncate" title={section.label}>
        {section.label}
      </span>
      {entry?.fromRoom && (
        <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-px text-[10px] font-medium normal-case tracking-normal text-accent">
          This room
        </span>
      )}
      {entry && <SubscribeButton entry={entry} />}
    </div>
  )
}

function SubscribeButton({ entry }: { entry: PackEntry }) {
  const [busy, setBusy] = useState(false)
  const { pack, subscribed } = entry
  const toggle = async () => {
    setBusy(true)
    try {
      await setPackSubscribed(pack.roomID, pack.stateKey, !subscribed)
    } catch (err) {
      showToast(`Couldn't ${subscribed ? 'unsubscribe from' : 'subscribe to'} ${pack.name}: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      title={subscribed ? 'Available in every room. Click to unsubscribe.' : 'Make this pack available in every room'}
      className={cn(
        'group/sub ml-auto flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium normal-case tracking-normal transition-colors disabled:opacity-60',
        subscribed ? 'text-muted hover:bg-danger/10 hover:text-danger' : 'bg-accent/15 text-accent hover:bg-accent/25',
      )}
    >
      {busy ? <Spinner size={11} /> : subscribed ? <Check size={12} className="group-hover/sub:hidden" /> : <Plus size={12} />}
      {subscribed ? (
        <>
          <span className="group-hover/sub:hidden">Subscribed</span>
          <span className="hidden group-hover/sub:inline">Unsubscribe</span>
        </>
      ) : (
        'Subscribe'
      )}
    </button>
  )
}

interface CellProps {
  id: string
  item: EmojiItem
  sticker: boolean
  tone: number
  focused: boolean
  onHover: () => void
  onPick: () => void
}

function Cell({ id, item, sticker, tone, focused, onHover, onPick }: CellProps) {
  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={focused}
      aria-label={itemShortcode(item) || itemName(item)}
      title={itemShortcode(item) || itemName(item)}
      tabIndex={-1}
      onMouseEnter={onHover}
      onClick={onPick}
      className={cn(
        'group/cell grid shrink-0 place-items-center rounded-lg outline-none transition-colors',
        sticker ? 'size-[88px] p-1.5' : 'size-10',
        focused ? 'bg-hover ring-1 ring-accent/60' : 'hover:bg-hover',
      )}
    >
      <span className="transition-transform duration-150 ease-out group-hover/cell:scale-[1.18] group-active/cell:scale-95">
        <EmojiGlyph item={item} tone={tone} size={sticker ? 74 : 28} />
      </span>
    </button>
  )
}

function SkinTonePicker({ tone, onChange }: { tone: number; onChange: (tone: number) => void }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button
        type="button"
        title={`Skin tone: ${TONE_NAMES[tone]}`}
        aria-label={`Skin tone: ${TONE_NAMES[tone]}`}
        onClick={() => setOpen(true)}
        className="grid size-8 shrink-0 place-items-center rounded-md text-xl transition-colors hover:bg-hover"
        style={{ fontFamily: EMOJI_FONT }}
      >
        {TONES[tone]}
      </button>
    )
  }
  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      role="radiogroup"
      aria-label="Skin tone"
      className="flex shrink-0 gap-0.5 rounded-lg bg-surface-2 p-0.5 shadow"
    >
      {TONES.map((glyph, index) => (
        <button
          key={glyph}
          type="button"
          role="radio"
          aria-checked={index === tone}
          aria-label={TONE_NAMES[index]}
          title={TONE_NAMES[index]}
          onClick={() => {
            onChange(index)
            setOpen(false)
          }}
          className={cn('grid size-7 place-items-center rounded-md text-lg transition-colors hover:bg-hover', index === tone && 'bg-hover ring-1 ring-accent/60')}
          style={{ fontFamily: EMOJI_FONT }}
        >
          {glyph}
        </button>
      ))}
    </motion.div>
  )
}

function SkeletonGrid() {
  return (
    <div className="animate-pulse px-1.5 pt-2" aria-label="Loading emoji">
      <div className="mb-2 h-3 w-28 rounded bg-surface-2" />
      <div className="grid grid-cols-9 gap-1">
        {Array.from({ length: 54 }, (_, i) => (
          <div key={i} className="size-8 rounded-lg bg-surface-2" />
        ))}
      </div>
    </div>
  )
}

function EmptyState({ icon, title, hint, children }: { icon: ReactNode; title: string; hint: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <span className="mb-3 grid size-14 place-items-center rounded-2xl bg-surface-2 text-muted">{icon}</span>
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">{hint}</p>
      {children}
    </div>
  )
}
