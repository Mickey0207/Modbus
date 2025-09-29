// Lightweight localStorage-backed store for Phase 1 (no DB)
export type SlaveType = 'SL-SW8CH' | 'SL-1-10V4CHDIM' | null
export type Slave = {
  unitId: number
  name: string
  floor?: string
  room?: string
  note?: string
  type?: SlaveType
  enabled?: boolean | null
  // Desired states
  swMask?: number // 8-bit for SW8CH
  dimMask?: number // 4-bit for DIM on/off
  dimValues?: number[] // length 4 for DIM brightness 0..255
}
export type Host = {
  id: string
  name: string
  ip?: string
  port?: number
  unitId?: number
  floor?: string
  room?: string
  note?: string
  slaves: Slave[]
}
export type Site = {
  id: string
  name: string
  description?: string
  version: string
  updatedAt: number
  hosts: Host[]
  versions?: SiteVersion[]
}

const KEY = 'ms:sites'

function rid() {
  // simple random id
  return Math.random().toString(36).slice(2, 10)
}

export function loadSites(): Site[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) {
      // 兼容舊資料：補上 version 欄位
      return arr.map((s: any) => ({ version: '0.0.1', versions: [], ...s }))
    }
  } catch {}
  return []
}

export function saveSites(sites: Site[]) {
  localStorage.setItem(KEY, JSON.stringify(sites))
  try { window.dispatchEvent(new CustomEvent('sites-changed')) } catch {}
}

export function createSite(name: string): Site {
  const now = Date.now()
  return { id: rid(), name: name || '未命名案場', description: '', version: '0.0.1', updatedAt: now, hosts: [], versions: [] }
}

export function touch(site: Site) {
  site.updatedAt = Date.now()
}

export function bumpVersion(site: Site) {
  // 固定三段十進位：a.b.c，每段 0-9，c 過 9 進位到 b，b 過 9 進位到 a
  const parts = String(site.version || '0.0.1').split('.').map(n=>parseInt(n,10)).slice(0,3)
  while (parts.length < 3) parts.push(0)
  parts[2] += 1
  if (parts[2] > 9) { parts[2] = 0; parts[1] += 1 }
  if (parts[1] > 9) { parts[1] = 0; parts[0] += 1 }
  site.version = parts.join('.')
  touch(site)
}

// ===== 版本與快照（Phase 1：localStorage） =====
export type SiteSnapshot = {
  name: string
  description?: string
  hosts: Array<{
    name: string
    ip?: string
    port?: number
    unitId?: number
    floor?: string
    room?: string
    note?: string
    sort?: number
    slaves: Array<{
      name: string
      unitId: number
      type?: SlaveType
      enabled?: boolean | null
      swMask?: number
      dimMask?: number
      dimValues?: number[]
      floor?: string
      room?: string
      note?: string
      sort?: number
    }>
  }>
}

export type SiteVersion = {
  id: string
  version: string
  createdAt: number
  updatedAt: number
  payload: SiteSnapshot
}

function nextVersionStr(base: string): string {
  const parts = String(base || '0.0.0').split('.').map(n=>parseInt(n,10)).slice(0,3)
  while (parts.length < 3) parts.push(0)
  parts[2] += 1
  if (parts[2] > 9) { parts[2] = 0; parts[1] += 1 }
  if (parts[1] > 9) { parts[1] = 0; parts[0] += 1 }
  return parts.join('.')
}

export function extractSnapshot(site: Site): SiteSnapshot {
  const hosts = (site.hosts || []).map((h, idx) => ({
    name: h.name,
    ip: h.ip,
    port: h.port,
    unitId: h.unitId,
    floor: h.floor,
    room: h.room,
    note: h.note,
    sort: idx,
    slaves: (h.slaves || []).map((sl, j) => ({
      name: sl.name,
      unitId: sl.unitId,
      type: sl.type,
      enabled: sl.enabled ?? true,
      swMask: sl.swMask ?? 0,
      dimMask: sl.dimMask ?? 0,
      dimValues: (sl.dimValues && sl.dimValues.length ? sl.dimValues : [0,0,0,0]),
      floor: sl.floor,
      room: sl.room,
      note: sl.note,
      sort: j,
    }))
  }))
  return { name: site.name, description: site.description, hosts }
}

export function applySnapshotToSite(site: Site, snap: SiteSnapshot, opts?: { prune?: boolean }) {
  const prune = !!opts?.prune
  site.name = snap.name || site.name
  site.description = snap.description || ''

  // 主機以名稱對應
  const byName = new Map(site.hosts.map(h=>[h.name, h]))
  const nextHosts: Host[] = []
  for (const [idx, h] of (snap.hosts || []).entries()) {
    const exist = byName.get(h.name)
    if (exist) {
      exist.ip = h.ip
      exist.port = h.port
      exist.unitId = h.unitId
      // 同步樓層/機房/備註（若快照未提供則保留原值）
      exist.floor = (h.floor !== undefined ? h.floor : exist.floor)
      exist.room = (h.room !== undefined ? h.room : exist.room)
      exist.note = (h.note !== undefined ? h.note : exist.note)
      // slaves by name
      const slByName = new Map(exist.slaves.map(sl=>[sl.name, sl]))
      const nextSlaves: Slave[] = []
      for (const [j, sl] of (h.slaves || []).entries()) {
        const existSl = slByName.get(sl.name)
        if (existSl) {
          existSl.unitId = sl.unitId
          existSl.type = sl.type
          existSl.enabled = sl.enabled ?? true
          existSl.swMask = sl.swMask ?? (existSl.swMask ?? 0)
          existSl.dimMask = sl.dimMask ?? (existSl.dimMask ?? 0)
          existSl.dimValues = (Array.isArray(sl.dimValues) && sl.dimValues.length ? sl.dimValues.slice(0,4) : (existSl.dimValues || [0,0,0,0]))
          // 同步樓層/機房/備註（若快照未提供則保留原值）
          existSl.floor = (sl.floor !== undefined ? sl.floor : existSl.floor)
          existSl.room = (sl.room !== undefined ? sl.room : existSl.room)
          existSl.note = (sl.note !== undefined ? sl.note : existSl.note)
          nextSlaves.push(existSl)
        } else {
          nextSlaves.push({ unitId: sl.unitId, name: sl.name, type: sl.type, enabled: sl.enabled ?? true, swMask: sl.swMask ?? 0, dimMask: sl.dimMask ?? 0, dimValues: (Array.isArray(sl.dimValues) && sl.dimValues.length ? sl.dimValues.slice(0,4) : [0,0,0,0]), floor: sl.floor, room: sl.room, note: sl.note })
        }
      }
      if (!prune) {
        // append leftovers
        for (const sl of exist.slaves) {
          if (!nextSlaves.includes(sl)) nextSlaves.push(sl)
        }
      }
      exist.slaves = nextSlaves
      nextHosts.push(exist)
    } else {
      nextHosts.push({ id: rid(), name: h.name, ip: h.ip, port: h.port, unitId: h.unitId, floor: h.floor, room: h.room, note: h.note, slaves: (h.slaves||[]).map(sl=>({ unitId: sl.unitId, name: sl.name, type: sl.type, enabled: sl.enabled ?? true, swMask: sl.swMask ?? 0, dimMask: sl.dimMask ?? 0, dimValues: (Array.isArray(sl.dimValues) && sl.dimValues.length ? sl.dimValues.slice(0,4) : [0,0,0,0]), floor: sl.floor, room: sl.room, note: sl.note })) })
    }
  }
  if (!prune) {
    for (const h of site.hosts) { if (!nextHosts.includes(h)) nextHosts.push(h) }
  }
  site.hosts = nextHosts
  touch(site)
}

export function addVersion(site: Site, payloadFromCurrent = true): SiteVersion {
  const list = site.versions || (site.versions = [])
  const highest = list.length ? list.map(v=>v.version).sort((a,b)=>a.localeCompare(b, undefined, {numeric:true})).pop()! : site.version || '0.0.0'
  const vstr = nextVersionStr(highest)
  const now = Date.now()
  const payload = payloadFromCurrent ? extractSnapshot(site) : { name: site.name, description: site.description, hosts: [] }
  const ver: SiteVersion = { id: rid(), version: vstr, createdAt: now, updatedAt: now, payload }
  list.push(ver)
  return ver
}

export function overwriteVersion(site: Site, versionId: string) {
  const list = site.versions || (site.versions = [])
  const v = list.find(x=>x.id===versionId)
  if (!v) return
  v.payload = extractSnapshot(site)
  v.updatedAt = Date.now()
}

export function deleteVersion(site: Site, versionId: string) {
  const list = site.versions || (site.versions = [])
  const idx = list.findIndex(x=>x.id===versionId)
  if (idx >= 0) list.splice(idx, 1)
}

export function findVersion(site: Site, versionId: string) {
  return (site.versions || []).find(v=>v.id===versionId) || null
}

function ArrayList(a:any): a is any[] { return Array.isArray(a) }
