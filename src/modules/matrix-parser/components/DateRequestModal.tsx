import { useMemo, useState, type FormEvent } from 'react'

type DateRequestModalProps = {
  readonly supplierName: string
  readonly fileName: string
  readonly onConfirm: (isoDate: string) => void
  readonly onCancel: () => void
}

function todayIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function DateRequestModal({
  supplierName,
  fileName,
  onConfirm,
  onCancel,
}: DateRequestModalProps) {
  const [value, setValue] = useState('')
  const minDate = useMemo(() => '2000-01-01', [])
  const maxDate = useMemo(() => '2100-12-31', [])
  const placeholderDate = useMemo(() => todayIso(), [])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const isoDate = value.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
      return
    }
    onConfirm(isoDate)
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-xl rounded-md border-2 border-[#FF00FF] bg-black p-5 text-white shadow-[4px_4px_0_0_#000]"
      >
        <p className="mb-4 text-sm font-bold text-fuchsia-100">
          Pricing date is required for {supplierName}. We could not resolve a single effective date from
          the filename or workbook metadata for '{fileName}'. Please choose the pricing effective date.
        </p>
        <input
          type="date"
          value={value}
          min={minDate}
          max={maxDate}
          aria-label="Pricing effective date"
          placeholder={placeholderDate}
          onChange={(event) => setValue(event.target.value)}
          className="min-h-[44px] w-full rounded-md border-2 border-cyan-400 bg-black px-3 py-2 text-cyan-100 shadow-[4px_4px_0_0_#000] outline-none focus:border-fuchsia-400"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[44px] rounded-md border-2 border-[#FF00FF] bg-black px-4 text-xs font-bold uppercase tracking-[0.18em] text-fuchsia-200 shadow-[4px_4px_0_0_#000]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!value.trim()}
            className="min-h-[44px] rounded-md border-2 border-[#00FFFF] bg-black px-4 text-xs font-bold uppercase tracking-[0.18em] text-cyan-100 shadow-[4px_4px_0_0_#000] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Use Date
          </button>
        </div>
      </form>
    </div>
  )
}
