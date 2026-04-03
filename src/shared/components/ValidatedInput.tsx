import { useEffect, useId, type ReactNode } from 'react'

export interface ValidatedInputProps {
  readonly id?: string
  readonly label: ReactNode
  readonly hint?: string
  readonly value: string
  readonly onChange: (value: string) => void
  /** When set, value is debounced to sessionStorage. Omit to skip persistence. */
  readonly storageKey?: string
  readonly type?: 'text' | 'number'
  readonly inputMode?: 'decimal' | 'numeric' | 'text'
  readonly min?: string
  readonly max?: string
  readonly step?: string
  readonly className?: string
  readonly labelClassName?: string
  readonly inputClassName?: string
  /** Applied to the raw input string before onChange (e.g. strip commas). */
  readonly transformOnChange?: (raw: string) => string
  /** When set, this string is written to sessionStorage instead of `value` (for formatted inputs). */
  readonly persistValue?: string
  /** Replaces the default cyan slab border (e.g. high-margin warning). */
  readonly slabBorderClassName?: string
  readonly 'aria-invalid'?: boolean
}

/** Slab shell without border color (use with dynamic border or `slabBorderClassName`). */
export const SLAB_NEON_FIELD_SHELL_CLASS =
  'min-h-[44px] w-full rounded-md border-4 bg-slate-900 px-3 py-2 text-left text-white shadow-slab-dark transition-[box-shadow,filter] placeholder:text-slate-700 focus-visible:border-fuchsia-500 focus-visible:shadow-none focus-visible:drop-shadow-[0_0_8px_rgba(217,70,239,0.4)] focus-visible:outline-none'

/** Shared “3D neon slab” field chrome for inputs and matching selects. */
export const SLAB_NEON_FIELD_CLASS = `${SLAB_NEON_FIELD_SHELL_CLASS} border-cyan-400`

const DEBOUNCE_MS = 300

export function ValidatedInput({
  id: idProp,
  label,
  hint,
  value,
  onChange,
  storageKey,
  type = 'text',
  inputMode,
  min,
  max,
  step,
  className = '',
  labelClassName = 'text-sm font-medium text-text-h',
  inputClassName = '',
  transformOnChange,
  persistValue,
  slabBorderClassName,
  'aria-invalid': ariaInvalid,
}: ValidatedInputProps) {
  const reactId = useId()
  const id = idProp ?? reactId

  useEffect(() => {
    if (storageKey === undefined) return
    const handle = window.setTimeout(() => {
      try {
        sessionStorage.setItem(storageKey, persistValue ?? value)
      } catch {
        /* quota or private mode */
      }
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [value, persistValue, storageKey])

  return (
    <div className={`flex flex-col gap-1 text-left ${className}`}>
      <label htmlFor={id} className={labelClassName}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const raw = e.target.value
          onChange(transformOnChange ? transformOnChange(raw) : raw)
        }}
        aria-invalid={ariaInvalid}
        className={`${SLAB_NEON_FIELD_SHELL_CLASS} ${
          slabBorderClassName ??
          (value.trim() === '' ? 'border-cyan-900/50' : 'border-cyan-400')
        } ${inputClassName}`.trim()}
      />
      {hint ? <p className="text-sm text-text">{hint}</p> : null}
    </div>
  )
}
