export type HostConfig = {
  id: string;
  ip?: string;
  port?: number;
  unitId?: number;
  name?: string;
  floor?: string;
  room?: string;
  note?: string;
}

// In-memory stub registry
const hosts = new Map<string, HostConfig>()

export async function upsertHost(h: HostConfig) {
  hosts.set(h.id, { ...hosts.get(h.id), ...h })
  return { success: true }
}

export async function deleteHost(id: string) {
  hosts.delete(id)
  return { success: true }
}

export function __getHosts(): HostConfig[] {
  return Array.from(hosts.values())
}
