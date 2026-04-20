export type Utility =
  | 'CENTERPOINT'
  | 'ONCOR'
  | 'TNMP'
  | 'AEP_CENTRAL'
  | 'AEP_NORTH'
  | 'LPL'

export type LoadFactor = 'LOW' | 'MEDIUM' | 'HIGH'

/** Source unit for a raw matrix price before normalization to `ratePerKwh` ($/kWh). */
export type PriceUnit = 'DOLLARS_KWH' | 'CENTS_KWH' | 'DOLLARS_MWH'

export type RateProductType = 'ALL_IN' | 'NODAL'

/** Canonical matrix product tokens (NRG and other parsers normalize into these). */
export type MatrixProductKey = 'FIXED_ALL_IN' | 'NODAL_PASS_THROUGH'

export interface Rate {
  supplier: string
  utility: Utility
  loadFactor: LoadFactor
  /** Contract start as shown in the matrix (exact string for filtering). */
  startDate?: string
  /** Matrix / pricing date (YYYY-MM-DD), distinct from contract flow start when both exist. */
  effectiveDate: string
  /** Canonical stored unit: US dollars per kWh (e.g. 0.0556). */
  ratePerKwh: number
  zone: string
  term: number
  /** Inclusive lower bound of the usage tier (annual kWh). */
  minUsageKwh: number
  /** Inclusive upper bound when defined; omit for open-ended tiers (e.g. "10000+"). */
  maxUsageKwh?: number
  productType: RateProductType
}

/** Stable row identity for merges, UI dedupe, and IndexedDB upserts. */
export function rateMergeKey(rate: Rate): string {
  const max = rate.maxUsageKwh ?? ''
  const start = rate.startDate ?? ''
  return `${rate.supplier}|${rate.utility}|${rate.term}|${rate.effectiveDate}|${rate.zone}|${rate.loadFactor}|${rate.minUsageKwh}|${max}|${rate.productType}|${start}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isRate(value: unknown): value is Rate {
  if (!isRecord(value)) {
    return false
  }
  return (
    typeof value.supplier === 'string' &&
    typeof value.utility === 'string' &&
    typeof value.loadFactor === 'string' &&
    typeof value.effectiveDate === 'string' &&
    value.effectiveDate.trim().length > 0 &&
    typeof value.ratePerKwh === 'number' &&
    Number.isFinite(value.ratePerKwh) &&
    typeof value.zone === 'string' &&
    typeof value.term === 'number' &&
    Number.isFinite(value.term) &&
    typeof value.minUsageKwh === 'number' &&
    Number.isFinite(value.minUsageKwh) &&
    (value.maxUsageKwh === undefined ||
      (typeof value.maxUsageKwh === 'number' && Number.isFinite(value.maxUsageKwh))) &&
    (value.productType === 'ALL_IN' || value.productType === 'NODAL')
  )
}
