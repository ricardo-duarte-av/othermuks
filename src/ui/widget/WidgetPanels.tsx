import { ArrowLeft, LayoutGrid, ShieldOff, TriangleAlert, Video, X } from 'lucide-react'
import { lazy, Suspense, useMemo, type ReactNode } from 'react'
import type { RoomID } from '@/api/types'
import { useChat } from '@/store/chat'
import { usePreference } from '@/store/preferences'
import { closeWidgets, openWidget, openWidgetList } from '@/store/ui'
import {
  activeCallMembers,
  CALL_WIDGET_ID,
  elementCallWidget,
  forgetWidgetPermissions,
  useRoomWidgets,
  useWidgetPermissions,
  widgetPermissionKey,
  type RoomWidget,
} from '@/store/widgets'
import { IconButton, Spinner } from '@/ui/primitives'

// The widget API library only loads once a widget is opened.
const WidgetFrame = lazy(() => import('./WidgetFrame'))

function PanelHeader({ title, onBack, children }: { title: string; onBack?: () => void; children?: ReactNode }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-2 pl-3">
      {onBack && (
        <IconButton label="All widgets" onClick={onBack}>
          <ArrowLeft size={16} />
        </IconButton>
      )}
      <h2 className="min-w-0 flex-1 truncate px-1 text-sm font-semibold" title={title}>
        {title}
      </h2>
      {children}
      <IconButton label="Close" onClick={closeWidgets}>
        <X size={16} />
      </IconButton>
    </div>
  )
}

function hostOf(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function WidgetListPanel({ roomID }: { roomID: RoomID }) {
  const widgets = useRoomWidgets(roomID)
  const saved = useWidgetPermissions(s => s.saved)
  const inCall = useChat(s => activeCallMembers(s, roomID))

  return (
    <>
      <PanelHeader title="Widgets" />
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <button
          type="button"
          onClick={() => openWidget(CALL_WIDGET_ID)}
          className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:bg-hover"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
            <Video size={20} />
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block text-sm font-semibold">Element Call</span>
            <span className="mt-0.5 block text-xs text-muted">
              {inCall > 0 ? `${inCall} ${inCall === 1 ? 'person' : 'people'} in the call` : 'Start or join a video call in this room'}
            </span>
          </span>
          {inCall > 0 && <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-success" />}
        </button>

        <h3 className="mb-1.5 mt-5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">In this room</h3>
        {widgets.length === 0 ? (
          <p className="px-1 py-2 text-sm text-muted">No widgets have been added to this room.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {widgets.map(widget => {
              const key = widgetPermissionKey(roomID, widget)
              return <WidgetRow key={widget.id} widget={widget} hasPermissions={!!saved[key]} onForget={() => forgetWidgetPermissions(key)} />
            })}
          </ul>
        )}
      </div>
    </>
  )
}

function WidgetRow({ widget, hasPermissions, onForget }: { widget: RoomWidget; hasPermissions: boolean; onForget: () => void }) {
  return (
    <li className="group flex items-center gap-1 rounded-lg transition-colors hover:bg-hover">
      <button type="button" onClick={() => openWidget(widget.id)} className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-2 text-muted">
          <LayoutGrid size={16} />
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-medium">{widget.name}</span>
          <span className="block truncate text-xs text-muted" title={widget.url}>
            {hostOf(widget.url)}
            {widget.type ? ` · ${widget.type}` : ''}
          </span>
        </span>
      </button>
      {hasPermissions && (
        <IconButton label="Forget this widget's permissions" onClick={onForget} className="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
          <ShieldOff size={15} />
        </IconButton>
      )}
    </li>
  )
}

export function WidgetPanel({ roomID, widgetID }: { roomID: RoomID; widgetID: string }) {
  const isCall = widgetID === CALL_WIDGET_ID
  const widgets = useRoomWidgets(roomID)
  const callBaseURL = usePreference('element_call_base_url', roomID)
  const roomName = useChat(s => s.rooms[roomID]?.meta.name)
  const encrypted = useChat(s => !!s.rooms[roomID]?.meta.encryption_event)

  const { widget, error } = useMemo((): { widget: RoomWidget | null; error: string | null } => {
    if (!isCall) return { widget: widgets.find(w => w.id === widgetID) ?? null, error: null }
    try {
      return { widget: elementCallWidget(useChat.getState(), roomID, callBaseURL), error: null }
    } catch (err) {
      return { widget: null, error: err instanceof Error ? err.message : String(err) }
    }
    // roomName and encrypted change the call widget's name and E2EE flag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCall, widgets, widgetID, roomID, callBaseURL, roomName, encrypted])

  return (
    <>
      <PanelHeader title={widget?.name ?? (isCall ? 'Element Call' : 'Widget')} onBack={openWidgetList} />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {error ? (
          <Notice>
            {error} Check the Element Call URL in settings, or clear it to use the bundled Element Call.
          </Notice>
        ) : !widget ? (
          <Notice>This widget is no longer in the room.</Notice>
        ) : (
          <Suspense
            fallback={
              <div className="grid h-full place-items-center text-muted">
                <Spinner size={22} />
              </div>
            }
          >
            <WidgetFrame key={`${roomID}|${widget.id}|${widget.url}`} roomID={roomID} widget={widget} trusted={isCall} onClose={closeWidgets} />
          </Suspense>
        )}
      </div>
    </>
  )
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted">
      <TriangleAlert size={24} />
      <p>{children}</p>
    </div>
  )
}
