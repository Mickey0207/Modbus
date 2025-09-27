import type { AppModule } from './types'
import { AppstoreOutlined, DashboardOutlined, ApiOutlined, UsbOutlined } from '@ant-design/icons'
import StatusPage from '../pages/status/StatusPage'
import PortScannerPage from '../pages/modbus/portscan/PortScannerPage'
import SerialSpyPage from '../pages/modbus/serialspy/SerialSpyPage'
import ModbusHomePage from '../pages/modbus/ModbusHomePage'

const IconBox = (<AppstoreOutlined style={{ fontSize: 16 }} />)
const IconCpu = (<DashboardOutlined style={{ fontSize: 16 }} />)
const IconNetwork = (<ApiOutlined style={{ fontSize: 16 }} />)
const IconSerial = (<UsbOutlined style={{ fontSize: 16 }} />)

export const modules: AppModule[] = [
  { key: 'status', title: '主機狀態', path: '/status', icon: IconCpu, View: StatusPage },
  {
    key: 'modbus', title: 'Modbus 測試', path: '/modbus', icon: IconBox, View: ModbusHomePage, children: [
      { key: 'portscan', title: 'TCP 埠測試', path: '/modbus/portscanner', View: PortScannerPage, icon: IconNetwork },
      { key: 'serialspy', title: 'RS-485 監聽', path: '/modbus/serialspy', View: SerialSpyPage, icon: IconSerial },
  // 元件展示頁已移除
    ]
  },
]
