import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, Palette } from 'lucide-react'
import { setTheme, THEMES, useUI, type ThemeID } from '@/store/ui'

export function ThemeMenu() {
  const theme = useUI(s => s.theme)
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Theme"
        title="Theme"
        className="grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg data-[state=open]:bg-surface-2 data-[state=open]:text-fg"
      >
        <Palette size={18} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="right"
          align="end"
          sideOffset={10}
          className="theme-menu z-50 min-w-52 rounded-lg border border-border bg-surface p-1 text-fg shadow-xl"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-xs text-muted">Theme</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={theme} onValueChange={value => setTheme(value as ThemeID)}>
            {THEMES.map(t => (
              <DropdownMenu.RadioItem
                key={t.id}
                value={t.id}
                className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-hover"
              >
                <span
                  data-theme={t.id}
                  className="size-4 rounded-full border border-border"
                  style={{ background: 'linear-gradient(135deg, var(--bg) 50%, var(--accent) 50%)' }}
                />
                {t.label}
                <DropdownMenu.ItemIndicator className="ml-auto text-accent">
                  <Check size={14} />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
