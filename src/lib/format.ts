const DAY = 86_400_000

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const shortDateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'medium' })

export const formatTime = (ts: number) => timeFormat.format(ts)
export const formatFull = (ts: number) => fullFormat.format(ts)

export function isSameDay(a: number, b: number) {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

export function formatRoomTime(ts: number) {
  if (!ts) return ''
  const now = Date.now()
  if (isSameDay(ts, now)) return formatTime(ts)
  if (now - ts < 6 * DAY) return weekdayFormat.format(ts)
  return shortDateFormat.format(ts)
}

export function formatDay(ts: number) {
  const now = Date.now()
  if (isSameDay(ts, now)) return 'Today'
  if (isSameDay(ts, now - DAY)) return 'Yesterday'
  return dayFormat.format(ts)
}

export function formatBytes(bytes?: number) {
  if (bytes === undefined) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit && value < 10 ? 1 : 0)} ${units[unit]}`
}

export function formatNames(names: string[]) {
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} others`
}
