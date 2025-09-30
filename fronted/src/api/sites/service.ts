// In-memory stub service for Sites/Hosts/Slaves/Versions to unblock frontend UI
// NOTE: This is a temporary stub. Replace with real HTTP calls when backend is ready.

export type DbSlave = {
  id: string
  unitId: number
  name?: string
  type: 'SL-SW8CH' | 'SL-1-10V4CHDIM'
  enabled: boolean
  floor?: string
  room?: string
  note?: string
  swMask?: number
  dimMask?: number
  dimValues?: number[]
}

export type DbHost = {
  id: string
  name?: string
  ip?: string
  port?: number
  unitId?: number
  floor?: string
  room?: string
  note?: string
  slaves: DbSlave[]
}

export type DbSite = {
  id: string
  name: string
  version?: string
  hosts: DbHost[]
}

export type DbSiteVersion = {
  id: string
  version: string
  note?: string
  createdAt: number
}

// In-memory state
const sites: DbSite[] = []
const versions = new Map<string, DbSiteVersion[]>()

function uuid() {
  try { return (globalThis.crypto as any).randomUUID() } catch { return 'id-' + Math.random().toString(36).slice(2) }
}

// Seed one demo site for convenience
(function seed() {
  if (sites.length) return
  const siteId = uuid()
  const hostId = uuid()
  sites.push({ id: siteId, name: '示範案場', version: '1', hosts: [
    { id: hostId, name: '主機1', ip: '192.168.0.100', port: 502, unitId: 1, floor: '1F', room: '機房A', note: '備註', slaves: [
      { id: uuid(), unitId: 1, name: '從機1', type: 'SL-SW8CH', enabled: true, floor: '1F', room: '機房A', note: '', swMask: 0 },
      { id: uuid(), unitId: 2, name: '從機2', type: 'SL-1-10V4CHDIM', enabled: true, floor: '1F', room: '機房A', note: '', dimMask: 0, dimValues: [0,0,0,0] },
    ] }
  ] })
  versions.set(siteId, [{ id: uuid(), version: '1', createdAt: Date.now() }])
})()

export async function listSites(): Promise<DbSite[]> {
  // 隱藏任何特殊用途的臨時站點（例如 __status__）
  return JSON.parse(JSON.stringify(sites.filter(s => s.id !== '__status__')))
}

export async function createSite(name: string) {
  const s: DbSite = { id: uuid(), name, version: '1', hosts: [] }
  sites.push(s)
  versions.set(s.id, [{ id: uuid(), version: '1', createdAt: Date.now() }])
  return s
}

export async function deleteSite(id: string) {
  const idx = sites.findIndex(s => s.id === id)
  if (idx >= 0) sites.splice(idx, 1)
  versions.delete(id)
  return { success: true }
}

export async function patchSite(id: string, patch: Partial<DbSite>) {
  const s = sites.find(x => x.id === id); if (!s) return { success: false }
  Object.assign(s, patch)
  return { success: true }
}

export async function addHost(siteId: string, body: Omit<DbHost, 'id' | 'slaves'> & { slaves?: DbSlave[] }) {
  const s = sites.find(x => x.id === siteId); if (!s) throw new Error('site not found')
  const h: DbHost = { id: uuid(), ...body, slaves: body.slaves ?? [] }
  s.hosts.push(h)
  return { id: h.id }
}

export async function deleteHost(siteId: string, hostId: string) {
  const s = sites.find(x => x.id === siteId); if (!s) throw new Error('site not found')
  s.hosts = s.hosts.filter(h => h.id !== hostId)
  return { success: true }
}

export async function patchHost(siteId: string, hostId: string, patch: Partial<DbHost>) {
  const s = sites.find(x => x.id === siteId); if (!s) throw new Error('site not found')
  const h = s.hosts.find(x => x.id === hostId); if (!h) throw new Error('host not found')
  Object.assign(h, patch)
  return { success: true }
}

export async function patchHostById(hostId: string, patch: Partial<DbHost>) {
  for (const s of sites) {
    const h = s.hosts.find(x => x.id === hostId)
    if (h) { Object.assign(h, patch); return { success: true } }
  }
  throw new Error('host not found')
}

export async function addSlave(hostId: string, body: Omit<DbSlave, 'id'>) {
  const h = sites.flatMap(s => s.hosts).find(x => x.id === hostId)
  if (!h) throw new Error('host not found')
  const exists = h.slaves.some(s => s.unitId === body.unitId)
  if (exists) throw new Error('duplicate unitId')
  const sl: DbSlave = { id: uuid(), ...body }
  h.slaves.push(sl)
  return { id: sl.id }
}

export async function deleteSlave(hostId: string, slaveId: string) {
  const h = sites.flatMap(s => s.hosts).find(x => x.id === hostId); if (!h) throw new Error('host not found')
  h.slaves = h.slaves.filter(x => x.id !== slaveId)
  return { success: true }
}

export async function patchSlave(hostId: string, slaveId: string, patch: Partial<DbSlave>) {
  const h = sites.flatMap(s => s.hosts).find(x => x.id === hostId); if (!h) throw new Error('host not found')
  const sl = h.slaves.find(x => x.id === slaveId); if (!sl) throw new Error('slave not found')
  Object.assign(sl, patch)
  return { success: true }
}

export async function patchSlaveByUnit(hostId: string, unitId: number, patch: Partial<DbSlave>) {
  const h = sites.flatMap(s => s.hosts).find(x => x.id === hostId); if (!h) throw new Error('host not found')
  const sl = h.slaves.find(x => x.unitId === unitId); if (!sl) throw new Error('slave not found')
  Object.assign(sl, patch)
  return { success: true }
}

export async function listSlavesByHostId(hostId: string): Promise<DbSlave[]> {
  const h = sites.flatMap(s => s.hosts).find(x => x.id === hostId); if (!h) return []
  return JSON.parse(JSON.stringify(h.slaves || []))
}

export async function deleteSlaveByUnit(hostId: string, unitId: number) {
  const h = sites.flatMap(s => s.hosts).find(x => x.id === hostId); if (!h) throw new Error('host not found')
  const idx = h.slaves.findIndex(x => x.unitId === unitId)
  if (idx >= 0) { h.slaves.splice(idx, 1); return { success: true } }
  throw new Error('slave not found')
}

export async function listVersionsPaged(siteId: string, opts: { limit: number; offset: number; sort?: 'created_at'|'version'|'created'|'version'; order?: 'ASC'|'DESC' }) {
  const arr = versions.get(siteId) || []
  let rows = [...arr]
  const sortKey = (opts.sort === 'version' ? 'version' : 'createdAt') as 'version' | 'createdAt'
  rows.sort((a, b) => (opts.order === 'ASC' ? 1 : -1) * ((a as any)[sortKey] > (b as any)[sortKey] ? 1 : -1))
  const total = rows.length
  rows = rows.slice(opts.offset, opts.offset + opts.limit)
  return { data: rows, total }
}

export async function createVersion(siteId: string, autoIncrement = true) {
  const arr = versions.get(siteId) || []
  let next = '1'
  if (autoIncrement && arr.length) {
    const nums = arr.map(v => Number(v.version)).filter(n => Number.isFinite(n))
    next = String((nums.length ? Math.max(...nums) : 0) + 1)
  }
  const v: DbSiteVersion = { id: uuid(), version: next, createdAt: Date.now() }
  arr.unshift(v)
  versions.set(siteId, arr)
  return v
}

export async function applyVersion(siteId: string, versionId: string, overwriteCurrent = true) {
  const s = sites.find(x => x.id === siteId); if (!s) throw new Error('site not found')
  const v = (versions.get(siteId) || []).find(x => x.id === versionId); if (!v) throw new Error('version not found')
  if (overwriteCurrent) s.version = v.version
  return { success: true }
}

export async function exportVersion(siteId: string, _versionId: string) {
  return { hosts: JSON.parse(JSON.stringify(sites.find(s => s.id === siteId)?.hosts || [])) }
}

export async function importVersion(_siteId: string, _versionId: string, _payload: any, _apply = true, _prune = true) {
  return { success: true }
}

export async function deleteVersion(siteId: string, versionId: string) {
  const arr = versions.get(siteId) || []
  const idx = arr.findIndex(v => v.id === versionId)
  if (idx >= 0) arr.splice(idx, 1)
  versions.set(siteId, arr)
  return { success: true }
}

export async function overwriteVersion(_siteId: string, _versionId: string) {
  return { success: true }
}

export async function patchVersion(siteId: string, versionId: string, patch: Partial<DbSiteVersion>) {
  const arr = versions.get(siteId) || []
  const v = arr.find(x => x.id === versionId); if (!v) throw new Error('version not found')
  Object.assign(v, patch)
  versions.set(siteId, arr)
  return { success: true }
}
