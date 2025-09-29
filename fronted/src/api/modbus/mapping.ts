// Modbus address mapping tables (assumptions per your spec):
// SW8CH (on/off bitmask): 8 bits packed (LSB = 第1顆)，每個從機站號佔一個暫存器
//   寫 0/1 的總值：addr = 5000 + (unitId - 1)，值 0..255
// DIM（on/off bitmask，4 bits）：
//   寫 0/1 的總值：addr = 5004 + (unitId - 1)，值 0..15
// DIM（亮度 0..255）：
//   CH1..CH4 對應 5008..5011，依站號逐組遞增：addr = 5008 + (unitId - 1)*4 + chIndex

export function sw8MaskAddress(unitId: number) {
  const unit = Math.max(1, Math.floor(unitId || 1))
  return 5000 + (unit - 1)
}

export function dimMaskAddress(unitId: number) {
  const unit = Math.max(1, Math.floor(unitId || 1))
  return 5004 + (unit - 1)
}

export function dimValueAddress(unitId: number, chIndex: number) {
  const unit = Math.max(1, Math.floor(unitId || 1))
  const idx = Math.max(0, Math.min(3, Math.floor(chIndex || 0)))
  return 5008 + (unit - 1) * 4 + idx
}

// Backward-compat wrappers if older code used per-channel addressing names
export const sw8Address = (_unitId: number, _chIndex: number) => sw8MaskAddress(_unitId)
export const dim4Address = (unitId: number, chIndex: number) => dimValueAddress(unitId, chIndex)
