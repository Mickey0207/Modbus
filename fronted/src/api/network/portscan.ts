// Stubbed TCP port scan API for frontend-only development

export async function runPortScan(opts: { ip: string; start: number; end: number; timeoutMs?: number; concurrency?: number; }) {
  const t0 = Date.now()
  // Pretend port 502 is open
  const open = [502].filter(p => p >= opts.start && p <= opts.end)
  return { success: true, data: { open, elapsed: Date.now() - t0 } }
}
