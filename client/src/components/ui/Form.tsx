import React from 'react'

// 輕量表單包裝，僅用 global.scss 的樣式類別
export const Form = ({ children, style, className = '', ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`form ${className}`} style={style} {...rest}>
    {children}
  </div>
)

export const FormItem: React.FC<React.HTMLAttributes<HTMLDivElement> & { label?: React.ReactNode }> = ({ label, children, className = '', style, ...rest }) => (
  <div className={`form-group ${className}`} style={style} {...rest}>
    {label && <label>{label}</label>}
    {children}
  </div>
)

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>
export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className = '', ...rest }, ref) => (
  <input ref={ref} className={className} {...rest} />
))

type InputNumberProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value'> & {
  value?: number | ''
  onChange?: (value: number | '') => void
}
export const InputNumber = React.forwardRef<HTMLInputElement, InputNumberProps>(({ className = '', value, onChange, ...rest }, ref) => (
  <input
    ref={ref}
    type="number"
    className={className}
    value={value as any}
    onChange={(e) => {
      const v = e.target.value
      if (onChange) onChange(v === '' ? '' : Number(v))
    }}
    {...rest}
  />
))

export type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>
export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(({ className = '', ...rest }, ref) => (
  <textarea ref={ref} className={className} {...rest} />
))

export default Form
