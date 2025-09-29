import { get, post, patch, del } from '@/api/shared/http'

// Types mirrored from server shapes (minimal subset)
export type DbSlave = {
  id: string
  name: string
  unitId: number
  enabled?: boolean
  type?: 'SL-SW8CH' | 'SL-1-10V4CHDIM' | null
  swMask?: number
  dimMask?: number
  dimValues?: number[]
  floor?: string
  room?: string
  note?: string
  sort?: number
}

export type DbHost = {
  id: string
  name: string
  enabled?: number | boolean
  type?: string | null
  ip?: string | null
  port?: number | null
  unitId?: number | null
  serialPath?: string | null
  baudRate?: number | null
  dataBits?: number | null
  parity?: string | null
  stopBits?: number | null
  floor?: string | null
  room?: string | null
  note?: string | null
  sort?: number | null
  slaves?: DbSlave[]
}

export type DbSite = {
  id: string
  name: string
  description?: string
  createdAt: number
  updatedAt: number
  // latest version string from server aggregation (optional)
  version?: string
  hosts: DbHost[]
  versions?: DbSiteVersion[]
}

export type DbSiteVersion = {
  id: string
  siteId?: string
  major?: number
  minor?: number
  patch?: number
  version: string
  note?: string | null
  createdAt: number
  updatedAt: number
}

export async function listSites() {
  return get<{ success: boolean; data: DbSite[] }>(`/api/sites`).then(r=>r.data)
}

export async function createSite(name: string, description = '') {
  return post<{ success: boolean; data: { id: string; name: string; description: string; createdAt: number; updatedAt: number } }>(`/api/sites`, { name, description }).then(r=>r.data)
}

export async function patchSite(siteId: string, patchBody: Partial<Pick<DbSite, 'name'|'description'>>) {
  return patch<{ success: boolean }>(`/api/sites/${encodeURIComponent(siteId)}`, patchBody)
}

export async function deleteSite(siteId: string) {
  return del<{ success: boolean }>(`/api/sites/${encodeURIComponent(siteId)}`)
}

export async function listHosts(siteId: string) {
  return get<{ success: boolean; data: DbHost[] }>(`/api/sites/${encodeURIComponent(siteId)}/hosts`).then(r=>r.data)
}

export async function addHost(siteId: string, body: Partial<DbHost> & { name: string }) {
  return post<{ success: boolean; data: { id: string } }>(`/api/sites/${encodeURIComponent(siteId)}/hosts`, body).then(r=>r.data)
}

export async function patchHost(siteId: string, hostId: string, body: Partial<DbHost>) {
  return patch<{ success: boolean }>(`/api/sites/${encodeURIComponent(siteId)}/hosts/${encodeURIComponent(hostId)}`, body)
}

export async function deleteHost(siteId: string, hostId: string) {
  return del<{ success: boolean }>(`/api/sites/${encodeURIComponent(siteId)}/hosts/${encodeURIComponent(hostId)}`)
}

export async function listSlaves(hostId: string) {
  return get<{ success: boolean; data: DbSlave[] }>(`/api/sites/by-host/${encodeURIComponent(hostId)}/slaves`).then(r=>r.data)
}

export async function addSlave(hostId: string, body: Partial<DbSlave> & { name: string }) {
  return post<{ success: boolean; data: { id: string } }>(`/api/sites/by-host/${encodeURIComponent(hostId)}/slaves`, body).then(r=>r.data)
}

export async function patchSlave(hostId: string, slaveId: string, body: Partial<DbSlave>) {
  return patch<{ success: boolean }>(`/api/sites/by-host/${encodeURIComponent(hostId)}/slaves/${encodeURIComponent(slaveId)}`, body)
}

export async function deleteSlave(hostId: string, slaveId: string) {
  return del<{ success: boolean }>(`/api/sites/by-host/${encodeURIComponent(hostId)}/slaves/${encodeURIComponent(slaveId)}`)
}

export async function listVersions(siteId: string) {
  return get<{ success: boolean; data: DbSiteVersion[] }>(`/api/sites/${encodeURIComponent(siteId)}/versions`).then(r=>r.data)
}

export async function createVersion(siteId: string, fromCurrent = true) {
  try {
    return await post<{ success: boolean; data: { id: string; version: string; createdAt: number; updatedAt: number } }>(`/api/sites/${encodeURIComponent(siteId)}/versions`)
      .then(r=>r.data)
  } catch (e:any) {
    throw e
  }
}

export async function overwriteVersion(siteId: string, versionId: string) {
  return post<{ success: boolean }>(`/api/sites/${encodeURIComponent(siteId)}/versions/${encodeURIComponent(versionId)}/overwrite`)
}

export async function patchVersion(siteId: string, versionId: string, body: { note?: string | null }) {
  return patch<{ success: boolean }>(`/api/sites/${encodeURIComponent(siteId)}/versions/${encodeURIComponent(versionId)}`, body)
}

// 分頁版本列表（新）
export type VersionsPaged = {
  success: boolean
  data: DbSiteVersion[]
  total: number
  limit?: number
  offset?: number
  sort?: string
  order?: 'ASC'|'DESC'
}

export async function listVersionsPaged(siteId: string, opts?: { limit?: number; offset?: number; sort?: 'created_at'|'updated_at'|'version'; order?: 'ASC'|'DESC' }) {
  const params = new URLSearchParams()
  params.set('paged', '1')
  if (opts?.limit != null) params.set('limit', String(opts.limit))
  if (opts?.offset != null) params.set('offset', String(opts.offset))
  if (opts?.sort) params.set('sort', String(opts.sort))
  if (opts?.order) params.set('order', String(opts.order))
  const url = `/api/sites/${encodeURIComponent(siteId)}/versions?` + params.toString()
  return get<VersionsPaged>(url)
}

// 取得最新一筆版本（新）
export async function getLatestVersion(siteId: string) {
  return get<{ success: boolean; data: DbSiteVersion | null }>(`/api/sites/${encodeURIComponent(siteId)}/versions/latest`).then(r=>r.data)
}

export async function exportVersion(siteId: string, versionId: string) {
  return get<{ success: boolean; data: any }>(`/api/sites/${encodeURIComponent(siteId)}/versions/${encodeURIComponent(versionId)}/export`).then(r=>r.data)
}

export async function importVersion(siteId: string, versionId: string, payload: any, applyToCurrent = true, prune = true) {
  return post<{ success: boolean }>(`/api/sites/${encodeURIComponent(siteId)}/versions/${encodeURIComponent(versionId)}/import`, { payload, applyToCurrent, prune })
}

export async function deleteVersion(siteId: string, versionId: string) {
  return del<{ success: boolean }>(`/api/sites/${encodeURIComponent(siteId)}/versions/${encodeURIComponent(versionId)}`)
}

// 套用指定版本到現用配置（由前端串 export -> import 完成）
export async function applyVersion(siteId: string, versionId: string, prune = true) {
  const payload = await exportVersion(siteId, versionId)
  await importVersion(siteId, versionId, payload, true, prune)
}

// New: patch host by hostId (no siteId required)
export async function patchHostById(hostId: string, body: Partial<DbHost>) {
  return patch<{ success: boolean }>(`/api/sites/by-host/${encodeURIComponent(hostId)}`, body)
}

// New: patch slave by (hostId + unitId) to edit name or unitId directly
export async function patchSlaveByUnit(hostId: string, unitId: number, body: Partial<DbSlave> & { unitId?: number }) {
  return patch<{ success: boolean }>(`/api/sites/by-host/${encodeURIComponent(hostId)}/slaves/by-unit/${unitId}`, body)
}
