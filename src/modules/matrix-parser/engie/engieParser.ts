import { LOAD_FACTOR_MAP, toCanonicalDollarsPerKwh, UTILITY_MAP } from '../../../constants/market-data.constants'
import { ENGIE_MATRIX_FILENAME_KEYWORDS } from '../supplierFilenameKeywords'
import type { LoadFactor, Rate, RateProductType } from '../../../types/market-data'

const ALL_IN_MATRIX = 'All In Matrix'
const X_CON_MATRIX = 'X-Con Matrix'
const EXPECTED_HEADERS: Readonly<Record<number, string>> = {
  0: 'Start Date',
  3: 'Utility',
  4: 'Congestion Zone',
  5: 'Term',
  6: 'Load Factor',
  7: 'Special Note',
}
const ENGIE_INDEX_MAP = {
  startDate: 0,
  utility: 3,
  zone: 4,
  term: 5,
  loadFactor: 6,
  product: 7,
} as const

/** Sheet / vendor codes → internal keys (e.g. AEPCE → AEPCPL before system key). */
const ENGIE_UTILITY_TRANSLATION: Readonly<Record<string, string>> = {
  CPT: 'CENTERPOINT',
  ONCOR: 'ONCOR',
  TNMP: 'TNMP',
  AEPCE: 'AEPCPL',
  AEPNO: 'AEPWTU',
}

/** Internal keys → `UTILITY_MAP` keys (AEPCPL is Engie’s CPL / Central label). */
const ENGIE_INTERNAL_TO_SYSTEM_UTILITY: Readonly<Record<string, string>> = {
  AEPCPL: 'AEP_CENTRAL',
  AEPWTU: 'AEP_NORTH',
}

const ENGIE_LOAD_FACTOR_TRANSLATION: Readonly<Record<string, string>> = {
  LO: 'LOW',
  MED: 'MEDIUM',
  HI: 'HIGH',
}

/** Engie workbook tier cells are quoted in cents per kWh. */
const ENGIE_SOURCE_PRICE_UNIT = 'CENTS_KWH' as const

export function getEngieRequirements(): { targetSheets: readonly string[] } {
  return { targetSheets: [ALL_IN_MATRIX, X_CON_MATRIX] }
}

function firstRowsHaveEngieHeaderDna(rows: unknown[][]): boolean {
  for (const row of rows.slice(0, 20)) {
    const r = row as unknown[] | undefined
    const c0 = String(r?.[0] ?? '')
      .trim()
      .toLowerCase()
    const c3 = String(r?.[3] ?? '')
      .trim()
      .toLowerCase()
    if (c0.includes('start date') && c3.includes('utility')) {
      return true
    }
  }
  return false
}

export function isEngieMatrix(
  sheetNames: readonly string[],
  fileName?: string,
  firstSheetRows?: unknown[][],
): boolean {
  if (sheetNames.includes(ALL_IN_MATRIX) || sheetNames.includes(X_CON_MATRIX)) {
    return true
  }
  const base = fileName?.trim().split(/[/\\]/).pop()?.toLowerCase() ?? ''
  if (
    fileName !== undefined &&
    fileName.length > 0 &&
    ENGIE_MATRIX_FILENAME_KEYWORDS.some((kw) => base.includes(kw.toLowerCase()))
  ) {
    return true
  }
  if (firstSheetRows && firstSheetRows.length > 0 && firstRowsHaveEngieHeaderDna(firstSheetRows)) {
    return true
  }
  return false
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

function inferEngieProductType(productName: string): RateProductType {
  return productName.toUpperCase().includes('EXCLUDES CONGESTION') ? 'NODAL' : 'ALL_IN'
}

function coerceDateToYmd(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      return undefined
    }
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const raw = String(value).trim()
  if (!raw) {
    return undefined
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw
  }
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) {
    return undefined
  }
  const y = parsed.getFullYear()
  const m = String(parsed.getMonth() + 1).padStart(2, '0')
  const d = String(parsed.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function toNumericPrice(value: unknown): number | null {
  if (value === undefined || value === null) return null
  const raw = String(value).trim()
  if (!raw) return null
  // Strip quotes and commas, then parse
  const numeric = parseFloat(raw.replace(/[",\s]/g, ''))
  if (!Number.isFinite(numeric) || numeric === 0) return null
  return numeric
}

function normalizeUpper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

export function parseEngieMatrix(
  rows: unknown[][],
  sheetName: string,
  options: { effectiveDate: string },
): Rate[] {
  const effectiveDate = options.effectiveDate.trim()
  if (!effectiveDate) {
    throw new Error('ENGIE parser: effectiveDate is required.')
  }
  if (rows.length < 2) {
    return []
  }

  const headers = rows[4] ?? []
  const tierColumns = [8, 9, 10, 11, 12]
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

  for (const [indexText, expectedValue] of Object.entries(EXPECTED_HEADERS)) {
    const index = Number(indexText)
    const actualValue = String(headers[index] ?? '').trim()
    const normalizedActual = normalizeUpper(headers[index])
    const normalizedExpected = normalizeUpper(expectedValue)
    if (normalizedActual !== normalizedExpected) {
      throw new Error(
        `CRITICAL: ENGIE Index Mismatch at Column ${index}. Expected "${expectedValue}" but found "${actualValue}". Ingestion Aborted.`,
      )
    }
  }

  for (let rowIndex = 5; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? []
    const utilityRaw = normalizeUpper(row[ENGIE_INDEX_MAP.utility])
    const zone = String(row[ENGIE_INDEX_MAP.zone] ?? '').trim()
    const term = Number(String(row[ENGIE_INDEX_MAP.term] ?? '').trim())
    const loadFactorRaw = normalizeUpper(row[ENGIE_INDEX_MAP.loadFactor])
    const productName = String(row[ENGIE_INDEX_MAP.product] ?? '').trim()

    if (!utilityRaw || !zone || !Number.isFinite(term) || term <= 0 || !loadFactorRaw) {
      continue
    }

    const productUpper = normalizeUpper(productName)
    if (productUpper.includes('GREEN') || productUpper.includes('RENEWABLE')) {
      stats.skippedGreen += 1
      continue
    }
    if (productUpper.includes('COMMUNITY SOLAR')) {
      stats.skippedOther += 1
      continue
    }

    const utilityKey = ENGIE_UTILITY_TRANSLATION[utilityRaw] ?? utilityRaw
    const loadFactorKey = ENGIE_LOAD_FACTOR_TRANSLATION[loadFactorRaw] ?? loadFactorRaw

    const systemUtilityKey = ENGIE_INTERNAL_TO_SYSTEM_UTILITY[utilityKey] ?? utilityKey
    const utility = UTILITY_MAP[systemUtilityKey]
    const loadFactor: LoadFactor | undefined = LOAD_FACTOR_MAP[loadFactorKey]
    if (!utility || !loadFactor) {
      stats.skippedOther += 1
      continue
    }
    const utilityStats = stats.utilityCounts[utility] ?? (stats.utilityCounts[utility] = { ingested: 0, skipped: 0 })

    const startDate = coerceDateToYmd(row[ENGIE_INDEX_MAP.startDate])
    if (startDate === undefined) {
      stats.skippedOther += 1
      continue
    }

    const productType = inferEngieProductType(productName)

    for (const colIndex of tierColumns) {
      const headerLabel = String(headers[colIndex] ?? '').trim()
      if (!headerLabel) {
        stats.skippedOther += 1
        continue
      }
      const rawPrice = String(row[colIndex] ?? '').trim()
      const rawPriceUpper = normalizeUpper(rawPrice)
      if (!rawPrice || rawPriceUpper === 'NA' || rawPriceUpper === 'N/A') {
        stats.skippedNA += 1
        utilityStats.skipped += 1
        continue
      }
      const price = toNumericPrice(row[colIndex])
      if (price === null) {
        stats.skippedOther += 1
        continue
      }

      const { minUsageKwh, maxUsageKwh } = parseUsageTierLabel(headerLabel)
      const ratePerKwh = toCanonicalDollarsPerKwh(price, ENGIE_SOURCE_PRICE_UNIT)
      out.push({
        supplier: 'ENGIE',
        utility,
        loadFactor,
        startDate,
        effectiveDate,
        ratePerKwh,
        zone,
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

  const supplierName = 'ENGIE'
  console.group(`[Ingest Success] - ${supplierName} (${sheetName})`)
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

export function parseEngieSilo(
  sheets: Readonly<Record<string, unknown[][]>>,
  _fileName: string,
  effectiveDate: string,
): Rate[] {
  if (!effectiveDate.trim()) {
    throw new Error('ENGIE parser: effectiveDate is required.')
  }
  const { targetSheets } = getEngieRequirements()

  return targetSheets.flatMap((sheetName) => {
    const rows = sheets[sheetName]
    if (!rows) {
      return []
    }
    return parseEngieMatrix(rows, sheetName, { effectiveDate })
  })
}
