/** Formats a digit string with thousands separators for display (e.g. usage kWh). */
export function formatUsage(val: string): string {
  const clean = val.replace(/\D/g, '')
  if (clean === '') return ''
  return Number(clean).toLocaleString('en-US')
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)
}
