/** Incremental text/event-stream parser: feed decoded text chunks, get each event's data field. */
export function createSSEParser(onData: (data: string) => void) {
  let buffer = ''
  return (chunk: string) => {
    buffer += chunk.replaceAll('\r', '')
    let end: number
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      const data = block
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(line.startsWith('data: ') ? 6 : 5))
        .join('\n')
      if (data) onData(data)
    }
  }
}
