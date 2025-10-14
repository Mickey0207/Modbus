import { useMemo, useState } from 'react'

type CRCParams = { poly: number; init: number; refin: boolean; refout: boolean; xorout: number }

const CRC8_STD: CRCParams = { poly: 0x07, init: 0x00, refin: false, refout: false, xorout: 0x00 }
const CRC8_MAXIM: CRCParams = { poly: 0x31, init: 0x00, refin: true, refout: true, xorout: 0x00 }

function reflect8(b: number) { let out = 0; for (let i = 0; i < 8; i++) out = (out << 1) | ((b >> i) & 1); return out & 0xff }
function crc8(bytes: number[], p: CRCParams) {
  let crc = p.init & 0xff
  for (let b of bytes) { if (p.refin) b = reflect8(b); crc ^= b; for (let i = 0; i < 8; i++) crc = (crc & 0x80) ? ((crc << 1) ^ p.poly) & 0xff : (crc << 1) & 0xff }
  if (p.refout) crc = reflect8(crc); return (crc ^ p.xorout) & 0xff
}

function clamp(val: number, min: number, max: number) { return Math.max(min, Math.min(max, val)) }
function toHexSp(bytes: number[]) { return bytes.map(b => b.toString(16).padStart(2, '0')).join(' ') }
function hexToSpaced(hex: string) { return hex?.match(/.{1,2}/g)?.join(' ') || '' }

export default function Modbus485() {
  // 連線到主機（網關）的 TCP/IP
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState(502)

  // 封包欄位
  const [unitId, setUnitId] = useState<number>(25)
  const [slaveType, setSlaveType] = useState<1 | 2>(1)
  const [range, setRange] = useState<1 | 2 | 3 | 4>(1)
  // 8CH：每場景 1 byte（bitmask）
  const [values8, setValues8] = useState<number[]>(Array(16).fill(0))
  // 4CH：每場景 4 bytes（每顆燈的調光值）
  const [values4, setValues4] = useState<number[][]>(Array.from({ length: 16 }, () => [0, 0, 0, 0]))
  // 群組寫入（0x19）使用的群組範圍與值（每範圍 16 筆）
  const [rangeGroup, setRangeGroup] = useState<1 | 2>(1) // 0x01=1..16, 0x02=17..32
  const [groupVals8, setGroupVals8] = useState<number[]>(Array(16).fill(0)) // 0..255
  const [groupVals4, setGroupVals4] = useState<number[]>(Array(16).fill(0)) // 0..15（僅低 4 位）
  // 啟用場景設定（對應 1..8、9..16 或 17..24、25..32 等），預設全開 FF
  const [enableLow, setEnableLow] = useState(true)
  const [enableHigh, setEnableHigh] = useState(true)
  const [crcMode, setCrcMode] = useState<'STD' | 'MAXIM'>('STD')
  const [sending, setSending] = useState(false)
  const [resp, setResp] = useState('')
  const [error, setError] = useState('')

  const params = useMemo(() => (crcMode === 'STD' ? CRC8_STD : CRC8_MAXIM), [crcMode])
  const writeBytes = useMemo(() => {
    // 寫入場景（0x1A）：unitId, 0x1A, slaveType, range, enableLow, enableHigh, payload..., CRC
    const header = [clamp(unitId, 0, 254), 0x1a, slaveType, range]
    const enL = enableLow ? 0xff : 0x00
    const enH = enableHigh ? 0xff : 0x00
    let payload: number[] = []
    if (slaveType === 1) {
      // 8CH：16 個場景各 1 byte（0..255）
      payload = values8.map(v => clamp(v, 0, 0xff) & 0xff)
    } else {
      // 4CH：16 個場景各 4 byte（每顆燈調光 0..255），順序 S1.C1..C4, S2.C1..C4, ...
      payload = values4.flat().map(v => clamp(v, 0, 0xff) & 0xff)
    }
    const bytes = [...header, enL, enH, ...payload]
    const c = crc8(bytes, params)
    return [...bytes, c]
  }, [unitId, slaveType, range, values8, values4, enableLow, enableHigh, params])

  const readBytes = useMemo(() => {
    // 讀取場景（0x18）：unitId, 0x18, slaveType, range, CRC
    const bytes = [clamp(unitId, 0, 254), 0x18, slaveType, range]
    const c = crc8(bytes, params)
    return [...bytes, c]
  }, [unitId, slaveType, range, params])

  // 群組寫入（0x19）：unitId, 0x19, slaveType, rangeGroup, 16 bytes, CRC
  const writeGroupBytes = useMemo(() => {
    const header = [clamp(unitId, 0, 254), 0x19, slaveType, rangeGroup]
    const payload = (slaveType === 1
      ? groupVals8.map(v => clamp(v, 0, 0xff) & 0xff)
      : groupVals4.map(v => clamp(v, 0, 0x0f) & 0xff))
    const bytes = [...header, ...payload]
    const c = crc8(bytes, params)
    return [...bytes, c]
  }, [unitId, slaveType, rangeGroup, groupVals8, groupVals4, params])

  // 群組讀出（0x17）：unitId, 0x17, slaveType, rangeGroup, CRC
  const readGroupBytes = useMemo(() => {
    const bytes = [clamp(unitId, 0, 254), 0x17, slaveType, rangeGroup]
    const c = crc8(bytes, params)
    return [...bytes, c]
  }, [unitId, slaveType, rangeGroup, params])

  async function sendHex(bytes: number[]) {
    setResp(''); setError(''); setSending(true)
    try {
      const hex = Buffer.from(bytes).toString('hex')
      const res = await window.api?.sendTcpHex?.(host, Number(port), hex)
      if (!res?.ok) throw new Error(res?.error || 'unknown error')
      setResp(hexToSpaced(res.data || ''))
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setSending(false)
    }
  }

  // 解析回覆（僅在長度符合時顯示）
  const parsed = useMemo(() => {
    const hex = resp.replace(/\s+/g, '')
    if (!hex || hex.length % 2 !== 0) return null
    const toBytes = (h: string) => h.match(/.{1,2}/g)?.map(x => parseInt(x, 16)) || []
    const bytes = toBytes(hex)
    // 場景讀出：
    // 8CH 應為 1(unitId) + 2(FF,FF) + 16 + 1(CRC) = 20 bytes
    // 4CH 應為 1 + 2 + 64 + 1 = 68 bytes
    if (slaveType === 1 && bytes.length === 20) {
      const unit = bytes[0]
      const sceneVals = bytes.slice(3, 19)
      return { unit, type: 'scene-8CH', scenes: sceneVals }
    }
    if (slaveType === 2 && bytes.length === 68) {
      const unit = bytes[0]
      const vals = bytes.slice(3, 67)
      const scenes: number[][] = []
      for (let i = 0; i < 16; i++) scenes.push(vals.slice(i * 4, i * 4 + 4))
      return { unit, type: 'scene-4CH', scenes }
    }
    // 群組讀出：1(unitId) + 16 + 1(CRC) = 18 bytes（8CH/4CH 相同）
    if (bytes.length === 18) {
      const unit = bytes[0]
      const groupVals = bytes.slice(1, 17)
      return { unit, type: slaveType === 1 ? 'group-8CH' : 'group-4CH', groups: groupVals }
    }
    return null
  }, [resp, slaveType])

  return (
    <div style={{ padding: 24, color: '#1a1a1a', background: '#fafafa', minHeight: '100vh' }}>
      <h2 style={{ marginTop: 0 }}>Modbus 485（經 TCP/IP 主機透明轉發）</h2>
      <div style={{ display: 'grid', gap: 12, maxWidth: 980 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <input style={{ padding: 8, width: 220 }} placeholder="Host" value={host} onChange={e => setHost(e.target.value)} />
          <input style={{ padding: 8, width: 120 }} type="number" placeholder="Port" value={port} onChange={e => setPort(Number(e.target.value))} />
          <label>unitId <input style={{ marginLeft: 6, width: 80, padding: 6 }} type="number" min={0} max={254} value={unitId} onChange={e => setUnitId(Number(e.target.value))} /></label>
          <label>slaveType
            <select style={{ marginLeft: 6, padding: 6 }} value={slaveType} onChange={e => setSlaveType(Number(e.target.value) as 1 | 2)}>
              <option value={1}>8CH (0x01)</option>
              <option value={2}>4CH (0x02)</option>
            </select>
          </label>
          <label>groupRange
            <select style={{ marginLeft: 6, padding: 6 }} value={range} onChange={e => setRange(Number(e.target.value) as 1 | 2 | 3 | 4)}>
              <option value={1}>1..16 (0x01)</option>
              <option value={2}>17..32 (0x02)</option>
              <option value={3}>33..48 (0x03)</option>
              <option value={4}>49..64 (0x04)</option>
            </select>
          </label>
          <label>CRC 模式
            <select style={{ marginLeft: 6, padding: 6 }} value={crcMode} onChange={e => setCrcMode(e.target.value as 'STD' | 'MAXIM')}>
              <option value="STD">CRC-8 (poly 0x07)</option>
              <option value="MAXIM">CRC-8/MAXIM (poly 0x31)</option>
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>啟用 1..8<input type="checkbox" checked={enableLow} onChange={e => setEnableLow(e.target.checked)} /></label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>啟用 9..16<input type="checkbox" checked={enableHigh} onChange={e => setEnableHigh(e.target.checked)} /></label>
        </div>
        {/* 場景寫入（0x1A） */}
        <div style={{ border: '1px solid #eee', padding: 12, background: '#fff' }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>場景寫入（0x1A）</div>
          {slaveType === 1 ? (
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(8, minmax(60px,1fr))' }}>
              {values8.map((v, i) => (
                <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  S{i + 1}
                  <input style={{ width: 70, padding: 6 }} type="number" min={0} max={255} value={v}
                    onChange={e => setValues8(prev => prev.map((vv, idx) => idx === i ? Number(e.target.value) : vv))} />
                </label>
              ))}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {values4.map((arr, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '60px repeat(4, 1fr)', gap: 8, alignItems: 'center' }}>
                  <div style={{ color: '#556' }}>S{i + 1}</div>
                  {arr.map((v, j) => (
                    <input key={j} style={{ padding: 6 }} type="number" min={0} max={255}
                      value={v} onChange={e => setValues4(prev => prev.map((row, idx) => idx === i ? row.map((vv, jj) => jj === j ? Number(e.target.value) : vv) : row))} />
                  ))}
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
            <code style={{ flex: 1, background: '#f8fafc', border: '1px solid #eef2f7', padding: 8 }}>{toHexSp(writeBytes)}</code>
            <button disabled={sending} onClick={() => sendHex(writeBytes)} style={{ padding: '8px 16px' }}>送出（0x1A）</button>
          </div>
        </div>

        {/* 群組寫入（0x19） */}
        <div style={{ border: '1px solid #eee', padding: 12, background: '#fff' }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>群組寫入（0x19）</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <label>groupRange
              <select style={{ marginLeft: 6, padding: 6 }} value={rangeGroup} onChange={e => setRangeGroup(Number(e.target.value) as 1 | 2)}>
                <option value={1}>1..16 (0x01)</option>
                <option value={2}>17..32 (0x02)</option>
              </select>
            </label>
          </div>
          {slaveType === 1 ? (
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(8, minmax(60px,1fr))' }}>
              {groupVals8.map((v, i) => (
                <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  G{i + 1}
                  <input style={{ width: 70, padding: 6 }} type="number" value={v} min={0} max={255}
                    onChange={e => setGroupVals8(prev => prev.map((vv, idx) => idx === i ? Number(e.target.value) : vv))} />
                </label>
              ))}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(8, minmax(60px,1fr))' }}>
              {groupVals4.map((v, i) => (
                <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  G{i + 1}
                  <input style={{ width: 70, padding: 6 }} type="number" value={v} min={0} max={15}
                    onChange={e => setGroupVals4(prev => prev.map((vv, idx) => idx === i ? Number(e.target.value) : vv))} />
                </label>
              ))}
            </div>
          )}
          <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
            <code style={{ flex: 1, background: '#f8fafc', border: '1px solid #eef2f7', padding: 8 }}>{toHexSp(writeGroupBytes)}</code>
            <button disabled={sending} onClick={() => sendHex(writeGroupBytes)} style={{ padding: '8px 16px' }}>送出（0x19）</button>
          </div>
        </div>

        {/* 讀出（0x18 與 0x17） */}
        <div style={{ border: '1px solid #eee', padding: 12, background: '#fff' }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>場景讀出（0x18）/ 群組讀出（0x17）</div>
          <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
            <code style={{ flex: 1, background: '#f8fafc', border: '1px solid #eef2f7', padding: 8 }}>{toHexSp(readBytes)}</code>
            <button disabled={sending} onClick={() => sendHex(readBytes)} style={{ padding: '8px 16px' }}>送出（0x18）</button>
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
            <code style={{ flex: 1, background: '#f8fafc', border: '1px solid #eef2f7', padding: 8 }}>{toHexSp(readGroupBytes)}</code>
            <button disabled={sending} onClick={() => sendHex(readGroupBytes)} style={{ padding: '8px 16px' }}>送出（0x17）</button>
          </div>
          <div style={{ marginTop: 8, color: '#666', fontSize: 12 }}>
            <div>群組讀出（0x17）：unitId + 16 bytes 群組值 + CRC（18 bytes）</div>
            <div>場景讀出（0x18）：8CH=20 bytes（含 2 個 FF 與 16 筆）、4CH=68 bytes（含 2 個 FF 與 64 筆）</div>
          </div>
        </div>

        {(resp || error) && (
          <div style={{ border: '1px solid #eee', padding: 12, background: '#fff' }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>回應</div>
            {error ? (
              <div style={{ color: '#d33' }}>錯誤：{error}</div>
            ) : (
              <div>
                <div style={{ color: '#666', fontSize: 12, marginBottom: 4 }}>Hex（以空白分隔）：</div>
                <code style={{ display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{resp}</code>
                {parsed && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>解析</div>
                    {parsed.type === 'scene-8CH' ? (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 8 }}>
                        {(parsed.scenes as number[]).map((v, i) => (
                          <div key={i} style={{ background: '#f8fafc', border: '1px solid #eef2f7', padding: 8 }}>S{i + 1}: {v}</div>
                        ))}
                      </div>
                    ) : parsed.type === 'scene-4CH' ? (
                      <div style={{ display: 'grid', gap: 8 }}>
                        {(parsed.scenes as number[][]).map((row, i) => (
                          <div key={i} style={{ display: 'grid', gridTemplateColumns: '60px repeat(4, 1fr)', gap: 8 }}>
                            <div style={{ color: '#556' }}>S{i + 1}</div>
                            {row.map((v, j) => <div key={j} style={{ background: '#f8fafc', border: '1px solid #eef2f7', padding: 8 }}>CH{j + 1}: {v}</div>)}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 8 }}>
                        {(parsed.groups as number[]).map((v, i) => (
                          <div key={i} style={{ background: '#f8fafc', border: '1px solid #eef2f7', padding: 8 }}>{(parsed.type as string).includes('8CH') ? `G${i + 1}: ${v}` : `G${i + 1}: ${v & 0x0f}`}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
