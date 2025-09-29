async function buildError(method: string, url: string, r: Response) {
  let details = ''
  try {
    const ct = r.headers.get('content-type') || ''
    if (ct.includes('application/json')) {
      const j = await r.json()
      details = (j && typeof j === 'object') ? (j as any).message || JSON.stringify(j) : String(j)
    } else {
      details = await r.text()
    }
  } catch {}
  const suffix = details ? `: ${details}` : ''
  throw new Error(`${method} ${url} ${r.status}${suffix}`)
}

export async function get<T=any>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) await buildError('GET', url, r)
  return r.json()
}

export async function post<T=any>(url: string, body?: any): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  if (!r.ok) await buildError('POST', url, r)
  return r.json()
}

export async function patch<T=any>(url: string, body?: any): Promise<T> {
  const r = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  if (!r.ok) await buildError('PATCH', url, r)
  return r.json()
}

export async function del<T=any>(url: string, body?: any): Promise<T> {
  const r = await fetch(url, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  if (!r.ok) await buildError('DELETE', url, r)
  return r.json()
}
