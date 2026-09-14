import * as Dialog from '@radix-ui/react-dialog'
import { Check, Copy, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '@/lib/cn'
import { resetThemeOverrides, setCustomCSS, setTheme, setThemeOverride, showToast, THEMES, useUI } from '@/store/ui'

interface Token {
  name: string
  label: string
}

const PALETTE_TOKENS: Token[] = [
  { name: 'bg', label: 'Background' },
  { name: 'surface', label: 'Panels' },
  { name: 'surface-2', label: 'Raised surfaces' },
  { name: 'hover', label: 'Hover' },
  { name: 'border', label: 'Borders' },
  { name: 'fg', label: 'Text' },
  { name: 'muted', label: 'Secondary text' },
  { name: 'accent', label: 'Accent' },
  { name: 'accent-fg', label: 'Text on accent' },
  { name: 'danger', label: 'Danger' },
  { name: 'success', label: 'Success' },
]

const USER_COLOR_TOKENS: Token[] = Array.from({ length: 8 }, (_, i) => ({ name: `user-color-${i}`, label: `Name color ${i + 1}` }))
const ALL_TOKEN_NAMES = [...PALETTE_TOKENS, ...USER_COLOR_TOKENS].map(token => token.name)

const sectionTitle = 'text-xs font-semibold uppercase tracking-wide text-muted'
const smallButton =
  'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-fg'

let canvasContext: CanvasRenderingContext2D | null | undefined

/** Any CSS color (oklch, rgb, names…) to #rrggbb for <input type="color">. */
function cssColorToHex(color: string): string {
  canvasContext ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!canvasContext) return '#000000'
  canvasContext.clearRect(0, 0, 1, 1)
  canvasContext.fillStyle = '#000000'
  canvasContext.fillStyle = color
  canvasContext.fillRect(0, 0, 1, 1)
  const [r, g, b] = canvasContext.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`
}

function readTokens(): Record<string, string> {
  const style = getComputedStyle(document.documentElement)
  return Object.fromEntries(ALL_TOKEN_NAMES.map(name => [name, style.getPropertyValue(`--${name}`).trim()]))
}

export function AppearanceDialog() {
  const open = useUI(s => s.appearanceOpen)
  const [tab, setTab] = useState<'theme' | 'css'>('theme')

  return (
    <Dialog.Root open={open} onOpenChange={appearanceOpen => useUI.setState({ appearanceOpen })}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="appearance-dialog fixed left-1/2 top-1/2 z-50 flex h-[min(760px,88vh)] w-[min(860px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-surface text-fg shadow-2xl outline-none"
        >
          <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
            <Dialog.Title className="text-sm font-semibold">Appearance</Dialog.Title>
            <div role="tablist" className="flex gap-1 rounded-lg bg-bg p-0.5">
              {(['theme', 'css'] as const).map(id => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                    tab === id ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg',
                  )}
                >
                  {id === 'theme' ? 'Theme' : 'Custom CSS'}
                </button>
              ))}
            </div>
            <Dialog.Close aria-label="Close" className="ml-auto rounded-md p-1 text-muted hover:bg-hover hover:text-fg">
              <X size={16} />
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">{tab === 'theme' ? <ThemeEditor /> : <CSSEditor />}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ThemeEditor() {
  const theme = useUI(s => s.theme)
  const overrides = useUI(s => s.themeOverrides)
  const [effective, setEffective] = useState<Record<string, string>>({})
  const overrideCount = Object.keys(overrides).length

  // Re-read the resolved token values once the new theme/overrides have been applied.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEffective(readTokens()))
    return () => cancelAnimationFrame(frame)
  }, [theme, overrides])

  const copyAsCSS = () => {
    const values = readTokens()
    const css = `:root:root {\n${ALL_TOKEN_NAMES.map(name => `  --${name}: ${values[name]};`).join('\n')}\n}\n`
    navigator.clipboard.writeText(css).then(
      () => showToast('Theme copied as CSS'),
      () => showToast("Couldn't copy"),
    )
  }

  return (
    <div className="flex flex-col gap-6 p-5">
      <section className="flex flex-col gap-2">
        <h3 className={sectionTitle}>Base theme</h3>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
          {THEMES.map(t => (
            <button
              key={t.id}
              type="button"
              data-theme={t.id}
              aria-pressed={theme === t.id}
              onClick={() => setTheme(t.id)}
              className={cn(
                'theme-card flex flex-col gap-2 rounded-lg border p-2 text-left transition',
                theme === t.id ? 'border-accent ring-1 ring-accent' : 'border-border hover:brightness-110',
              )}
              style={{ background: 'var(--bg)', color: 'var(--fg)' }}
            >
              <span className="flex gap-1">
                <span className="h-6 flex-1 rounded" style={{ background: 'var(--surface)' }} />
                <span className="h-6 w-4 rounded" style={{ background: 'var(--user-color-2)' }} />
                <span className="h-6 w-6 rounded" style={{ background: 'var(--accent)' }} />
              </span>
              <span className="flex items-center justify-between text-xs font-medium">
                {t.label}
                {theme === t.id && <Check size={13} />}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={sectionTitle}>Colors</h3>
          <span className="text-xs text-muted">
            {overrideCount ? `${overrideCount} customized, layered on ${THEMES.find(t => t.id === theme)?.label}` : 'Changes are layered on the base theme'}
          </span>
          <span className="ml-auto flex gap-1">
            <button type="button" onClick={copyAsCSS} className={smallButton}>
              <Copy size={12} /> Copy as CSS
            </button>
            {overrideCount > 0 && (
              <button type="button" onClick={resetThemeOverrides} className={smallButton}>
                <RotateCcw size={12} /> Reset all
              </button>
            )}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {PALETTE_TOKENS.map(token => (
            <ColorRow key={token.name} token={token} effective={effective[token.name]} override={overrides[token.name]} />
          ))}
        </div>
        <details className="mt-1">
          <summary className="cursor-pointer text-xs font-medium text-muted hover:text-fg">User name colors</summary>
          <div className="mt-1 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {USER_COLOR_TOKENS.map(token => (
              <ColorRow key={token.name} token={token} effective={effective[token.name]} override={overrides[token.name]} />
            ))}
          </div>
        </details>
      </section>
    </div>
  )
}

function ColorRow({ token, effective, override }: { token: Token; effective?: string; override?: string }) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = (raw: string) => {
    const value = raw.trim()
    setDraft(null)
    if (!value) setThemeOverride(token.name, null)
    else if (CSS.supports('color', value)) setThemeOverride(token.name, value)
    else showToast(`"${value}" isn't a valid CSS color`)
  }

  return (
    <div className="color-row flex items-center gap-2.5 py-1.5">
      <input
        type="color"
        value={effective ? cssColorToHex(effective) : '#000000'}
        onChange={e => setThemeOverride(token.name, e.target.value)}
        aria-label={`${token.label} color picker`}
        className="size-8 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm">
          {token.label}
          {override && <span className="size-1.5 rounded-full bg-accent" title="Customized" />}
        </div>
        <input
          value={draft ?? override ?? effective ?? ''}
          onChange={e => setDraft(e.target.value)}
          onBlur={e => draft !== null && commit(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && commit(e.currentTarget.value)}
          spellCheck={false}
          aria-label={`${token.label} value (any CSS color)`}
          className="w-full truncate bg-transparent font-mono text-[11px] text-muted outline-none focus:text-fg"
        />
      </div>
      {override && (
        <button
          type="button"
          onClick={() => setThemeOverride(token.name, null)}
          title="Back to the theme's color"
          className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
        >
          <RotateCcw size={13} />
        </button>
      )}
    </div>
  )
}

const CSS_PLACEHOLDER = `/* Example: fuchsia unread badges with black text */
.unread-badge {
  --badge-bg: fuchsia;
  --badge-text: black;
}`

const REFERENCE: [selector: string, description: string][] = [
  ['.room-list-item', 'Room in the room list. [data-active], [data-unread]'],
  ['.unread-badge', 'Unread counter. [data-level="notify" | "highlight"]; --badge-bg, --badge-text'],
  ['.chat-message', 'Message row. [data-own], [data-pending], [data-highlight]'],
  ['.chat-bubble', 'Message content. --bubble-bg, --bubble-own-bg, --bubble-radius'],
  ['.message-body', 'Formatted message text'],
  ['.reply-preview', 'Quoted reply above a message'],
  ['.user-avatar', 'Every avatar. --avatar-radius'],
  ['.mention-pill', 'User and room mentions. --pill-bg, --pill-text'],
  ['.reaction-chip', 'Reactions. --reaction-bg, --reaction-own-bg'],
  ['.space-rail', 'Spaces column. --rail-bg'],
  ['.sidebar', 'Room list column. --sidebar-bg'],
  ['.right-panel', 'Right sidebar. --drawer-bg'],
  ['.composer', 'Message input. --composer-bg'],
]

function CSSEditor() {
  const saved = useUI(s => s.customCSS)
  const [value, setValue] = useState(saved)
  const latest = useRef(value)
  latest.current = value

  // Apply live (debounced), and make sure the last edit is kept when the dialog closes.
  useEffect(() => {
    const timer = setTimeout(() => setCustomCSS(value), 300)
    return () => clearTimeout(timer)
  }, [value])
  useEffect(() => () => setCustomCSS(latest.current), [])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab' || e.shiftKey) return
    e.preventDefault()
    const el = e.currentTarget
    const start = el.selectionStart
    setValue(`${value.slice(0, start)}  ${value.slice(el.selectionEnd)}`)
    requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2))
  }

  return (
    <div className="flex h-full flex-col gap-4 p-5 md:flex-row">
      <div className="flex min-h-[320px] min-w-0 flex-1 flex-col gap-2">
        <p className="text-xs text-muted">Applied live and saved on this device. It loads after all built-in styles, so it overrides them.</p>
        <textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={CSS_PLACEHOLDER}
          spellCheck={false}
          aria-label="Custom CSS"
          className="min-h-0 flex-1 resize-none rounded-lg border border-border bg-[var(--code-bg)] p-3 font-mono text-xs leading-relaxed outline-none placeholder:text-muted focus:border-accent"
        />
        <p className="text-[11px] text-muted">
          url() and @import load files from other servers, which lets those servers see your IP address.
        </p>
      </div>
      <aside className="flex w-full shrink-0 flex-col gap-3 md:w-72">
        <h3 className={sectionTitle}>Styling hooks</h3>
        <dl className="flex flex-col gap-2.5 text-xs">
          {REFERENCE.map(([selector, description]) => (
            <div key={selector}>
              <dt className="font-mono text-accent">{selector}</dt>
              <dd className="text-muted">{description}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted">
          Palette variables: --bg, --surface, --surface-2, --hover, --border, --fg, --muted, --accent, --accent-fg, --danger, --success,
          --user-color-0 … 7.
        </p>
      </aside>
    </div>
  )
}
