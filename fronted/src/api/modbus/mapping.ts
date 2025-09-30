// Address mapping used by UI. Adjust to real spec later.

// SW8: 8ch bit mask register base per unit
export function sw8MaskAddress(unitId: number) {
  return 0x1000 + (unitId|0)
}

// DIM4: 4ch on/off mask register base per unit
export function dimMaskAddress(unitId: number) {
  return 0x1100 + (unitId|0)
}

// DIM4: channel value register: base + unit + channel offset
export function dimValueAddress(unitId: number, channelIndex: number) {
  const ch = Math.max(0, Math.min(3, channelIndex|0))
  return 0x1200 + (unitId|0) * 4 + ch
}
