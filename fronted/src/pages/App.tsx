import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import ShellLayout from '@/layout/ShellLayout'
import MasterSlaveStatus from '@/pages/status/MasterSlaveStatus'
import TcpIpPortScan from '@/pages/modbus/TcpIpPortScan'
import TcpIpTransparentForward from '@/pages/modbus/TcpIpTransparentForward'

export default function App() {
  return (
    <ShellLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/status" replace />} />
        <Route path="/status" element={<MasterSlaveStatus />} />
        <Route path="/modbus/port-scan" element={<TcpIpPortScan />} />
        <Route path="/modbus/transparent-forward" element={<TcpIpTransparentForward />} />

        <Route path="*" element={<Navigate to="/status" replace />} />
      </Routes>
    </ShellLayout>
  )
}
