import * as Dialog from '@radix-ui/react-dialog'
import { ArrowDown, ArrowUp, GripVertical, X } from 'lucide-react'
import { Reorder, useDragControls } from 'motion/react'
import { useState } from 'react'
import type { RoomID } from '@/api/types'
import { useChat } from '@/store/chat'
import { saveSpaceOrder } from '@/store/spaceOrder'
import { showToast } from '@/store/ui'
import { Avatar, Spinner } from '@/ui/primitives'

/**
 * Drag (or nudge with the arrows) the top-level spaces into order, then save it to account data, where
 * every client that follows MSC3230 (gomuks web, Element) picks it up.
 */
export function SpaceOrderDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="space-order-dialog fixed left-1/2 top-1/2 z-50 flex max-h-[min(720px,90vh)] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-surface text-fg shadow-2xl outline-none"
        >
          {open && <SpaceOrderBody close={() => onOpenChange(false)} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function SpaceOrderBody({ close }: { close: () => void }) {
  const saved = useChat(s => s.topLevelSpaces)
  const [order, setOrder] = useState<RoomID[]>(saved)
  const [saving, setSaving] = useState(false)
  const changed = order.join('\n') !== saved.join('\n')

  const move = (index: number, by: number) => {
    const target = index + by
    if (target < 0 || target >= order.length) return
    const next = [...order]
    ;[next[index], next[target]] = [next[target], next[index]]
    setOrder(next)
  }

  const save = async () => {
    setSaving(true)
    try {
      await saveSpaceOrder(order)
      close()
    } catch (err) {
      showToast(`Couldn't save the space order: ${err instanceof Error ? err.message : String(err)}`)
      setSaving(false)
    }
  }

  return (
    <>
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <Dialog.Title className="text-sm font-semibold">Reorder spaces</Dialog.Title>
        <Dialog.Close aria-label="Close" className="ml-auto rounded-md p-1 text-muted hover:bg-hover hover:text-fg">
          <X size={16} />
        </Dialog.Close>
      </header>
      <p className="shrink-0 px-4 pt-3 text-xs text-muted">Drag spaces into the order you want. It's saved on your account, so other clients use it too.</p>
      <Reorder.Group axis="y" values={order} onReorder={setOrder} className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-3">
        {order.map((spaceID, index) => (
          <SpaceOrderItem
            key={spaceID}
            spaceID={spaceID}
            first={index === 0}
            last={index === order.length - 1}
            onMove={by => move(index, by)}
          />
        ))}
      </Reorder.Group>
      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-2.5">
        <button
          type="button"
          onClick={() => setOrder(saved)}
          disabled={!changed || saving}
          className="rounded-lg px-3 py-1.5 text-xs text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-50"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!changed || saving}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-50"
        >
          {saving && <Spinner size={12} />} Save order
        </button>
      </footer>
    </>
  )
}

function SpaceOrderItem({ spaceID, first, last, onMove }: { spaceID: RoomID; first: boolean; last: boolean; onMove: (by: number) => void }) {
  const meta = useChat(s => s.rooms[spaceID]?.meta)
  const controls = useDragControls()
  const name = meta?.name ?? spaceID
  return (
    <Reorder.Item
      value={spaceID}
      dragListener={false}
      dragControls={controls}
      className="space-order-item flex select-none items-center gap-2 rounded-lg border border-border bg-surface-2 px-2 py-1.5"
    >
      {/* Only the grip starts a drag, so the list still scrolls by touch. */}
      <span
        onPointerDown={e => controls.start(e)}
        className="cursor-grab touch-none rounded p-1 text-muted hover:text-fg active:cursor-grabbing"
        aria-hidden
      >
        <GripVertical size={16} />
      </span>
      <Avatar mxc={meta?.avatar} id={spaceID} name={meta?.name} size={28} className="rounded-lg" />
      <span className="min-w-0 flex-1 truncate text-sm" title={spaceID}>
        {name}
      </span>
      <button type="button" aria-label={`Move ${name} up`} disabled={first} onClick={() => onMove(-1)} className="rounded p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-30">
        <ArrowUp size={14} />
      </button>
      <button type="button" aria-label={`Move ${name} down`} disabled={last} onClick={() => onMove(1)} className="rounded p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-30">
        <ArrowDown size={14} />
      </button>
    </Reorder.Item>
  )
}
