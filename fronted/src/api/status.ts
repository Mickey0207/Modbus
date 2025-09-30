import type { DbSlave } from '@/api/sites/service'
import { patchSlaveByUnit, listSlavesByHostId } from '@/api/sites/service'

export async function pollStatuses() {
  return { success: true, data: { events: [] as any[] } }
}

export async function listSlavesByHost(hostId: string): Promise<DbSlave[]> {
  return listSlavesByHostId(hostId)
}

export async function scanAllSlaves() {
  return { success: true }
}

export async function setSlaveEnabled(hostId: string, unitId: number, enabled: boolean) {
  await patchSlaveByUnit(hostId, unitId, { enabled })
  return { success: true }
}

export async function setSlaveType(hostId: string, unitId: number, type: DbSlave['type']) {
  await patchSlaveByUnit(hostId, unitId, { type })
  return { success: true }
}
