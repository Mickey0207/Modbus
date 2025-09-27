import React from 'react'

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'solid' | 'outline' | 'ghost'
  size?: 'sm' | 'md'
}

export default function Button({ variant='solid', size='md', className='', ...rest }: Props) {
  const cls = [
    'btn',
    size === 'sm' ? 'btn--sm' : '',
    variant === 'outline' ? 'btn--outline' : '',
    variant === 'ghost' ? 'btn--ghost' : '',
    className
  ].filter(Boolean).join(' ')
  return <button className={cls} {...rest} />
}
