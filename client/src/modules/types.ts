import React from 'react'

export type ModuleKey = 'status' | 'modbus'

export interface ModuleChild {
  key: string
  title: string
  path: string
  View?: React.ComponentType
  icon?: React.ReactNode
}

export interface AppModule {
  key: ModuleKey
  title: string
  icon?: React.ReactNode
  path: string
  children?: ModuleChild[]
  View: React.ComponentType
}
