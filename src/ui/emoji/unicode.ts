// Unicode emoji data (emojibase), served from our own origin and loaded the first time it's needed.
import { useEffect, useState } from 'react'
import { normalizeShortcode } from '@/store/emoji'

export interface UnicodeEmoji {
  unicode: string
  label: string
  group: number
  shortcodes: string[]
  search: string[]
  /** Variants for skin tones 1–5 (index tone - 1), when the emoji has them. */
  skins?: string[]
}

export interface UnicodeData {
  groups: { id: number; emojis: UnicodeEmoji[] }[]
  /** Base emoji and every skin tone variant, mapped to the base entry. */
  byUnicode: Map<string, UnicodeEmoji>
}

/** Emojibase groups in display order; group 2 (skin tone and hair components) is left out. */
export const GROUP_LABELS: Record<number, string> = {
  0: 'Smileys & emotion',
  1: 'People & body',
  3: 'Animals & nature',
  4: 'Food & drink',
  5: 'Travel & places',
  6: 'Activities',
  7: 'Objects',
  8: 'Symbols',
  9: 'Flags',
}

const TONE_HEXCODES = ['1F3FB', '1F3FC', '1F3FD', '1F3FE', '1F3FF']

interface CompactEmoji {
  group?: number
  hexcode: string
  label: string
  order?: number
  unicode: string
  skins?: { hexcode: string; unicode: string }[]
}

/** The variant where every skin tone modifier is the given tone (so multi-person emoji match too). */
function skinVariant(skins: CompactEmoji['skins'], tone: number): string | undefined {
  const hex = TONE_HEXCODES[tone - 1]
  return skins?.find(skin => {
    const modifiers = skin.hexcode.split('-').filter(part => TONE_HEXCODES.includes(part))
    return modifiers.length > 0 && modifiers.every(part => part === hex)
  })?.unicode
}

export function buildUnicodeData(compact: CompactEmoji[], shortcodes: Record<string, string | string[]>): UnicodeData {
  const byGroup = new Map<number, (UnicodeEmoji & { order: number })[]>()
  const byUnicode = new Map<string, UnicodeEmoji>()
  for (const entry of compact) {
    if (entry.group === undefined || !(entry.group in GROUP_LABELS)) continue
    const raw = shortcodes[entry.hexcode]
    const codes = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]
    const variants = [1, 2, 3, 4, 5].map(tone => skinVariant(entry.skins, tone))
    const skins = variants.some(Boolean) ? variants.map(v => v ?? entry.unicode) : undefined
    const emoji = {
      unicode: entry.unicode,
      label: entry.label,
      group: entry.group,
      order: entry.order ?? 0,
      shortcodes: codes,
      // Shortcodes first; the label (e.g. "thumbs up") helps when no shortcode matches.
      search: [...codes.map(normalizeShortcode), normalizeShortcode(entry.label)],
      skins,
    }
    // Emojibase (like gomuks and Element) includes U+FE0F where it qualifies an emoji; also accept the
    // bare form so keys stored by other clients still resolve.
    for (const key of [emoji.unicode, ...(skins ?? [])]) {
      for (const form of [key, key.replaceAll('️', '')]) if (!byUnicode.has(form)) byUnicode.set(form, emoji)
    }
    let list = byGroup.get(entry.group)
    if (!list) byGroup.set(entry.group, (list = []))
    list.push(emoji)
  }
  const groups = Object.keys(GROUP_LABELS)
    .map(Number)
    .filter(id => byGroup.has(id))
    .map(id => ({ id, emojis: byGroup.get(id)!.sort((a, b) => a.order - b.order) }))
  return { groups, byUnicode }
}

let loaded: UnicodeData | null = null
let loading: Promise<UnicodeData> | null = null

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}emojibase/en/${path}`)
  if (!res.ok) throw new Error(`HTTP ${res.status} loading ${path}`)
  return res.json() as Promise<T>
}

export function loadUnicodeEmoji(): Promise<UnicodeData> {
  loading ??= Promise.all([
    fetchJSON<CompactEmoji[]>('compact.json'),
    fetchJSON<Record<string, string | string[]>>('shortcodes/emojibase.json'),
  ]).then(
    ([compact, shortcodes]) => (loaded = buildUnicodeData(compact, shortcodes)),
    err => {
      loading = null
      throw err
    },
  )
  return loading
}

export function useUnicodeEmoji() {
  const [state, setState] = useState<{ data: UnicodeData | null; error: string | null }>(() => ({ data: loaded, error: null }))
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (state.data) return
    let cancelled = false
    loadUnicodeEmoji().then(
      data => !cancelled && setState({ data, error: null }),
      err => !cancelled && setState({ data: null, error: err instanceof Error ? err.message : String(err) }),
    )
    return () => {
      cancelled = true
    }
  }, [attempt, state.data])
  const retry = () => {
    setState({ data: null, error: null })
    setAttempt(n => n + 1)
  }
  return { ...state, retry }
}

// ---- Skin tone (remembered on this device) ----

const SKIN_TONE_KEY = 'othermuks-skin-tone'

export function readSkinTone(): number {
  try {
    const value = Number(localStorage.getItem(SKIN_TONE_KEY))
    return Number.isInteger(value) && value >= 0 && value <= 5 ? value : 0
  } catch {
    return 0
  }
}

export function useSkinTone(): [number, (tone: number) => void] {
  const [tone, setTone] = useState(readSkinTone)
  const update = (next: number) => {
    setTone(next)
    try {
      localStorage.setItem(SKIN_TONE_KEY, String(next))
    } catch {
      // Not persisted; still applies until the picker closes.
    }
  }
  return [tone, update]
}
