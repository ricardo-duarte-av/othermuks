import * as Dialog from '@radix-ui/react-dialog'
import { Copy, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { client } from '@/api/client'
import { useChat } from '@/store/chat'
import type { TimelineEvent } from '@/store/events'
import { showToast, useUI } from '@/store/ui'
import { Spinner } from '@/ui/primitives'

const closeDialog = () => useUI.setState({ dialog: null })

/** View-source and delete-confirmation dialogs, rendered once for the whole app. */
export function MessageDialogs() {
  const dialog = useUI(s => s.dialog)
  const evt = useChat(s => (dialog ? s.events[dialog.rowid] : undefined))
  const open = !!dialog && !!evt

  return (
    <Dialog.Root open={open} onOpenChange={next => !next && closeDialog()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="message-dialog fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-surface text-fg shadow-2xl outline-none"
        >
          {dialog?.type === 'source' && evt && <SourceView evt={evt} />}
          {dialog?.type === 'delete' && evt && <DeleteConfirm evt={evt} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function JSONBlock({ title, value }: { title: string; value: unknown }) {
  const text = useMemo(() => JSON.stringify(value, null, 2), [value])
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard'), () => showToast("Couldn't copy"))}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-hover hover:text-fg"
        >
          <Copy size={12} /> Copy
        </button>
      </div>
      <pre className="overflow-auto rounded-lg border border-border bg-[var(--code-bg)] p-3 font-mono text-xs leading-relaxed">{text}</pre>
    </section>
  )
}

function SourceView({ evt }: { evt: TimelineEvent }) {
  const wire = {
    event_id: evt.event_id,
    room_id: evt.room_id,
    sender: evt.sender,
    type: evt.original?.type ?? evt.type,
    ...(evt.state_key !== undefined ? { state_key: evt.state_key } : {}),
    origin_server_ts: evt.timestamp,
    content: evt.original?.content ?? evt.content,
    unsigned: evt.unsigned,
  }
  const decrypted = evt.original ? { type: evt.type, content: evt.content } : undefined

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <Dialog.Title className="text-sm font-semibold">Event source</Dialog.Title>
        <Dialog.Close aria-label="Close" className="ml-auto rounded-md p-1 text-muted hover:bg-hover hover:text-fg">
          <X size={16} />
        </Dialog.Close>
      </header>
      <div className="flex min-h-0 flex-col gap-4 overflow-auto p-4">
        <p className="break-all font-mono text-xs text-muted">{evt.event_id}</p>
        {decrypted && <JSONBlock title="Decrypted event" value={decrypted} />}
        <JSONBlock title={decrypted ? 'Encrypted event' : 'Event'} value={wire} />
      </div>
    </>
  )
}

function DeleteConfirm({ evt }: { evt: TimelineEvent }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    try {
      await client.redactEvent(evt.room_id, evt.event_id, reason.trim())
      closeDialog()
    } catch (err) {
      showToast(`Couldn't delete: ${err instanceof Error ? err.message : String(err)}`)
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <Dialog.Title className="text-base font-semibold">Delete message?</Dialog.Title>
      <p className="text-sm text-muted">This removes the message for everyone in the room. It can't be undone.</p>
      <input
        value={reason}
        onChange={e => setReason(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && void confirm()}
        placeholder="Reason (optional)"
        autoFocus
        className="h-10 rounded-lg border border-border bg-bg px-3 text-sm outline-none placeholder:text-muted focus:border-accent"
      />
      <div className="flex justify-end gap-2">
        <Dialog.Close className="rounded-lg px-3 py-2 text-sm hover:bg-hover">Cancel</Dialog.Close>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={busy}
          className="flex items-center gap-2 rounded-lg bg-danger px-3 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {busy && <Spinner size={14} />}
          Delete
        </button>
      </div>
    </div>
  )
}

const TOAST_DURATION = 2500

export function Toaster() {
  const toast = useUI(s => s.toast)
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => useUI.setState(s => (s.toast?.id === toast.id ? { toast: null } : {})), TOAST_DURATION)
    return () => clearTimeout(timer)
  }, [toast])

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className="toast rounded-lg border border-border bg-surface-2 px-4 py-2 text-sm text-fg shadow-xl"
          >
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
