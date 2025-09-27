import React from 'react'
import { Button as AntButton } from 'antd'

export type ButtonVariant = 'primary' | 'neutral' | 'outline' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  iconLeft?: React.ReactNode
  iconRight?: React.ReactNode
}

export default function Button({ variant = 'primary', size = 'lg', block, iconLeft, iconRight, className, children, ...rest }: ButtonProps) {
  const danger = variant === 'danger'
  const type: 'primary' | 'default' | 'text' | 'link' | 'dashed' = variant === 'outline' || variant === 'neutral' ? 'default' : 'primary'
  const antdSize: 'small' | 'middle' | 'large' = size === 'lg' ? 'large' : size === 'sm' ? 'small' : 'middle'
  return (
    <AntButton
      {...(rest as any)}
      danger={danger}
      type={type}
      size={antdSize}
      className={className}
      style={{ width: block ? '100%' : undefined, ...rest.style }}
      icon={iconLeft as any}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {children}
        {iconRight}
      </span>
    </AntButton>
  )
}
