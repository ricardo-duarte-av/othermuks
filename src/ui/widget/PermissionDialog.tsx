import * as Dialog from '@radix-ui/react-dialog'
import { ShieldQuestion } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { usePermissionPrompt } from '@/store/widgets'

/** Readable names for widget capabilities (capability IDs may carry a ":parameter"). */
const CAPABILITY_NAMES: Record<string, string> = {
  'm.always_on_screen': 'Stay on screen while you use other rooms',
  'm.capability.screenshots': 'Take screenshots',
  'm.sticker': 'Send stickers',
  'io.element.requires_client': 'Require a compatible client',
  'org.matrix.msc2931.navigate': 'Navigate to other rooms',
  'town.robin.msc3846.turn_servers': 'Request TURN servers from the homeserver',
  'org.matrix.msc4157.send.delayed_event': 'Send delayed events',
  'org.matrix.msc4157.update_delayed_event': 'Update delayed events',
  'org.matrix.msc4039.upload_file': 'Upload files',
  'org.matrix.msc4039.download_file': 'Download files',
  'org.matrix.msc2762.timeline': 'Read room history',
  'org.matrix.msc2762.send.event': 'Send timeline events',
  'org.matrix.msc2762.receive.event': 'Receive timeline events',
  'org.matrix.msc2762.send.state_event': 'Send state events',
  'org.matrix.msc2762.receive.state_event': 'Read state events',
  'org.matrix.msc3819.send.to_device': 'Send to-device messages',
  'org.matrix.msc3819.receive.to_device': 'Receive to-device messages',
  'org.matrix.msc3869.read_relations': 'Read related events',
  'org.matrix.msc3973.user_directory_search': 'Search the user directory',
  'org.matrix.msc4515.rtc_transports': 'Request call (RTC) transports from the homeserver',
  'org.matrix.msc4407.send.sticky_event': 'Send sticky events',
  'org.matrix.msc4407.receive.sticky_event': 'Receive sticky events',
}

function describe(capability: string): { name: string; parameter: string | null } {
  const index = capability.indexOf(':')
  const id = index === -1 ? capability : capability.slice(0, index)
  return { name: CAPABILITY_NAMES[id] ?? id, parameter: index === -1 ? null : capability.slice(index + 1) }
}

function hostOf(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function PermissionDialog() {
  const request = usePermissionPrompt(s => s.request)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [remember, setRemember] = useState(true)

  useEffect(() => {
    if (!request) return
    setSelected(new Set(request.preselected))
    setRemember(true)
  }, [request])

  const toggle = (capability: string) =>
    setSelected(current => {
      const next = new Set(current)
      if (next.has(capability)) next.delete(capability)
      else next.add(capability)
      return next
    })

  return (
    <Dialog.Root open={!!request} onOpenChange={open => !open && request?.resolve([], false)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="widget-permissions fixed left-1/2 top-1/2 z-[80] flex max-h-[85vh] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-surface text-fg shadow-2xl outline-none"
        >
          {request && (
            <>
              <header className="flex shrink-0 items-start gap-3 border-b border-border px-5 py-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
                  <ShieldQuestion size={20} />
                </span>
                <div className="min-w-0">
                  <Dialog.Title className="text-base font-semibold">“{request.widgetName}” wants permission</Dialog.Title>
                  <p className="mt-0.5 truncate text-xs text-muted" title={request.widgetURL}>
                    {hostOf(request.widgetURL)}
                  </p>
                </div>
              </header>
              <ul className="min-h-0 flex-1 overflow-y-auto p-2">
                {request.requested.map(capability => {
                  const { name, parameter } = describe(capability)
                  const checked = selected.has(capability)
                  return (
                    <li key={capability}>
                      <label
                        className={cn(
                          'flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-hover',
                          !checked && 'text-muted',
                        )}
                      >
                        <input type="checkbox" checked={checked} onChange={() => toggle(capability)} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
                        <span className="min-w-0">
                          {name}
                          {parameter && <code className="ml-1.5 break-all rounded bg-surface-2 px-1 py-px text-[11px] text-muted">{parameter}</code>}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
              <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-5 py-3">
                <label className="mr-auto flex cursor-pointer items-center gap-2 text-xs text-muted">
                  <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
                  Remember for this widget
                </label>
                <button type="button" onClick={() => request.resolve([], remember)} className="rounded-lg px-3 py-2 text-sm hover:bg-hover">
                  Deny all
                </button>
                <button
                  type="button"
                  onClick={() => request.resolve([...selected], remember)}
                  className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110"
                >
                  Allow selected
                </button>
              </footer>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
