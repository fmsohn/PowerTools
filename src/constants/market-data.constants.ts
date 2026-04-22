import type { LoadFactor, MatrixProductKey, PriceUnit, Utility } from '../types/market-data'

/** Authorized utility keys only (identity map for ingest validation). */
export const UTILITY_MAP: Record<string, Utility> = {
  CENTERPOINT: 'CENTERPOINT',
  ONCOR: 'ONCOR',
  TNMP: 'TNMP',
  AEP_CENTRAL: 'AEP_CENTRAL',
  AEP_NORTH: 'AEP_NORTH',
  LPL: 'LPL',
}

/** Authorized load-factor keys only (identity map for ingest validation). */
export const LOAD_FACTOR_MAP: Record<string, LoadFactor> = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
}

/** Canonical zone keys to prevent casing duplicates. */
export const ZONE_MAP: Record<string, string> = {
  HOUSTON: 'HOUSTON',
  SOUTH: 'SOUTH',
  NORTH: 'NORTH',
  WEST: 'WEST',
}

/** Display labels for canonical utility keys. */
export const UTILITY_LABELS: Readonly<Record<Utility, string>> = {
  CENTERPOINT: 'CenterPoint',
  ONCOR: 'Oncor',
  TNMP: 'TNMP',
  AEP_CENTRAL: 'AEP Central',
  AEP_NORTH: 'AEP North',
  LPL: 'LPL',
}

/** Display labels for canonical load-factor keys. */
export const LOAD_FACTOR_LABELS: Readonly<Record<LoadFactor, string>> = {
  LOW: 'Low',
  MEDIUM: 'Med',
  HIGH: 'High',
}

/** Authorized matrix product tokens (identity map). */
export const PRODUCT_MAP: Record<string, MatrixProductKey> = {
  FIXED_ALL_IN: 'FIXED_ALL_IN',
  NODAL_PASS_THROUGH: 'NODAL_PASS_THROUGH',
}

/** Multiply raw matrix values by this factor to get canonical `Rate.ratePerKwh` in $/kWh. */
export const UNIT_CONVERSION: Readonly<Record<PriceUnit, number>> = {
  DOLLARS_KWH: 1,
  CENTS_KWH: 0.01,
  DOLLARS_MWH: 1 / 1000,
}

export function toCanonicalDollarsPerKwh(raw: number, unit: PriceUnit): number {
  return raw * UNIT_CONVERSION[unit]
}

/** Converts Excel column letters (A, B, C... AA, AB) to 0-based array indices.
 * Example: 'A' -> 0, 'B' -> 1, 'Z' -> 25, 'AA' -> 26
 */
export const colToIndex = (col: string): number => {
  let index = 0
  const cleanCol = col.trim().toUpperCase()
  for (let i = 0; i < cleanCol.length; i++) {
    index = index * 26 + cleanCol.charCodeAt(i) - 64
  }
  return index - 1
}
