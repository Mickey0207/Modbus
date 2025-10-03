// Stubbed Serial Spy API for frontend-only development

type SerialResponse<T> = { success: boolean; data?: T; message?: string }

export async function listSerialPorts(): Promise<SerialResponse<{ path: string; manufacturer?: string }[]>> {
  return {
    success: true,
    data: [
      { path: 'COM3', manufacturer: 'MockUSB' },
      { path: 'COM4', manufacturer: 'MockUART' },
    ],
    message: undefined
  }
}

export async function captureSerial(_opts: { path: string; baudRate: number; dataBits: number; stopBits: number; parity: 'none'|'even'|'odd'; durationMs: number; }): Promise<SerialResponse<{ hex: string; bytes: number }>> {
  const hex = 'AA BB CC DD EE FF' // mock payload
  const bytes = hex.split(/\s+/).filter(Boolean).length
  return { success: true, data: { hex, bytes }, message: undefined }
}
