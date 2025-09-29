// Simple localStorage-based queue for write operations when host is offline
// Each operation targets a hostId with specific address/value

export type PendingOp = { hostId: string; address: number; value: number; ts: number }
const KEY = 'ms:pendingOps'

function readQueue(): PendingOp[] {
  try { const raw = localStorage.getItem(KEY); if (!raw) return []; const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : [] } catch { return [] }
}
function writeQueue(arr: PendingOp[]) { try { localStorage.setItem(KEY, JSON.stringify(arr)) } catch {} }

export function enqueue(op: PendingOp) { const q = readQueue(); q.push(op); writeQueue(q) }
export function drainHost(hostId: string): PendingOp[] { const q = readQueue(); const pick = q.filter(o => o.hostId === hostId); const rest = q.filter(o => o.hostId !== hostId); writeQueue(rest); return pick }
export function allQueue(): PendingOp[] { return readQueue() }

export async function flush(isHostConnected: (id: string)=>boolean, writer: (id: string, address: number, value: number)=>Promise<boolean>) {
  const q = readQueue()
  if (!q.length) return
  const remain: PendingOp[] = []
  for (const op of q) {
    if (!isHostConnected(op.hostId)) { remain.push(op); continue }
    try {
      const ok = await writer(op.hostId, op.address, op.value)
      if (!ok) remain.push(op)
    } catch { remain.push(op) }
  }
  writeQueue(remain)
}
