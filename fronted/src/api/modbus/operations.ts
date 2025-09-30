// Stubbed Modbus operations for frontend UI

// Connection options: allow simple TCP by hostId or RTU with serial params
export type TcpConn = { transport?: 'tcp'; hostId: string; unitId?: number }
export type RtuConn = { transport: 'rtu'; unitId: number; serial: { path: string; baudRate: number; dataBits: number; stopBits: number; parity: 'none'|'even'|'odd' } }
export type Conn = string | TcpConn | RtuConn

function isRtu(conn: Conn): conn is RtuConn {
  return typeof conn === 'object' && !!conn && (conn as any).transport === 'rtu'
}

// READ 0x03
export async function readHoldingRegisters(conn: Conn, _address: number, quantity: number) {
  // In frontend-only mode, just return random data; echo back basic connection info if needed later
  const data = Array.from({ length: Math.max(0, quantity|0) }, () => Math.floor(Math.random() * 256))
  return { success: true, data }
}

// WRITE 0x06
export async function writeSingleRegister(conn: Conn, _address: number, _value: number) {
  // In frontend-only mode, always succeed
  return { success: true }
}

// Queue or immediate write; we keep it simple here (TCP only by hostId string)
export async function writeOrQueue(hostId: string, address: number, value: number, _isConnected?: () => boolean) {
  try { await writeSingleRegister(hostId, address, value) } catch {}
  return true
}
