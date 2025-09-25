export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export const get = <T=any>(path: string) => api<T>(path)
export const post = <T=any>(path: string, body?: any) => api<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) })
