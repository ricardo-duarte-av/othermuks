// othermuks push service worker, based on gomuks web's pushmuks-sw.js.
// gomuks sends web push payloads shaped like
//   { messages: [{ room_id, room_name, room_avatar?, event_id, sender: { id, name, avatar? }, text, image?,
//                  timestamp, sound? }], dismiss: [{ room_id }], image_auth }
// where avatar and image are paths relative to the gomuks backend ("_gomuks/media/…"). The backend URL
// comes from the ?backend= query this worker was registered with (absent means the same origin).
const params = new URL(self.location.href).searchParams
const backend = (params.get('backend') || self.location.origin).replace(/\/+$/, '')
// The app lives in the directory this worker is served from.
const appURL = new URL('./', self.location.href).href

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

function mediaURL(path, imageAuth) {
  if (!path) return undefined
  const url = new URL(path, `${backend}/`)
  if (imageAuth) url.searchParams.set('image_auth', imageAuth)
  return url.href
}

self.addEventListener('push', event => {
  let data
  try {
    data = event.data?.json()
  } catch {
    return
  }
  if (!data) return
  event.waitUntil(
    (async () => {
      // Rooms read elsewhere: close their notifications.
      const dismissed = new Set((data.dismiss ?? []).map(dismiss => dismiss.room_id))
      if (dismissed.size) {
        for (const notification of await self.registration.getNotifications()) {
          if (dismissed.has(notification.data?.roomID)) notification.close()
        }
      }
      if (self.Notification?.permission !== 'granted') return
      await Promise.all(
        (data.messages ?? []).map(message => {
          const sender = message.sender?.name || message.sender?.id || 'Someone'
          const title = !message.room_name || message.room_name === sender ? sender : `${sender} (${message.room_name})`
          return self.registration.showNotification(title, {
            body: message.text,
            timestamp: message.timestamp,
            silent: !message.sound,
            tag: message.event_id,
            icon: mediaURL(message.sender?.avatar || message.room_avatar, data.image_auth),
            image: mediaURL(message.image, data.image_auth),
            data: { roomID: message.room_id, eventID: message.event_id },
          })
        }),
      )
    })(),
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const { roomID, eventID } = event.notification.data ?? {}
  event.waitUntil(
    (async () => {
      // The worker's scope doesn't cover the app's pages, so look at uncontrolled windows too.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const app = windows.find(client => client.url.startsWith(appURL))
      if (app) {
        try {
          await app.focus()
        } catch {
          // Focusing can be refused; the room still opens in that window.
        }
        app.postMessage({ type: 'othermuks-open-room', roomID, eventID })
        return
      }
      const url = new URL(appURL)
      if (roomID) url.searchParams.set('open_room', roomID)
      if (eventID) url.searchParams.set('open_event', eventID)
      await self.clients.openWindow(url.href)
    })(),
  )
})
