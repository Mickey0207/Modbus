import { useMemo, useState } from 'react'

function sanitizeHex(input: string) { return input.replace(/[^0-9a-fA-F\s]/g, '').replace(/\s+/g, ' ').trim() }
function isHexLike(s: string) { return /^[0-9a-fA-F\s]+$/.test(s) && s.replace(/\s/g, '').length % 2 === 0 }
function toHexSp(bytes: number[]) { return bytes.map(b => b.toString(16).padStart(2, '0')).join(' ') }

function be16(n: number) { return [(n >> 8) & 0xff, n & 0xff] }

export default function ModbusTCP() {
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState(502)
  const [hex, setHex] = useState('')
  const [resp, setResp] = useState<string>('')
  const [err, setErr] = useState<string>('')
  const [unitId, setUnitId] = useState(1)
  const [useMbap, setUseMbap] = useState(true)
  const [tid, setTid] = useState(1)

  // FC03/FC06 組包
  const [fc, setFc] = useState<3 | 6>(6)
  const [address, setAddress] = useState(0)
  const [quantity, setQuantity] = useState(1)
  const [value, setValue] = useState(0)

  const valid = useMemo(() => isHexLike(hex || ''), [hex])

  async function sendRaw(h: string) {
    setErr(''); setResp('')
    const res = await window.api?.sendTcpHex?.(host, Number(port), h)
    if (!res?.ok) throw new Error(res?.error || 'unknown error')
    setResp(res.data || '')
  }

  async function onSendHex() {
    try {
      const payload = sanitizeHex(hex)
      if (!payload || !valid) throw new Error('請輸入偶數位十六進位字串')
      await sendRaw(payload)
    } catch (e: any) {
      setErr(e?.message || String(e))
    }
  }

  function buildPdu(fc: 3 | 6, addr: number, qtyOrVal: number) {
    if (fc === 3) return [0x03, ...be16(addr), ...be16(qtyOrVal)]
    return [0x06, ...be16(addr), ...be16(qtyOrVal)]
  }

  function wrapMbap(unit: number, pdu: number[]) {
    const len = pdu.length + 1
    const t = tid & 0xffff
    const header = [ (t >> 8) & 0xff, t & 0xff, 0x00, 0x00, (len >> 8) & 0xff, len & 0xff, unit & 0xff ]
    return [...header, ...pdu]
  }

  async function sendPdu(fcLocal: 3 | 6, addr: number, qtyOrVal: number) {
    try {
      setErr(''); setResp('')
      const pdu = buildPdu(fcLocal, addr, qtyOrVal)
      const bytes = useMbap ? wrapMbap(unitId, pdu) : pdu
      const hexStr = Buffer.from(bytes).toString('hex')
      await sendRaw(hexStr)
      setTid(t => (t + 1) & 0xffff)
    } catch (e: any) {
      setErr(e?.message || String(e))
    }
  }

  // 快捷：場景對應群組（寫 24100..24147 = group-1 對應 1..32）
  const [sceneIndex, setSceneIndex] = useState(1) // 1..48 -> 24100..24147
  const [sceneGroup, setSceneGroup] = useState(1) // 1..32 -> 寫入值 0..31

  // 快捷：群組觸動（寫 25400+(group-1) = 0/1）
  const [groupIndex, setGroupIndex] = useState(1)
  const [groupOn, setGroupOn] = useState(1)

  return (
    <div style={{ padding: 24, color: '#1a1a1a', background: '#fafafa', minHeight: '100vh' }}>
      <h2 style={{ marginTop: 0 }}>Modbus TCP/IP 發送</h2>
      <div style={{ display: 'grid', gap: 16, maxWidth: 900 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <input style={{ flex: 1, minWidth: 220, padding: 8 }} placeholder="Host" value={host} onChange={e => setHost(e.target.value)} />
          <input style={{ width: 120, padding: 8 }} type="number" placeholder="Port" value={port} onChange={e => setPort(Number(e.target.value))} />
          <label>UnitId <input style={{ marginLeft: 6, width: 80, padding: 6 }} type="number" min={0} max={254} value={unitId} onChange={e => setUnitId(Number(e.target.value))} /></label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>MBAP<input type="checkbox" checked={useMbap} onChange={e => setUseMbap(e.target.checked)} /></label>
        </div>

        <section style={{ border: '1px solid #eee', background: '#fff', padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>通用 FC03/FC06 組包器</div>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(5, 1fr)' }}>
            <label>Function<select style={{ marginLeft: 6, padding: 6 }} value={fc} onChange={e => setFc(Number(e.target.value) as 3 | 6)}><option value={3}>FC03 Read</option><option value={6}>FC06 Write</option></select></label>
            <label>Address<input style={{ marginLeft: 6, padding: 6 }} type="number" value={address} onChange={e => setAddress(Number(e.target.value))} /></label>
            {fc === 3 ? (
              <label>Quantity<input style={{ marginLeft: 6, padding: 6 }} type="number" value={quantity} onChange={e => setQuantity(Number(e.target.value))} /></label>
            ) : (
              <label>Value<input style={{ marginLeft: 6, padding: 6 }} type="number" value={value} onChange={e => setValue(Number(e.target.value))} /></label>
            )}
            <div style={{ gridColumn: '1 / -1', color: '#556' }}>PDU 預覽：<code>{toHexSp(buildPdu(fc, address, fc === 3 ? quantity : value))}</code></div>
            <button style={{ padding: '8px 16px' }} onClick={() => sendPdu(fc, address, fc === 3 ? quantity : value)}>送出</button>
          </div>
        </section>

        <section style={{ border: '1px solid #eee', background: '#fff', padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>快捷：場景對應群組（寫主機暫存器 24100..24147）</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label>場景（1..48）<input style={{ marginLeft: 6, width: 100, padding: 6 }} type="number" min={1} max={48} value={sceneIndex} onChange={e => setSceneIndex(Number(e.target.value))} /></label>
            <label>群組（1..32）<input style={{ marginLeft: 6, width: 100, padding: 6 }} type="number" min={1} max={32} value={sceneGroup} onChange={e => setSceneGroup(Number(e.target.value))} /></label>
            <div>位址：<code>{24100 + Math.max(0, Math.min(47, sceneIndex - 1))}</code></div>
            <div>寫入值（0..31）：<code>{Math.max(0, Math.min(31, sceneGroup - 1))}</code></div>
            <button style={{ padding: '6px 12px' }} onClick={() => sendPdu(6, 24100 + Math.max(0, Math.min(47, sceneIndex - 1)), Math.max(0, Math.min(31, sceneGroup - 1)))}>送出</button>
          </div>
        </section>

        <section style={{ border: '1px solid #eee', background: '#fff', padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>快捷：群組觸動（寫主機暫存器 25400..25431）</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label>群組（1..32）<input style={{ marginLeft: 6, width: 100, padding: 6 }} type="number" min={1} max={32} value={groupIndex} onChange={e => setGroupIndex(Number(e.target.value))} /></label>
            <label>動作<select style={{ marginLeft: 6, padding: 6 }} value={groupOn} onChange={e => setGroupOn(Number(e.target.value))}><option value={1}>開(1)</option><option value={0}>關(0)</option></select></label>
            <div>位址：<code>{25400 + Math.max(0, Math.min(31, groupIndex - 1))}</code></div>
            <button style={{ padding: '6px 12px' }} onClick={() => sendPdu(6, 25400 + Math.max(0, Math.min(31, groupIndex - 1)), groupOn)}>送出</button>
          </div>
        </section>

        <section style={{ border: '1px solid #eee', background: '#fff', padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>原生十六進位發送</div>
          <textarea style={{ width: '100%', height: 120, padding: 8 }} placeholder="以空白分隔的十六進位：ex: 01 03 00 00 00 01 84 0A" value={hex} onChange={e => setHex(sanitizeHex(e.target.value))} />
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button onClick={onSendHex} disabled={!valid} style={{ padding: '8px 16px' }}>送出</button>
            {!valid && <span style={{ color: '#d33' }}>需要偶數位十六進位</span>}
          </div>
        </section>

        {err && <div style={{ color: '#d33' }}>錯誤：{err}</div>}
        {resp && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>回應（Hex）：</div>
            <code style={{ display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#fff', border: '1px solid #eee', padding: 8 }}>{resp}</code>
          </div>
        )}
      </div>
    </div>
  )
}
