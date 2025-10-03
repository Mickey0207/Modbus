// Simple in-memory queue for write operations; frontend stub

type Task = { hostId: string; address: number; value: number }
const queue: Task[] = []

export function enqueue(hostId: string, address: number, value: number) {
  queue.push({ hostId, address, value })
}

// flush: when a host becomes connected, execute callback per task
export async function flush(isConnected: (hostId: string) => boolean, exec: (hostId: string, address: number, value: number) => Promise<boolean>) {
  // process tasks where host is connected
  let i = 0
  while (i < queue.length) {
    const t = queue[i]
    if (isConnected(t.hostId)) {
      try { await exec(t.hostId, t.address, t.value) } catch {}
      queue.splice(i, 1)
    } else {
      i += 1
    }
  }
}
