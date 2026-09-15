// Hosts a widget iframe and its widget API connection (based on gomuks web's widget.tsx). Widgets live
// outside React so a call that asked to stay on screen survives its panel closing or a room switch:
// it moves into a floating window (needs Element.moveBefore, which keeps the iframe from reloading).
import { ClientWidgetApi, Widget, type IWidget } from 'matrix-widget-api'
import { useCallback, useRef } from 'react'
import type { RoomID } from '@/api/types'
import { selectOwnUserID, useChat } from '@/store/chat'
import { displayNameOf } from '@/store/events'
import { openRoom, openWidget, useUI } from '@/store/ui'
import { addWidgetListener, approveWidgetCapabilities, widgetPermissionKey, type RoomWidget } from '@/store/widgets'
import { OthermuksWidgetDriver, toIRoomEvent } from './driver'
import './widgets.css'

export interface WidgetFrameProps {
  roomID: RoomID
  widget: RoomWidget
  /** Trusted widgets (Element Call) get every capability they ask for without a prompt. */
  trusted?: boolean
  onClose?: () => void
}

interface LiveWidget {
  mount(into: HTMLElement, onClose: () => void): void
  unmount(from: HTMLElement): void
}

/** matrix-widget-api doesn't export this type from its entry point. */
type IToDeviceMessage = Parameters<ClientWidgetApi['feedToDevice']>[0]

type Movable = HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void }
const canMoveWithoutReload = () => typeof (HTMLElement.prototype as Movable).moveBefore === 'function'

const liveWidgets = new Map<string, LiveWidget>()

function popoutButton(label: string, glyph: string, onClick: () => void) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'widget-popout-button'
  button.title = label
  button.setAttribute('aria-label', label)
  button.textContent = glyph
  button.addEventListener('pointerdown', e => e.stopPropagation())
  button.addEventListener('click', onClick)
  return button
}

/** A draggable, resizable floating window for a widget that asked to stay on screen. */
function makePopout(title: string, onReturn: () => void, onClose: () => void): Movable {
  const container = document.createElement('div') as Movable
  container.className = 'widget-popout'
  container.setAttribute('role', 'dialog')
  container.setAttribute('aria-label', title)
  const header = document.createElement('div')
  header.className = 'widget-popout-header'
  const name = document.createElement('span')
  name.className = 'widget-popout-title'
  name.textContent = title
  header.append(name, popoutButton('Back to the room', '↩', onReturn), popoutButton('Close', '✕', onClose))
  container.append(header)
  document.body.append(container)

  header.addEventListener('pointerdown', evt => {
    if (!evt.isPrimary || (evt.pointerType === 'mouse' && evt.button !== 0)) return
    const rect = container.getBoundingClientRect()
    const offsetX = evt.clientX - rect.left
    const offsetY = evt.clientY - rect.top
    const move = (e: PointerEvent) => {
      const x = Math.min(Math.max(e.clientX - offsetX, -rect.width / 2), window.innerWidth - rect.width / 2)
      const y = Math.min(Math.max(e.clientY - offsetY, 0), window.innerHeight - 40)
      container.style.left = `${x}px`
      container.style.top = `${y}px`
      container.style.right = 'auto'
    }
    const end = () => {
      header.removeEventListener('pointermove', move)
      header.removeEventListener('pointerup', end)
      header.removeEventListener('pointercancel', end)
      document.body.removeAttribute('data-resizing')
    }
    header.setPointerCapture(evt.pointerId)
    // Keeps the iframe from swallowing pointer events mid-drag.
    document.body.setAttribute('data-resizing', '')
    header.addEventListener('pointermove', move)
    header.addEventListener('pointerup', end)
    header.addEventListener('pointercancel', end)
  })
  return container
}

function liveWidget(roomID: RoomID, widget: RoomWidget, trusted: boolean): LiveWidget {
  const fullID = `${roomID}|${widget.id}|${widget.url}`
  const existing = liveWidgets.get(fullID)
  if (existing) return existing

  const chat = useChat.getState()
  const ownUserID = selectOwnUserID(chat) ?? ''
  const clientState = chat.clientState
  const memberRowID = chat.rooms[roomID]?.state['m.room.member']?.[ownUserID]
  const definition: IWidget = {
    id: widget.id,
    creatorUserId: widget.creatorUserId,
    type: widget.type ?? 'm.custom',
    name: widget.name,
    url: widget.url,
    data: widget.data,
    waitForIframeLoad: !trusted,
  }
  const wrapped = new Widget(definition)
  const url = new URL(
    wrapped.getCompleteUrl({
      widgetRoomId: roomID,
      currentUserId: ownUserID,
      deviceId: clientState?.is_logged_in ? clientState.device_id : '',
      userDisplayName: displayNameOf(ownUserID, memberRowID === undefined ? undefined : chat.events[memberRowID]?.content),
      clientId: 'app.othermuks',
      clientTheme: useUI.getState().theme === 'daylight' ? 'light' : 'dark',
      clientLanguage: navigator.language,
      baseUrl: clientState?.is_logged_in ? clientState.homeserver_url : undefined,
    }),
  )
  // Legacy parameters some widgets still read.
  url.searchParams.set('parentUrl', location.href)
  url.searchParams.set('widgetId', widget.id)

  const iframe = document.createElement('iframe')
  iframe.src = url.href
  iframe.title = widget.name
  iframe.allow = 'microphone; camera; fullscreen; encrypted-media; display-capture; screen-wake-lock; autoplay; clipboard-write'

  const permissionKey = widgetPermissionKey(roomID, widget)
  const driver = new OthermuksWidgetDriver(roomID, requested =>
    trusted ? Promise.resolve(requested) : approveWidgetCapabilities(permissionKey, widget.name, widget.url, requested),
  )

  let api: ClientWidgetApi | null = null
  let removeListener: (() => void) | null = null
  let deleted = false
  let alwaysOnScreen = false
  let popout: Movable | null = null
  let onClose: (() => void) | null = null

  const destroy = () => {
    if (deleted) return
    deleted = true
    liveWidgets.delete(fullID)
    removeListener?.()
    api?.stop()
    api?.removeAllListeners()
    iframe.remove()
    popout?.remove()
    popout = null
  }

  const setup = () => {
    const clientApi = new ClientWidgetApi(wrapped, iframe, driver)
    api = clientApi
    clientApi.setViewedRoomId(roomID)
    removeListener = addWidgetListener({
      roomID,
      onEvent: evt => void clientApi.feedEvent(toIRoomEvent(evt)).catch(err => console.debug('widget feedEvent failed', err)),
      onState: evt => void clientApi.feedStateUpdate(toIRoomEvent(evt)).catch(err => console.debug('widget feedStateUpdate failed', err)),
      onToDevice: message =>
        void clientApi
          .feedToDevice({ sender: message.sender, type: message.type, content: message.content } as IToDeviceMessage, message.encrypted)
          .catch(err => console.debug('widget feedToDevice failed', err)),
    })
    // Element Call asks for these; there's nothing for the client to do but acknowledge them.
    const acknowledge = (evt: CustomEvent) => {
      evt.preventDefault()
      clientApi.transport.reply(evt.detail, {})
    }
    for (const action of ['io.element.join', 'im.vector.hangup', 'io.element.device_mute', 'io.element.tile_layout', 'io.element.spotlight_layout']) {
      clientApi.on(`action:${action}`, acknowledge)
    }
    clientApi.on('action:io.element.close', (evt: CustomEvent) => {
      acknowledge(evt)
      onClose?.()
      destroy()
    })
    clientApi.on('action:set_always_on_screen', (evt: CustomEvent) => {
      alwaysOnScreen = !!(evt.detail as { data?: { value?: unknown } }).data?.value
      acknowledge(evt)
    })
  }

  const live: LiveWidget = {
    mount(into, close) {
      if (deleted) return
      onClose = close
      const target = into as Movable
      if (iframe.parentElement && target.moveBefore) target.moveBefore(iframe, null)
      else into.append(iframe)
      if (!api) setup()
      popout?.remove()
      popout = null
    },
    unmount(from) {
      if (deleted || iframe.parentElement !== from) return
      if (!alwaysOnScreen || !canMoveWithoutReload()) {
        destroy()
        return
      }
      popout = makePopout(
        widget.name,
        () => {
          openRoom(roomID)
          openWidget(widget.id)
        },
        destroy,
      )
      popout.moveBefore!(iframe, null)
    },
  }
  liveWidgets.set(fullID, live)
  return live
}

export default function WidgetFrame({ roomID, widget, trusted = false, onClose }: WidgetFrameProps) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const widgetRef = useRef(widget)
  widgetRef.current = widget

  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return
      const live = liveWidget(roomID, widgetRef.current, trusted)
      live.mount(element, () => onCloseRef.current?.())
      return () => live.unmount(element)
    },
    // Remount only when the widget itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roomID, widget.id, widget.url, trusted],
  )

  return <div ref={attach} className="widget-container h-full w-full" />
}
