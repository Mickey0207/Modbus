import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import ShellLayout from '@/layout/ShellLayout'
import MasterSlaveStatus from '@/pages/status/MasterSlaveStatus'
import TcpIpPortScan from '@/pages/modbus/TcpIpPortScan'
// removed Transparent Forward page
import SerialSpy from '@/pages/modbus/SerialSpy'
import SitesManager from '@/pages/sites/SitesManager'

export default function App() {
  return (
    <ShellLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/status" replace />} />
        <Route path="/status" element={<MasterSlaveStatus />} />
        <Route path="/modbus/port-scan" element={<TcpIpPortScan />} />
  { /* Transparent Forward page removed */ }
  <Route path="/modbus/serial-spy" element={<SerialSpy />} />
  <Route path="/sites" element={<SitesManager />} />
  <Route path="/sites/new" element={<SitesManager mode="create" />} />
  <Route path="/sites/:id" element={<SitesManager />} />

        <Route path="*" element={<Navigate to="/status" replace />} />
      </Routes>
    </ShellLayout>
  )
}
