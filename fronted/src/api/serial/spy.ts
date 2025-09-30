// Stubbed Serial Spy API for frontend-only development

export async function listSerialPorts() {
  return {
    success: true,
    data: [
      { path: 'COM3', manufacturer: 'MockUSB' },
      { path: 'COM4', manufacturer: 'MockUART' },
    ],
  }
}

export async function captureSerial(_opts: { path: string; baudRate: number; dataBits: number; stopBits: number; parity: 'none'|'even'|'odd'; durationMs: number; }) {
  const hex = 'AA BB CC DD EE FF' // mock payload
  const bytes = hex.split(/\s+/).filter(Boolean).length
  return { success: true, data: { hex, bytes } }
}
