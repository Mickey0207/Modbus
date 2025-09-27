import React from 'react'

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  uiSize?: 'sm'|'md'
}

export default function Input({ uiSize='md', className='', ...rest }: Props) {
  const cls = ['input', uiSize==='sm'?'input--sm':'', className].filter(Boolean).join(' ')
  return <input className={cls} {...rest} />
}
