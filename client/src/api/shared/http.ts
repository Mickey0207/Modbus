export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    let detail = ''
    try {
      const ct = res.headers.get('content-type') || ''
      if (ct.includes('application/json')) {
        const j = await res.json().catch(() => null) as any
        const code = j?.error && typeof j.error === 'object' ? j.error.code : undefined
        const base = j?.message || (typeof j?.error === 'string' ? j.error : '')
        detail = code ? `${base} [${code}]` : base
      } else {
        detail = await res.text().catch(() => '')
      }
    } catch {}
    const msg = detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export const get = <T=any>(path: string) => api<T>(path)
export const post = <T=any>(path: string, body?: any) => api<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) })