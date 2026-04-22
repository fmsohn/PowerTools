import { LOAD_FACTOR_MAP, toCanonicalDollarsPerKwh } from '../../../constants/market-data.constants'
import { APGE_MATRIX_FILENAME_KEYWORDS } from '../supplierFilenameKeywords'
import type { LoadFactor, MatrixProductKey, Rate, RateProductType, Utility } from '../../../types/market-data'

const TX_MATRIX_SHEET = 'TX Matrix'
/** Excel row 12 (1-based) → `rows[11]`: usage tier labels in columns I–M. */
const USAGE_HEADER_ROW_1_BASED = 12
/** Excel row 13 (1-based) → `rows[12]`: first data row. */
const DATA_START_ROW_1_BASED = 13

/**
 * APG&E `ercot.xlsx` → `TX Matrix` column map (0-based indices; SSOT for this silo).
 * - B: contract start month
 * - D: utility → internal keys
 * - E: zone — strip trailing " LZ" → HOUSTON | NORTH | SOUTH | WEST
 * - F: load factor LO/MED/HI → LOW/MEDIUM/HIGH; exclude RESIDENTIAL
 * - G: contract term (months)
 * - H: product — Fixed Price → ALL_IN, Basis Pass Through → NODAL
 * - I–M: tier prices (cents/kWh) → $/kWh via `toCanonicalDollarsPerKwh`
 */
/** Raw matrix prices are quoted in cents per kWh. */
const APGE_SOURCE_PRICE_UNIT = 'CENTS_KWH' as const

const COL_START = 1 // B
const COL_UTILITY = 3 // D
const COL_ZONE = 4 // E
const COL_LOAD_FACTOR = 5 // F
/** Column G (0-based index 6) — contract term (months); must match `parseTermMonths(row[COL_TERM])`. */
const COL_TERM = 6
const COL_PRODUCT = 7 // H
const TIER_COL_START = 8 // I
const TIER_COL_END = 12 // M inclusive

const EXPECTED_HEADERS: Readonly<Record<number, string>> = {
  1: 'Start Month',
  3: 'Utility',
  4: 'Congestion Zone',
  5: 'Load Factor',
  6: 'Term',
  7: 'Product',
}

/** Matrix display labels → `UTILITY_MAP` keys (SSOT). */
const APGE_UTILITY_LABEL_TO_KEY: Readonly<Record<string, Utility>> = {
  CENTERPOINT: 'CENTERPOINT',
  ONCOR: 'ONCOR',
  TNMP: 'TNMP',
  'AEP TX CENTRAL': 'AEP_CENTRAL',
  'AEP TX NORTH': 'AEP_NORTH',
  LPL: 'LPL',
}

/** Load zone labels → canonical zone tokens (SSOT); `resolveZone` also strips a trailing " LZ". */
const APGE_ZONE_LABEL_TO_KEY: Readonly<Record<string, string>> = {
  'HOUSTON LZ': 'HOUSTON',
  'NORTH LZ': 'NORTH',
  'SOUTH LZ': 'SOUTH',
  'WEST LZ': 'WEST',
  HOUSTON: 'HOUSTON',
  NORTH: 'NORTH',
  SOUTH: 'SOUTH',
  WEST: 'WEST',
}

const APGE_CANONICAL_ZONES = new Set(['HOUSTON', 'NORTH', 'SOUTH', 'WEST'])

/** Load factor codes → `LOAD_FACTOR_MAP` keys (SSOT). */
const APGE_LOAD_FACTOR_TO_KEY: Readonly<Record<string, LoadFactor>> = {
  LO: 'LOW',
  MED: 'MEDIUM',
  HI: 'HIGH',
}

/** Product labels → matrix product keys (SSOT). */
const APGE_PRODUCT_LABEL_TO_KEY: Readonly<Record<string, MatrixProductKey>> = {
  'FIXED PRICE': 'FIXED_ALL_IN',
  'BASIS PASS THROUGH': 'NODAL_PASS_THROUGH',
}

function collapseWhitespace(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

function normKey(raw: string): string {
  return collapseWhitespace(raw).toUpperCase()
}

function matrixProductKeyToRateProduct(key: MatrixProductKey): RateProductType {
  return key === 'NODAL_PASS_THROUGH' ? 'NODAL' : 'ALL_IN'
}

function parseUsageTierLabel(raw: string): {
  minUsageKwh: number
  maxUsageKwh?: number
} {
  const upper = raw.trim().toUpperCase()
  const compact = upper.replace(/[^0-9+.\-–]/g, '')
  if (
    upper === '' ||
    upper === 'ANY' ||
    upper === 'ALL' ||
    upper === 'UNLIMITED' ||
    upper === 'N/A'
  ) {
    return { minUsageKwh: 0, maxUsageKwh: undefined }
  }

  const plusMatch = /^([\d.]+)\s*\+$/.exec(compact)
  if (plusMatch) {
    const min = Number(plusMatch[1])
    return Number.isFinite(min)
      ? { minUsageKwh: min, maxUsageKwh: undefined }
      : { minUsageKwh: 0, maxUsageKwh: undefined }
  }

  const rangeMatch = /^([\d.]+)\s*[-–]\s*([\d.]+)$/.exec(compact)
  if (rangeMatch) {
    const min = Number(rangeMatch[1])
    const max = Number(rangeMatch[2])
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return { minUsageKwh: min, maxUsageKwh: max }
    }
  }

  const numericTokens = (upper.match(/\d[\d,]*/g) ?? []).map((t) => Number(t.replace(/,/g, '')))
  if (numericTokens.length >= 2 && Number.isFinite(numericTokens[0]) && Number.isFinite(numericTokens[1])) {
    return { minUsageKwh: numericTokens[0], maxUsageKwh: numericTokens[1] }
  }

  const single = Number(compact)
  if (Number.isFinite(single) && single >= 0) {
    return { minUsageKwh: 0, maxUsageKwh: single }
  }

  return { minUsageKwh: 0, maxUsageKwh: undefined }
}

/** Excel 1900 date system: serial 25569 → 1970-01-01 (UTC). */
function excelSerialToYmd(serial: number): string | undefined {
  if (!Number.isFinite(serial)) {
    return undefined
  }
  const ms = (serial - 25569) * 86400_000
  const d = new Date(ms)
  if (!Number.isFinite(d.getTime())) {
    return undefined
  }
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isLikelyExcelSerial(n: number): boolean {
  return n >= 2000 && n <= 1_000_000
}

function calendarYmdFromLocalDate(d: Date): string | undefined {
  if (!Number.isFinite(d.getTime())) {
    return undefined
  }
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function coerceStartDateToYmd(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (value instanceof Date) {
    return calendarYmdFromLocalDate(value)
  }
  if (typeof value === 'number') {
    if (isLikelyExcelSerial(value)) {
      return excelSerialToYmd(value)
    }
    return undefined
  }
  const raw = String(value).trim()
  if (!raw) {
    return undefined
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw
  }
  const asNum = Number(raw)
  if (Number.isFinite(asNum) && isLikelyExcelSerial(asNum)) {
    return excelSerialToYmd(asNum)
  }
  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) {
    return calendarYmdFromLocalDate(parsed)
  }
  return undefined
}

/** Parse column G as whole months (handles Excel numeric, integers, or text like "24 months"). */
function parseTermMonths(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const months = Math.round(value)
    return months > 0 ? months : undefined
  }
  const raw = String(value).trim()
  if (!raw) {
    return undefined
  }
  const normalized = raw.replace(/,/g, '')
  const asNum = Number(normalized)
  if (Number.isFinite(asNum)) {
    const months = Math.round(asNum)
    return months > 0 ? months : undefined
  }
  const firstInt = /\d+/.exec(normalized)
  if (firstInt) {
    const months = parseInt(firstInt[0], 10)
    return months > 0 ? months : undefined
  }
  return undefined
}

function toNumericPrice(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null
  }
  const raw = String(value).trim()
  if (!raw) {
    return null
  }
  const numeric = parseFloat(raw.replace(/[",\s]/g, ''))
  if (!Number.isFinite(numeric) || numeric === 0) {
    return null
  }
  return numeric
}

export function getApgeRequirements(): { targetSheets: readonly string[] } {
  return { targetSheets: [TX_MATRIX_SHEET] }
}

function headerRowHasCongestionZone(rows: unknown[][]): boolean {
  const headerIdx = USAGE_HEADER_ROW_1_BASED - 1
  if (rows.length <= headerIdx) {
    return false
  }
  const headerRow = rows[headerIdx] ?? []
  return headerRow.some((cell) => String(cell ?? '').includes('Congestion Zone'))
}

export function isApgeMatrix(
  sheetNames: readonly string[],
  fileName?: string,
  rows?: unknown[][],
): boolean {
  const base = fileName?.trim().split(/[/\\]/).pop()?.toLowerCase() ?? ''
  const sheetOk = sheetNames.includes(TX_MATRIX_SHEET)
  const fileOk = base === 'ercot.xlsx'
  const keywordHit = APGE_MATRIX_FILENAME_KEYWORDS.some((kw) => base.includes(kw.toLowerCase()))
  if (rows && rows.length > 0 && headerRowHasCongestionZone(rows)) {
    return true
  }
  if (keywordHit && sheetOk) {
    return true
  }
  return fileOk && sheetOk
}

function resolveUtility(raw: string): Utility | undefined {
  const key = normKey(raw)
  return APGE_UTILITY_LABEL_TO_KEY[key]
}

function resolveZone(raw: string): string | undefined {
  const key = normKey(raw)
  const direct = APGE_ZONE_LABEL_TO_KEY[key]
  if (direct) {
    return direct
  }
  const stripped = key.replace(/\s+LZ$/i, '').trim()
  if (APGE_CANONICAL_ZONES.has(stripped)) {
    return stripped
  }
  return undefined
}

function resolveLoadFactor(raw: string): LoadFactor | undefined {
  const key = normKey(raw)
  const translated = APGE_LOAD_FACTOR_TO_KEY[key]
  if (translated) {
    return translated
  }
  return LOAD_FACTOR_MAP[key]
}

function resolveProductKey(raw: string): MatrixProductKey | undefined {
  const key = normKey(raw)
  return APGE_PRODUCT_LABEL_TO_KEY[key]
}

export function parseApgeMatrix(
  rows: unknown[][],
  options: { effectiveDate: string },
): Rate[] {
  const effectiveDate = options.effectiveDate.trim()
  if (!effectiveDate) {
    throw new Error('APG&E parser: effectiveDate is required.')
  }
  const headerIdx = USAGE_HEADER_ROW_1_BASED - 1
  const dataStartIdx = DATA_START_ROW_1_BASED - 1
  if (rows.length <= dataStartIdx) {
    return []
  }

  const headers = (rows[headerIdx] ?? []) as unknown[]
  const out: Rate[] = []
  const stats = {
    count: 0,
    skippedNA: 0,
    skippedGreen: 0,
    skippedOther: 0,
    utilityCounts: {} as Record<string, { ingested: number; skipped: number }>,
    sumRates: 0,
    minRate: Number.POSITIVE_INFINITY,
    maxRate: Number.NEGATIVE_INFINITY,
  }
  const failedUtilityLabels = new Set<string>()
  const failedLoadFactorLabels = new Set<string>()

  for (const [indexText, expectedValue] of Object.entries(EXPECTED_HEADERS)) {
    const index = Number(indexText)
    const actualValue = String(headers[index] ?? '').trim()
    if (actualValue !== expectedValue) {
      throw new Error(
        `CRITICAL: APG&E Index Mismatch at Column ${index}. Expected "${expectedValue}" but found "${actualValue}". Ingestion Aborted.`,
      )
    }
  }

  for (let rowIndex = dataStartIdx; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? []
    const loopIteration = rowIndex - dataStartIdx
    if (loopIteration < 5) {
      console.log('[parseApgeMatrix]', {
        excelRow1Based: rowIndex + 1,
        utility: row[COL_UTILITY],
        term: row[COL_TERM],
      })
    }
    const loadFactorRaw = String(row[COL_LOAD_FACTOR] ?? '')
    if (loadFactorRaw.toUpperCase().includes('RESIDENTIAL')) {
      stats.skippedOther += 1
      continue
    }
    const productRaw = String(row[COL_PRODUCT] ?? '').trim()
    const productUpper = productRaw.toUpperCase()
    if (productUpper.includes('GREEN') || productUpper.includes('RENEWABLE')) {
      stats.skippedGreen += 1
      continue
    }

    const utilityRaw = String(row[COL_UTILITY] ?? '').trim()
    const utility = resolveUtility(utilityRaw)
    const zoneRaw = resolveZone(String(row[COL_ZONE] ?? ''))
    const term = parseTermMonths(row[COL_TERM])
    const loadFactor = resolveLoadFactor(loadFactorRaw)
    const productKey = resolveProductKey(productRaw)

    if (!utility && utilityRaw) {
      failedUtilityLabels.add(utilityRaw)
    }
    if (!loadFactor && loadFactorRaw.trim()) {
      failedLoadFactorLabels.add(loadFactorRaw.trim())
    }

    if (!utility || !zoneRaw || term === undefined || !loadFactor || !productKey) {
      stats.skippedOther += 1
      continue
    }
    const utilityStats = stats.utilityCounts[utility] ?? (stats.utilityCounts[utility] = { ingested: 0, skipped: 0 })

    const startDate = coerceStartDateToYmd(row[COL_START])
    if (startDate === undefined) {
      stats.skippedOther += 1
      continue
    }

    const productType = matrixProductKeyToRateProduct(productKey)

    for (let col = TIER_COL_START; col <= TIER_COL_END; col += 1) {
      const headerLabel = String(headers[col] ?? '').trim()
      if (!headerLabel) {
        stats.skippedOther += 1
        continue
      }
      const rawPrice = String(row[col] ?? '').trim()
      const rawPriceUpper = rawPrice.toUpperCase()
      if (!rawPrice || rawPriceUpper === 'NA' || rawPriceUpper === 'N/A') {
        stats.skippedNA += 1
        utilityStats.skipped += 1
        continue
      }
      const price = toNumericPrice(row[col])
      if (price === null) {
        stats.skippedOther += 1
        continue
      }
      const { minUsageKwh, maxUsageKwh } = parseUsageTierLabel(headerLabel)
      const ratePerKwh = toCanonicalDollarsPerKwh(price, APGE_SOURCE_PRICE_UNIT)
      out.push({
        supplier: 'APG&E',
        utility,
        loadFactor,
        startDate,
        effectiveDate,
        ratePerKwh,
        zone: zoneRaw,
        term,
        minUsageKwh,
        maxUsageKwh,
        productType,
      } satisfies Rate)
      stats.count += 1
      stats.sumRates += ratePerKwh
      stats.minRate = Math.min(stats.minRate, ratePerKwh)
      stats.maxRate = Math.max(stats.maxRate, ratePerKwh)
      utilityStats.ingested += 1
    }
  }

  if (failedUtilityLabels.size === 0 && failedLoadFactorLabels.size === 0) {
    console.log('[Audit] Supplier APG&E: All keys mapped successfully.')
  } else {
    if (failedUtilityLabels.size > 0) {
      console.warn(
        '[Audit] Supplier APG&E: Utility translation failures:',
        Array.from(failedUtilityLabels).sort(),
      )
    }
    if (failedLoadFactorLabels.size > 0) {
      console.warn(
        '[Audit] Supplier APG&E: Load factor translation failures:',
        Array.from(failedLoadFactorLabels).sort(),
      )
    }
  }

  const supplierName = 'APG&E'
  console.group(`[Ingest Success] - ${supplierName}`)
  console.log('✅ Ingested Rates:', stats.count)
  console.log('❌ Skipped (Total):', stats.skippedNA + stats.skippedGreen + stats.skippedOther)
  console.log('   - Missing/NA Cells:', stats.skippedNA)
  console.log('   - Green/Renewable Products:', stats.skippedGreen)
  console.log('   - Other Filters:', stats.skippedOther)
  console.log('\n[Utility Reconciliation Ledger]')
  console.table(stats.utilityCounts)
  const avg = stats.count > 0 ? stats.sumRates / stats.count : 0
  console.log(
    `\nRates Summary - Min: ${stats.minRate}, Max: ${stats.maxRate}, Avg: ${avg.toFixed(4)}, Sum: ${stats.sumRates.toFixed(2)}`,
  )
  console.groupEnd()

  return out
}

export function parseApgeSilo(
  sheets: Readonly<Record<string, unknown[][]>>,
  _fileName: string,
  effectiveDate: string,
): Rate[] {
  if (!effectiveDate.trim()) {
    throw new Error('APG&E parser: effectiveDate is required.')
  }
  const rows = sheets[TX_MATRIX_SHEET]
  if (!rows) {
    return []
  }
  return parseApgeMatrix(rows, { effectiveDate })
}
