import {
  LOAD_FACTOR_MAP,
  PRODUCT_MAP,
  toCanonicalDollarsPerKwh,
  UTILITY_MAP,
} from '../../../constants/market-data.constants'
import { NRG_MATRIX_FILENAME_KEYWORDS } from '../supplierFilenameKeywords'
import type { MatrixProductKey, Rate, RateProductType } from '../../../types/market-data'

const MATRIX_ID = 'matrix prices_all'
const WIZARD_ID = 'matrix price wizard'
const DATA_ANCHOR = 'START_DATE'
const EXPECTED_HEADERS: Readonly<Record<number, string>> = {
  0: 'START_DATE',
  1: 'PRODUCTNAME',
  2: 'DC',
  3: 'LOAD_PROFILE',
  4: 'CONGESTIONZONE',
  5: 'USAGEGROUPKWH',
}

function collapseWhitespace(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

function headerNorm(raw: unknown): string {
  return collapseWhitespace(String(raw ?? '').toLowerCase())
}

function inferProductType(cell: unknown): RateProductType {
  const h = headerNorm(cell)
  if (h.includes('nodal')) {
    return 'NODAL'
  }
  return 'ALL_IN'
}

/**
 * NRG-specific labels → authorized utility / load-factor keys (see `UTILITY_MAP` / `LOAD_FACTOR_MAP`).
 * Applied in `parseNrgMatrix` before master map lookup.
 */
const NRG_UTILITY_TRANSLATION: Readonly<Record<string, string>> = {
  CNP: 'CENTERPOINT',
  ONC: 'ONCOR',
  TNP: 'TNMP',
  WTU: 'AEP_NORTH',
  LPL: 'LPL',
  CPL: 'AEP_CENTRAL',
  'CPL WOODS': 'AEP_CENTRAL',
}

const NRG_LOAD_FACTOR_TRANSLATION: Readonly<Record<string, string>> = {
  BUSLOLF: 'LOW',
  BUSMEDLF: 'MEDIUM',
  BUSHILF: 'HIGH',
}

/** NRG matrix term columns are already $/kWh (e.g. 0.055); canonical storage is $/kWh. */
const NRG_SOURCE_PRICE_UNIT = 'DOLLARS_KWH' as const

function matrixProductKeyToRateProduct(key: MatrixProductKey): RateProductType {
  return key === 'NODAL_PASS_THROUGH' ? 'NODAL' : 'ALL_IN'
}

/** Collapses matrix product text to a single PRODUCT_MAP lookup token (e.g. "Fixed All In" → FIXED_ALL_IN). */
function normalizeProductLookupToken(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
}

function resolveRateProductType(productLabel: string, fallback: RateProductType): RateProductType {
  const token = normalizeProductLookupToken(productLabel)
  if (!token) {
    return fallback
  }
  const key = PRODUCT_MAP[token]
  if (key) {
    return matrixProductKeyToRateProduct(key)
  }
  return fallback
}

function normalizeDcLabel(raw: string): string {
  const normalized = raw.toUpperCase().trim()
  if (normalized === 'CNP') {
    return 'CenterPoint'
  }
  if (normalized === 'ONCOR') {
    return 'Oncor'
  }
  if (normalized === 'TNMP') {
    return 'TNMP'
  }
  return raw
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

/** Accepts sheet / JSON values: ISO-like strings, Excel serials, or Date. */
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
  const s = String(value).trim()
  if (!s) {
    return undefined
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s
  }
  const asNum = Number(s)
  if (Number.isFinite(asNum) && isLikelyExcelSerial(asNum)) {
    return excelSerialToYmd(asNum)
  }
  const parsed = new Date(s)
  if (!Number.isNaN(parsed.getTime())) {
    return calendarYmdFromLocalDate(parsed)
  }
  return undefined
}

function normalizeHeaderToken(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9_]/g, '')
}

/** Optional context from targeted ingest (e.g. Wizard row metadata). */
export type NrgIngestContext = {
  readonly wizardMetadata?: Readonly<Record<string, unknown>>
}

export function getNrgRequirements(): { targetSheets: readonly string[] } {
  return { targetSheets: [MATRIX_ID, WIZARD_ID] }
}

function firstRowsHaveNrgStartDateDna(rows: unknown[][]): boolean {
  for (const row of rows.slice(0, 20)) {
    const h0 = normalizeHeaderToken(String((row as unknown[] | undefined)?.[0] ?? ''))
    if (h0 === 'START_DATE') {
      return true
    }
  }
  return false
}

/** NRG matrix: anchor tab, filename keyword, or START_DATE “DNA” in the first sheet peek. */
export function isNrgMatrix(
  sheetNames: readonly string[],
  fileName?: string,
  firstSheetRows?: unknown[][],
): boolean {
  if (sheetNames.includes(MATRIX_ID)) {
    return true
  }
  const base = fileName?.trim().split(/[/\\]/).pop()?.toLowerCase() ?? ''
  if (
    fileName !== undefined &&
    fileName.length > 0 &&
    NRG_MATRIX_FILENAME_KEYWORDS.some((kw) => base.includes(kw.toLowerCase()))
  ) {
    return true
  }
  if (firstSheetRows && firstSheetRows.length > 0 && firstRowsHaveNrgStartDateDna(firstSheetRows)) {
    return true
  }
  return false
}

function parseWizardMetadataRow(
  rowsBySheet: Readonly<Record<string, unknown[][]>>,
): Readonly<Record<string, unknown>> | undefined {
  const wizardRows = rowsBySheet[WIZARD_ID]
  if (!wizardRows) {
    return undefined
  }
  const metadataRow1Based = 5
  const idx = metadataRow1Based - 1
  if (idx < 0 || idx >= wizardRows.length) {
    return undefined
  }
  const valueRow = wizardRows[idx] as unknown[]
  const headerRow = idx > 0 ? (wizardRows[idx - 1] as unknown[] | undefined) : undefined
  const out: Record<string, unknown> = {}
  if (headerRow?.length) {
    headerRow.forEach((h, i) => {
      const key = String(h ?? '').trim() || `col_${i}`
      out[key] = valueRow[i] ?? null
    })
  } else {
    valueRow.forEach((v, i) => {
      out[`col_${i}`] = v ?? null
    })
  }
  return out
}

export function buildNrgIngestContext(
  rowsBySheet: Readonly<Record<string, unknown[][]>>,
): NrgIngestContext | undefined {
  const wizardMetadata = parseWizardMetadataRow(rowsBySheet)
  return wizardMetadata ? { wizardMetadata } : undefined
}

/**
 * Converts a sniffed NRG-style matrix grid (row 0 = headers) into pivot rows,
 * unpivoting numeric term columns (12, 24, 36, …) into `termPrices`.
 * `ctx.wizardMetadata` is attached when the registry supplies a metadata row (NRG only today).
 */
export function nrgSheetRowsToPivotRows(
  rows: unknown[][],
  ctx?: NrgIngestContext,
): NrgMatrixPivotRow[] {
  if (rows.length < 2) {
    return []
  }
  const rawData = rows
  // DIAGNOSTIC MODE
  {
    const is2dArray = Array.isArray(rawData) && rawData.every((row) => Array.isArray(row))
    const isObjectArray = Array.isArray(rawData) && rawData.every((row) => !Array.isArray(row) && row !== null && typeof row === 'object')
    console.log('NRG parser diagnostic: matrix shape check', {
      is2dArray,
      isObjectArray,
      topLevelType: typeof rawData,
      firstRowType: typeof rawData[0],
    })

    const headerRow = Array.isArray(rawData[0]) ? rawData[0] : []
    const headers = headerRow.map((cell) => String(cell || '').trim())
    console.log('NRG parser diagnostic: header row JSON.stringify(matrix[0])', JSON.stringify(headerRow))
    console.log('NRG parser diagnostic: sanitized headers', headers)

    headerRow.slice(0, 10).forEach((cell, idx) => {
      console.log(`NRG parser diagnostic: header[${idx}]`, {
        value: cell,
        normalized: String(cell),
        type: typeof cell,
      })
    })

    const directStartDateIndex = headers.findIndex(
      (header) => header.toUpperCase() === 'START_DATE',
    )
    const hardenedStartDateIndex = headers.findIndex(
      (header) => header.toUpperCase() === 'STARTDATE',
    )
    console.log('NRG parser diagnostic: START_DATE anchor search', {
      normalizedFindIndex: directStartDateIndex,
      hardenedFindIndex: hardenedStartDateIndex,
    })
  }
  const headerRowIndex = rawData.findIndex((row) =>
    row.some((cell) => {
      const normalized = String(cell ?? '').trim().toUpperCase()
      return normalized === DATA_ANCHOR || normalized === 'STARTDATE'
    }),
  )
  if (headerRowIndex === -1) {
    throw new Error(`NRG parser: Could not find required header row anchor "${DATA_ANCHOR}"`)
  }

  const headerCells = rawData[headerRowIndex] ?? []
  const headers = headerCells.map((cell) =>
    cell === null || cell === undefined ? '' : `${cell}`.trim(),
  )
  for (const [indexText, expectedValue] of Object.entries(EXPECTED_HEADERS)) {
    const index = Number(indexText)
    const actualValue = String(headers[index] ?? '').trim()
    if (actualValue !== expectedValue) {
      throw new Error(
        `CRITICAL: NRG Index Mismatch at Column ${index}. Expected "${expectedValue}" but found "${actualValue}". Ingestion Aborted.`,
      )
    }
  }

  const findHeaderIndex = (...candidates: string[]): number => {
    const wanted = new Set(candidates.map((c) => normalizeHeaderToken(c)))
    return headers.findIndex((h) => wanted.has(normalizeHeaderToken(h)))
  }
  const colMap = {
    utility: findHeaderIndex('DC'),
    zone: findHeaderIndex('CONGESTIONZONE'),
    loadProfile: findHeaderIndex('LOAD_PROFILE', 'LOADPROFILE'),
    usageGroup: findHeaderIndex('USAGEGROUPKWH', 'USAGE_GROUP_KWH'),
    product: findHeaderIndex('PRODUCTNAME', 'PRODUCT NAME'),
    startDate: findHeaderIndex('STARTDATE', 'START_DATE'),
    supplier: findHeaderIndex('SUPPLIER'),
    termStart: headers.indexOf('1'),
  }
  console.log('NRG parser column map:', colMap)

  if (colMap.product === -1) {
    throw new Error(
      `NRG SCHEMA ERROR: Could not find 'PRODUCTNAME' column. Found instead: ${headers
        .slice(0, 5)
        .join(', ')}`,
    )
  }
  if (colMap.utility === -1) {
    throw new Error(
      "NRG SCHEMA ERROR: Could not find 'DC' column (Utility). Please check if NRG renamed this header.",
    )
  }
  if (colMap.loadProfile === -1) {
    throw new Error('NRG parser: Missing critical column "LOAD_PROFILE"')
  }
  if (colMap.usageGroup === -1) {
    throw new Error('NRG parser: Missing critical column "USAGEGROUPKWH"')
  }

  const termMap: Record<number, number> = {}
  for (let t = 1; t <= 60; t += 1) {
    termMap[t] = headers.findIndex((h) => h === String(t))
  }
  const termCols: { idx: number; months: number }[] = Object.entries(termMap)
    .filter(([, idx]) => idx !== -1)
    .map(([months, idx]) => ({ idx, months: Number(months) }))
  if (termCols.length === 0) {
    return []
  }

  const out: NrgMatrixPivotRow[] = []
  let validRateCount = 0
  for (let r = headerRowIndex + 1; r < rawData.length; r += 1) {
    const row = rawData[r] ?? []
    const sanitizedRow = row.map((cell) =>
      cell === null || cell === undefined ? '' : `${cell}`.trim(),
    )
    const firstCell = sanitizedRow[0] ?? ''
    if (!firstCell || firstCell.toUpperCase().includes('START_DATE')) {
      continue
    }
    const rawDC = sanitizedRow[colMap.utility] ?? ''
    const utilityLabel = normalizeDcLabel(rawDC)
    const usageTierLabel = sanitizedRow[colMap.usageGroup] ?? ''
    const loadFactorLabel = sanitizedRow[colMap.loadProfile] ?? ''
    if (!utilityLabel || !usageTierLabel || !loadFactorLabel) {
      continue
    }
    const zone = colMap.zone !== -1 ? (sanitizedRow[colMap.zone] ?? '') : ''
    const productType =
      colMap.product !== -1 ? inferProductType(sanitizedRow[colMap.product] ?? '') : inferProductType('')
    const productName = colMap.product !== -1 ? (sanitizedRow[colMap.product] ?? '') : ''
    const supplier = colMap.supplier !== -1 ? (sanitizedRow[colMap.supplier] || 'NRG') : 'NRG'
    const rawStartDate = colMap.startDate !== -1 ? row[colMap.startDate] : undefined
    const pivotStartDate: string | number | Date | undefined =
      rawStartDate === null || rawStartDate === undefined
        ? undefined
        : typeof rawStartDate === 'string' && rawStartDate.trim() === ''
          ? undefined
          : (rawStartDate as string | number | Date)

    const termPrices: Partial<Record<number, number | string>> = {}
    for (const { idx, months } of termCols) {
      const colIdx = idx
      const rawVal = sanitizedRow[colIdx] ?? ''
      if (!rawVal || rawVal.toUpperCase() === 'NA' || rawVal.toUpperCase() === 'N/A') {
        termPrices[months] = rawVal
        continue
      }
      const numericRate = parseFloat(rawVal.replace(/[^0-9.]/g, ''))
      if (!Number.isNaN(numericRate) && numericRate !== 0) {
        termPrices[months] = numericRate
        validRateCount += 1
      } else {
        console.warn(`Skipping invalid rate for ${productName}: ${rawVal}`)
      }
    }
    if (Object.keys(termPrices).length === 0) {
      continue
    }

    out.push({
      supplier,
      utilityLabel,
      loadFactorLabel,
      ...(pivotStartDate !== undefined ? { startDate: pivotStartDate } : {}),
      zone: zone || '—',
      productType,
      productLabel: productName,
      usageTierLabel,
      termPrices,
      ...(ctx?.wizardMetadata ? { sheetMetadata: ctx.wizardMetadata } : {}),
    })
  }
  if (validRateCount === 0) {
    throw new Error(
      'NRG PARSE FAILURE: Headers matched but no valid price rows were extracted. Verify data starting at Row 2.',
    )
  }
  return out
}

export interface NrgMatrixPivotRow {
  supplier: string
  utilityLabel: string
  loadFactorLabel: string
  /** Optional contract start from the sheet (string, Excel serial, or Date → YYYY-MM-DD in parseNrgMatrix). */
  startDate?: string | number | Date
  zone: string
  productType: RateProductType
  /** Raw product name cell (for PRODUCT_MAP / NRG resolution in parseNrgMatrix). */
  productLabel: string
  /** Raw matrix label, e.g. "0-5000", "5001+", "10,000+". */
  usageTierLabel: string
  /** Unpivoted from matrix columns: term month → raw sheet price in $/kWh (see `NRG_SOURCE_PRICE_UNIT`). */
  termPrices: Partial<Record<number, number | string>>
  /** Registry-driven metadata row (e.g. Wizard), not mapped to rates yet. */
  sheetMetadata?: Readonly<Record<string, unknown>>
}

function parseUsageTierLabel(raw: string): {
  minUsageKwh: number
  maxUsageKwh?: number
} {
  const upper = raw.trim().toUpperCase()
  /** Strip grouping/noise so e.g. "0-300,000" → "0-300000" for range regex. */
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

export function parseNrgMatrix(
  rows: NrgMatrixPivotRow[],
  options: { effectiveDate: string },
): Rate[] {
  const pricingDateYmd = options.effectiveDate.trim()
  if (!pricingDateYmd) {
    throw new Error('NRG parser: effectiveDate is required.')
  }
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

  for (const row of rows) {
    const productLabelForFilter = String(row.productLabel ?? '')
    const productUpper = productLabelForFilter.toUpperCase()
    if (productUpper.includes('GREEN') || productUpper.includes('RENEWABLE')) {
      stats.skippedGreen += 1
      continue
    }

    const utilityKeyRaw = normalizeDcLabel(String(row.utilityLabel ?? '').trim())
      .toUpperCase()
      .trim()
    const utilityKey = NRG_UTILITY_TRANSLATION[utilityKeyRaw] ?? utilityKeyRaw
    const normalizedUtility = UTILITY_MAP[utilityKey]

    const loadFactorKeyRaw = String(row.loadFactorLabel ?? '')
      .toUpperCase()
      .trim()
    const loadFactorKey = NRG_LOAD_FACTOR_TRANSLATION[loadFactorKeyRaw] ?? loadFactorKeyRaw
    const normalizedLoadFactor = LOAD_FACTOR_MAP[loadFactorKey]
    const maybeUtilityStats =
      normalizedUtility
        ? (stats.utilityCounts[normalizedUtility] ?? (stats.utilityCounts[normalizedUtility] = { ingested: 0, skipped: 0 }))
        : undefined

    const usageTierLabel = String(row.usageTierLabel ?? '').trim()
    const usageTierUpper = usageTierLabel.toUpperCase()
    if (!usageTierLabel || usageTierUpper === 'NA' || usageTierUpper === 'N/A') {
      stats.skippedNA += 1
      if (maybeUtilityStats) {
        maybeUtilityStats.skipped += 1
      }
      continue
    }

    const productType = resolveRateProductType(row.productLabel ?? '', row.productType)

    if (!normalizedUtility || !normalizedLoadFactor) {
      const utilityLabelRaw = String(row.utilityLabel ?? '').trim()
      const loadFactorLabelRaw = String(row.loadFactorLabel ?? '').trim()
      if (!normalizedUtility && utilityLabelRaw) {
        failedUtilityLabels.add(utilityLabelRaw)
      }
      if (!normalizedLoadFactor && loadFactorLabelRaw) {
        failedLoadFactorLabels.add(loadFactorLabelRaw)
      }
      stats.skippedOther += 1
      continue
    }
    const utilityStats = maybeUtilityStats
    if (!utilityStats) {
      stats.skippedOther += 1
      continue
    }

    const { minUsageKwh, maxUsageKwh } = parseUsageTierLabel(usageTierLabel)
    const startDate = coerceStartDateToYmd(row.startDate)

    for (const [termKey, price] of Object.entries(row.termPrices)) {
      const term = Number(termKey)
      if (!Number.isFinite(term) || term <= 0) {
        stats.skippedOther += 1
        continue
      }
      if (price === undefined || price === null) {
        stats.skippedNA += 1
        utilityStats.skipped += 1
        continue
      }
      const rawPriceStr = typeof price === 'string' ? price.trim() : ''
      if (
        typeof price === 'string' &&
        (!rawPriceStr || rawPriceStr.toUpperCase() === 'NA' || rawPriceStr.toUpperCase() === 'N/A')
      ) {
        stats.skippedNA += 1
        utilityStats.skipped += 1
        continue
      }
      const numericPrice = Number(price)
      if (!Number.isFinite(numericPrice)) {
        stats.skippedOther += 1
        continue
      }
      const ratePerKwh = toCanonicalDollarsPerKwh(numericPrice, NRG_SOURCE_PRICE_UNIT)

      out.push({
        supplier: row.supplier.trim(),
        utility: normalizedUtility,
        loadFactor: normalizedLoadFactor,
        ...(startDate !== undefined ? { startDate } : {}),
        effectiveDate: pricingDateYmd,
        ratePerKwh,
        zone: row.zone.trim().toUpperCase(),
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
    console.log('[Audit] Supplier NRG: All keys mapped successfully.')
  } else {
    if (failedUtilityLabels.size > 0) {
      console.warn(
        '[Audit] Supplier NRG: Utility translation failures:',
        Array.from(failedUtilityLabels).sort(),
      )
    }
    if (failedLoadFactorLabels.size > 0) {
      console.warn(
        '[Audit] Supplier NRG: Load factor translation failures:',
        Array.from(failedLoadFactorLabels).sort(),
      )
    }
  }

  const supplierName = 'NRG'
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

  console.log('Final Rate Count:', out.length)
  return out
}

export function parseNrgSilo(
  sheets: Readonly<Record<string, unknown[][]>>,
  _fileName: string,
  effectiveDate: string,
): Rate[] {
  if (!effectiveDate.trim()) {
    throw new Error('NRG parser: effectiveDate is required.')
  }
  const parseCtx = buildNrgIngestContext(sheets)
  const matrixRows = sheets[MATRIX_ID]
  if (!matrixRows) {
    return []
  }
  const pivotRows = nrgSheetRowsToPivotRows(matrixRows, parseCtx)
  return parseNrgMatrix(pivotRows, { effectiveDate })
}

export function extractNrgEffectiveDate(
  sheets: Readonly<Record<string, unknown[][]>>,
): string | null {
  const wizardRows = sheets[WIZARD_ID]
  if (!wizardRows) {
    return null
  }
  const metadataRow1Based = 5
  const metadataIndex = metadataRow1Based - 1
  const metadataRow = wizardRows[metadataIndex] as unknown[] | undefined
  if (!metadataRow || metadataRow.length === 0) {
    return null
  }
  const joined = metadataRow
    .map((cell) => String(cell ?? '').trim())
    .filter((value) => value.length > 0)
    .join(' ')
  if (!joined) {
    return 'NRG Date Regex Failed'
  }
  const stripped = joined.replace(/prices?\s+valid\s+until\s*/i, '').trim()
  const match = /(\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4})/.exec(stripped)
  if (!match || !match[1]) {
    return 'NRG Date Regex Failed'
  }
  const dateParts = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})$/.exec(match[1].trim())
  if (!dateParts || !dateParts[1] || !dateParts[2] || !dateParts[3]) {
    return 'NRG Date Regex Failed'
  }
  const monthMap: Record<string, string> = {
    JAN: '01',
    FEB: '02',
    MAR: '03',
    APR: '04',
    MAY: '05',
    JUN: '06',
    JUL: '07',
    AUG: '08',
    SEP: '09',
    OCT: '10',
    NOV: '11',
    DEC: '12',
  }
  const day = String(Number(dateParts[1])).padStart(2, '0')
  const month = monthMap[dateParts[2].toUpperCase()]
  if (!month) {
    return 'NRG Date Regex Failed'
  }
  const rawYear = Number(dateParts[3])
  if (!Number.isFinite(rawYear)) {
    return 'NRG Date Regex Failed'
  }
  const y = rawYear < 100 ? 2000 + rawYear : rawYear
  const d = day
  const m = month
  return `${y}-${m}-${d}`
}
