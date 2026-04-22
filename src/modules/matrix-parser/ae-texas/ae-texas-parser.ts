import {
  LOAD_FACTOR_MAP,
  PRODUCT_MAP,
  toCanonicalDollarsPerKwh,
  UTILITY_MAP,
} from '../../../constants/market-data.constants'
import type { LoadFactor, Rate, Utility } from '../../../types/market-data'

const AE_TEXAS_SUPPLIER_NAME = 'Atlantic Energy LLC'
const AE_TEXAS_MATRIX_SHEET_NAME = 'AE Texas Matrix'
const AE_TEXAS_DNA_CELL_ROW_INDEX = 2 // E3 (0-based row)
const AE_TEXAS_DNA_CELL_COL_INDEX = 4 // E3 (0-based column)
const AE_TEXAS_DATA_START_ROW_INDEX = 10 // Row 11 (0-based)

const AE_TEXAS_COL_INDEX = {
  utility: 1, // B
  zone: 2, // C
  loadFactor: 3, // D
  startDate: 4, // E
} as const

const DEFAULT_PRODUCT_KEY = PRODUCT_MAP.FIXED_ALL_IN

function normalizeUpper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function isIsoYmd(value: string): boolean {
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return false
  }
  const [yearRaw, monthRaw, dayRaw] = trimmed.split('-')
  if (!yearRaw || !monthRaw || !dayRaw) {
    return false
  }
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)
  const dt = new Date(Date.UTC(year, month - 1, day))
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() + 1 === month &&
    dt.getUTCDate() === day
  )
}

function toIsoYmdFromUnknown(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) {
    return null
  }
  if (isIsoYmd(raw)) {
    return raw
  }
  const mdyDelimited = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw)
  if (mdyDelimited && mdyDelimited[1] && mdyDelimited[2] && mdyDelimited[3]) {
    const iso = `${mdyDelimited[3]}-${mdyDelimited[1].padStart(2, '0')}-${mdyDelimited[2].padStart(2, '0')}`
    return isIsoYmd(iso) ? iso : null
  }
  const mdyUnderscore = /^(\d{1,2})_(\d{1,2})_(\d{4})$/.exec(raw)
  if (mdyUnderscore && mdyUnderscore[1] && mdyUnderscore[2] && mdyUnderscore[3]) {
    const iso = `${mdyUnderscore[3]}-${mdyUnderscore[1].padStart(2, '0')}-${mdyUnderscore[2].padStart(2, '0')}`
    return isIsoYmd(iso) ? iso : null
  }
  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) {
    const iso = `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`
    return isIsoYmd(iso) ? iso : null
  }
  return null
}

function matrixProductKeyToRateProduct(): 'ALL_IN' {
  if (DEFAULT_PRODUCT_KEY === 'FIXED_ALL_IN') {
    return 'ALL_IN'
  }
  return 'ALL_IN'
}

function mapUtility(rawUtility: unknown): Utility | undefined {
  const normalized = normalizeUpper(rawUtility)
  if (normalized === 'CENTERPOINT') return UTILITY_MAP.CENTERPOINT
  if (normalized === 'AEP CENTRAL') return UTILITY_MAP.AEP_CENTRAL
  if (normalized === 'AEP NORTH') return UTILITY_MAP.AEP_NORTH
  if (normalized === 'ONCOR') return UTILITY_MAP.ONCOR
  if (normalized === 'TNMP') return UTILITY_MAP.TNMP
  if (normalized === 'LPL') return UTILITY_MAP.LPL
  return undefined
}

function mapLoadFactor(rawLoadFactor: unknown): LoadFactor | undefined {
  const normalized = normalizeUpper(rawLoadFactor)
  if (normalized === 'LO') return LOAD_FACTOR_MAP.LOW
  if (normalized === 'MED') return LOAD_FACTOR_MAP.MEDIUM
  if (normalized === 'HI') return LOAD_FACTOR_MAP.HIGH
  return LOAD_FACTOR_MAP[normalized]
}

function mapGhostUtilities(rawTdsp: unknown): Utility[] {
  const normalizedTdsp = normalizeUpper(rawTdsp)
  if (!normalizedTdsp) {
    return []
  }
  if (normalizedTdsp === 'AEP') {
    return [UTILITY_MAP.AEP_CENTRAL, UTILITY_MAP.AEP_NORTH]
  }
  const utility = mapUtility(normalizedTdsp)
  return utility ? [utility] : []
}

function resolveTermColumns(headerRow: unknown[]): ReadonlyArray<{ colIndex: number; term: number }> {
  const resolved = new Map<number, number>()

  for (let i = 5; i <= 10; i += 1) {
    const label = normalizeUpper(headerRow[i])
    const match = /(\d{1,2})/.exec(label)
    if (!match || !match[1]) {
      continue
    }
    const term = Number(match[1])
    if ([6, 12, 18, 24, 36, 48].includes(term)) {
      resolved.set(i, term)
    }
  }

  if (resolved.size === 0) {
    const fallback: ReadonlyArray<{ colIndex: number; term: number }> = [
      { colIndex: 5, term: 6 },
      { colIndex: 6, term: 12 },
      { colIndex: 7, term: 18 },
      { colIndex: 8, term: 24 },
      { colIndex: 9, term: 36 },
      { colIndex: 10, term: 48 },
    ]
    return fallback
  }

  return Array.from(resolved.entries())
    .map(([colIndex, term]) => ({ colIndex, term }))
    .sort((a, b) => a.colIndex - b.colIndex)
}

function hasAtlanticSupplierMarker(rows: readonly unknown[][]): boolean {
  const marker = normalizeUpper(rows[AE_TEXAS_DNA_CELL_ROW_INDEX]?.[AE_TEXAS_DNA_CELL_COL_INDEX])
  return marker.includes(normalizeUpper(AE_TEXAS_SUPPLIER_NAME))
}

export function getAeTexasRequirements(): { targetSheets: readonly string[] } {
  return { targetSheets: [AE_TEXAS_MATRIX_SHEET_NAME] }
}

export function isAeTexasMatrix(
  sheetNames: readonly string[],
  fileName?: string,
  firstSheetRows?: unknown[][],
): boolean {
  const normalizedSheetNames = sheetNames.map((sheetName) => normalizeUpper(sheetName))
  if (normalizedSheetNames.includes(normalizeUpper('AE Texas Matrix'))) {
    return true
  }
  const normalizedFileName = String(fileName ?? '').toLowerCase()
  if (normalizedFileName.includes('ae texas') && sheetNames.length > 1) {
    return true
  }
  if (!firstSheetRows || firstSheetRows.length === 0) {
    return false
  }
  return hasAtlanticSupplierMarker(firstSheetRows)
}

export function extractAeTexasEffectiveDate(
  sheets: Readonly<Record<string, unknown[][]>>,
  fileName?: string,
): string | null {
  const anchoredFilenameDate = /^(\d{2})_(\d{2})_(\d{4})/.exec(String(fileName ?? '').trim())
  if (
    anchoredFilenameDate &&
    anchoredFilenameDate[1] &&
    anchoredFilenameDate[2] &&
    anchoredFilenameDate[3]
  ) {
    const iso = `${anchoredFilenameDate[3]}-${anchoredFilenameDate[1]}-${anchoredFilenameDate[2]}`
    return isIsoYmd(iso) ? iso : null
  }
  const rows = sheets[AE_TEXAS_MATRIX_SHEET_NAME] ?? []
  return toIsoYmdFromUnknown(rows[0]?.[1] ?? '')
}

export function parseAeTexasSilo(
  sheets: Readonly<Record<string, unknown[][]>>,
  _fileName: string,
  fallbackEffectiveDate: string,
): Rate[] {
  const rows = sheets[AE_TEXAS_MATRIX_SHEET_NAME]
  if (!rows || rows.length === 0) {
    throw new Error("Critical: 'AE Texas Matrix' sheet missing or empty.")
  }

  const row3 = rows[2] || []
  console.log('[AE Texas] Checking Row 3 for Supplier Name:', row3)
  const hasSupplierName = row3.some((cell) =>
    String(cell ?? '')
      .trim()
      .toUpperCase()
      .includes('ATLANTIC ENERGY LLC'),
  )
  if (!hasSupplierName) {
    console.error('[AE Texas] Validation Failed. Data seen:', row3)
    throw new Error(
      "Validation Failed: 'Atlantic Energy LLC' not found in Row 3 of Matrix sheet.",
    )
  }

  const effectiveDateCell = String(rows[0]?.[1] ?? '').trim()
  const effectiveDate = fallbackEffectiveDate.trim() || effectiveDateCell
  if (!effectiveDate) {
    throw new Error('AE Texas parser: effectiveDate is required.')
  }

  console.log('Starting AE Texas Parser...', { effectiveDate })

  const records: Rate[] = []
  let rawRowCount = 0
  let recordCount = 0
  let totalRateSum = 0

  const headerRow = rows[AE_TEXAS_DATA_START_ROW_INDEX - 1] ?? []
  const termColumns = resolveTermColumns(headerRow)
  for (let rowIndex = AE_TEXAS_DATA_START_ROW_INDEX; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? []
    const rawTdsp = normalizeUpper(row[AE_TEXAS_COL_INDEX.utility])
    const rawZone = normalizeUpper(row[AE_TEXAS_COL_INDEX.zone])
    const rawLoadFactor = normalizeUpper(row[AE_TEXAS_COL_INDEX.loadFactor])
    const startDate = String(row[AE_TEXAS_COL_INDEX.startDate] ?? '').trim()

    if (!rawTdsp && !rawZone && !rawLoadFactor && !startDate) {
      continue
    }

    const loadFactor = mapLoadFactor(rawLoadFactor)
    const utilities = mapGhostUtilities(rawTdsp)
    if (!startDate || !loadFactor || utilities.length === 0) {
      continue
    }

    rawRowCount += 1
    for (const { colIndex, term } of termColumns) {
      const numericPrice = Number(String(row[colIndex] ?? '').replace(/[$,\s]/g, ''))
      if (!Number.isFinite(numericPrice)) {
        continue
      }
      const ratePerKwh = toCanonicalDollarsPerKwh(numericPrice, 'DOLLARS_KWH')
      totalRateSum += ratePerKwh

      for (const utility of utilities) {
        records.push({
          supplier: 'AETexas',
          utility,
          zone: rawZone,
          loadFactor,
          startDate,
          effectiveDate,
          ratePerKwh,
          term,
          minUsageKwh: 0,
          maxUsageKwh: 500000,
          productType: matrixProductKeyToRateProduct(),
        } satisfies Rate)
        recordCount += 1
      }
    }
  }

  console.log(
    `%c ⚡ AE TEXAS INGESTION %c Count: ${records.length} | Sum: $${totalRateSum.toFixed(4)} | Scanned: ${rows.length} rows`,
    'background: #00ffff; color: #000; font-weight: bold; border-radius: 4px 0 0 4px; padding: 2px 8px;',
    'background: #333; color: #00ffff; border-radius: 0 4px 4px 0; padding: 2px 8px;',
  )
  console.log('[AE Texas Parser] Record Counter:', recordCount)

  return records
}
