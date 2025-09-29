// Human-readable mapping tables for SW8CH (0/1 bitmask) and DIM (0/1 bitmask + 0..255 value)
// Addresses follow the rules provided:
//  - SW8CH: write 0/1 as an 8-bit mask to 5000 + (unitId-1)
//    * LSB is channel 1 (左 -> 右 對應 bit0..bit7)
//    * Example: unitId=1, CH1 on => value = 1; all ON => 255
//  - DIM on/off: 4-bit mask to 5004 + (unitId-1)
//    * LSB is channel 1; max value 15
//  - DIM value: channel 1..4 brightness 0..255 written to 5008..5011 per unit group
//    * addr = 5008 + (unitId-1)*4 + (chIndex)

export type Sw8Row = { ch: number; bit: number }
export type DimOnOffRow = { ch: number; bit: number }
export type DimValueRow = { ch: number; address: number }

export function sw8OnOffRegister(unitId: number) { return 5000 + Math.max(0, unitId - 1) }
export function dimOnOffRegister(unitId: number) { return 5004 + Math.max(0, unitId - 1) }
export function dimValueAddress(unitId: number, chIndex: number) { return 5008 + Math.max(0, unitId - 1) * 4 + Math.max(0, Math.min(3, chIndex)) }

export function sw8OnOffTable(unitId: number): { register: number; rows: Sw8Row[] } {
  return {
    register: sw8OnOffRegister(unitId),
    rows: Array.from({ length: 8 }, (_, i) => ({ ch: i + 1, bit: i }))
  }
}

export function dimOnOffTable(unitId: number): { register: number; rows: DimOnOffRow[] } {
  return {
    register: dimOnOffRegister(unitId),
    rows: Array.from({ length: 4 }, (_, i) => ({ ch: i + 1, bit: i }))
  }
}

export function dimValueTable(unitId: number): { rows: DimValueRow[] } {
  return {
    rows: Array.from({ length: 4 }, (_, i) => ({ ch: i + 1, address: dimValueAddress(unitId, i) }))
  }
}

export function packBits(bits: boolean[]): number {
  let v = 0
  for (let i = 0; i < bits.length; i++) if (bits[i]) v |= (1 << i)
  return v >>> 0
}
