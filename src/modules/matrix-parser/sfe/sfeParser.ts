import { LOAD_FACTOR_MAP, PRODUCT_MAP, toCanonicalDollarsPerKwh, UTILITY_MAP, ZONE_MAP } from '../../../constants/market-data.constants'
import type { LoadFactor, Rate, Utility } from '../../../types/market-data'
import { SFE_MATRIX_FILENAME_KEYWORDS } from '../supplierFilenameKeywords'

const SFE_SHEET_NAME = 'Pricing Worksheet'
const SFE_HEADER_ROW_INDEX = 15
const SFE_DATA_START_ROW_INDEX = 16

const SFE_COL_INDEX = {
  startDate: 1, // Column B
  tdsp: 2, // Column C
  zone: 3, // Column D
  loadFactor: 4, // Column E
  term: 5, // Column F
  price: 6, // Column G
} as const
const DEFAULT_PRODUCT_KEY = PRODUCT_MAP.FIXED_ALL_IN

export function getSfeRequirements(): { targetSheets: readonly string[] } {
  return { targetSheets: [SFE_SHEET_NAME] }
}

function matrixProductKeyToRateProduct(): 'ALL_IN' {
  if (DEFAULT_PRODUCT_KEY === 'FIXED_ALL_IN') {
    return 'ALL_IN'
  }
  return 'ALL_IN'
}

function normalizeUpper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function toIsoYmdFromUnknown(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = (value - 25569) * 86400_000
    const utcDate = new Date(ms)
    if (Number.isNaN(utcDate.getTime())) {
      return null
    }
    return utcDate.toISOString().slice(0, 10)
  }
  const raw = String(value).trim()
  if (!raw) {
    return null
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw
  }
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  const y = parsed.getFullYear()
  const m = String(parsed.getMonth() + 1).padStart(2, '0')
  const d = String(parsed.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function firstRowsHaveSfeHeaderDna(rows: unknown[][]): boolean {
  const headerRow = rows[15] ?? []
  const tdsp = String(headerRow[2] ?? '').toUpperCase().trim()
  const zone = String(headerRow[3] ?? '').toUpperCase().trim()
  const isMatch = tdsp.includes('TDSP') && zone.includes('ZONE')
  if (!isMatch) {
    console.log('SFE DNA Still Mismatched. Row 15, Index 2 is:', tdsp)
  }
  return isMatch
}

export function isSfeMatrix(
  sheetNames: readonly string[],
  fileName?: string,
  firstSheetRows?: unknown[][],
): boolean {
  if (sheetNames.includes(SFE_SHEET_NAME)) {
    return true
  }
  const base = fileName?.trim().split(/[/\\]/).pop()?.toLowerCase() ?? ''
  if (
    fileName !== undefined &&
    fileName.length > 0 &&
    SFE_MATRIX_FILENAME_KEYWORDS.some((kw) => base.includes(kw.toLowerCase()))
  ) {
    return true
  }
  if (firstSheetRows && firstSheetRows.length > 0 && firstRowsHaveSfeHeaderDna(firstSheetRows)) {
    return true
  }
  return false
}

function mapLoadFactor(raw: unknown): LoadFactor | undefined {
  const key = normalizeUpper(raw)
  if (key === 'HI') return LOAD_FACTOR_MAP.HIGH
  if (key === 'MED') return LOAD_FACTOR_MAP.MEDIUM
  if (key === 'LO') return LOAD_FACTOR_MAP.LOW
  return LOAD_FACTOR_MAP[key]
}

function mapGhostUtilities(tdspRaw: unknown): Utility[] {
  const normalizedTdsp = normalizeUpper(tdspRaw)
  if (!normalizedTdsp) {
    return []
  }

  if (normalizedTdsp.includes('AEP')) {
    return [UTILITY_MAP.AEP_CENTRAL, UTILITY_MAP.AEP_NORTH]
  }

  if (normalizedTdsp.includes('CENTERPOINT') || normalizedTdsp.includes('ONCOR')) {
    return [UTILITY_MAP.CENTERPOINT, UTILITY_MAP.ONCOR]
  }

  const mappedUtility = UTILITY_MAP[normalizedTdsp]
  if (mappedUtility) {
    return [mappedUtility]
  }

  return []
}

export function extractSfeEffectiveDate(
  sheets: Readonly<Record<string, unknown[][]>>,
  fileName?: string,
): string | null {
  const rows = sheets[SFE_SHEET_NAME]
  const cellValue = rows?.[2]?.[3]
  const fallbackCellValue = rows?.[2]?.[4]
  const resolvedCellValue =
    cellValue !== null && cellValue !== undefined && String(cellValue).trim() !== '' ? cellValue : fallbackCellValue
  const fromSheet = toIsoYmdFromUnknown(resolvedCellValue)
  if (fromSheet) {
    return fromSheet
  }

  if (fileName) {
    const dateMatch = fileName.match(
      /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s(\d{1,2}),\s(\d{4})/i,
    )
    if (dateMatch) {
      const monthMap: Record<string, string> = {
        jan: '01',
        feb: '02',
        mar: '03',
        apr: '04',
        may: '05',
        jun: '06',
        jul: '07',
        aug: '08',
        sep: '09',
        oct: '10',
        nov: '11',
        dec: '12',
      }
      const month = monthMap[dateMatch[1].toLowerCase()]
      const day = dateMatch[2].padStart(2, '0')
      const year = dateMatch[3]
      if (month) {
        return `${year}-${month}-${day}`
      }
    }
  }

  return null
}

export function parseSfeSilo(
  sheets: Readonly<Record<string, unknown[][]>>,
  _fileName: string,
  fallbackEffectiveDate: string,
): Rate[] {
  const rows = sheets[SFE_SHEET_NAME]
  if (!rows) {
    return []
  }

  const headerRow = rows[SFE_HEADER_ROW_INDEX] ?? []
  const tdspHeader = String(headerRow[SFE_COL_INDEX.tdsp] ?? '').toUpperCase().trim()
  const zoneHeader = String(headerRow[SFE_COL_INDEX.zone] ?? '').toUpperCase().trim()
  const loadFactorHeader = String(headerRow[SFE_COL_INDEX.loadFactor] ?? '').toUpperCase()
  console.log('SFE Debug - Row 15, Col 2 (TDSP):', rows[15]?.[2])
  console.log('SFE Debug: Now checking Row 16 for Headers and Row 3 for Date')
  if (
    !tdspHeader.includes('TDSP') ||
    !zoneHeader.includes('ZONE') ||
    !loadFactorHeader.includes('FACTOR')
  ) {
    throw new Error(
      `CRITICAL: SFE header DNA mismatch at row ${SFE_HEADER_ROW_INDEX}. Expected TDSP/Load Zone/Load Factor.`,
    )
  }

  const effectiveDatePrimaryCell = rows[2]?.[3]
  const effectiveDateFallbackCell = rows[2]?.[4]
  const effectiveDateCell =
    effectiveDatePrimaryCell !== null &&
    effectiveDatePrimaryCell !== undefined &&
    String(effectiveDatePrimaryCell).trim() !== ''
      ? effectiveDatePrimaryCell
      : effectiveDateFallbackCell
  const effectiveDate = toIsoYmdFromUnknown(effectiveDateCell) ?? fallbackEffectiveDate.trim()
  if (!effectiveDate) {
    throw new Error('SFE parser: effectiveDate is required.')
  }

  const results: Rate[] = []
  let rawRowCount = 0
  for (let i = SFE_DATA_START_ROW_INDEX; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length < 5) continue

    // Normalize inputs to prevent UI duplicates (e.g., Houston vs HOUSTON)
    const rawZone = normalizeUpper(row[SFE_COL_INDEX.zone])
    const rawTdsp = normalizeUpper(row[SFE_COL_INDEX.tdsp])

    const normalizedZone = ZONE_MAP[rawZone] || rawZone

    // Normalize Start Date (Fixing the "Weird Date" format)
    const rawDate = row[SFE_COL_INDEX.startDate]
    let cleanStartDate = ''
    if (typeof rawDate === 'number' && Number.isFinite(rawDate)) {
      const ms = (rawDate - 25569) * 86400_000
      const excelDate = new Date(ms)
      cleanStartDate = Number.isNaN(excelDate.getTime()) ? '' : excelDate.toISOString().split('T')[0]
    } else if (rawDate instanceof Date) {
      cleanStartDate = rawDate.toISOString().split('T')[0]
    } else if (rawDate) {
      cleanStartDate = String(rawDate).trim().split(' ')[0]
    }

    const term = Number(row[SFE_COL_INDEX.term])
    const priceRaw = String(row[SFE_COL_INDEX.price] ?? '').trim()
    const loadFactor = mapLoadFactor(row[SFE_COL_INDEX.loadFactor])
    if (!cleanStartDate || !normalizedZone || !Number.isFinite(term) || term <= 0 || !priceRaw || !loadFactor) {
      continue
    }

    const numericPrice = Number(priceRaw.replace(/[$,\s]/g, ''))
    if (!Number.isFinite(numericPrice)) {
      continue
    }

    const utilities = mapGhostUtilities(rawTdsp)
    if (utilities.length === 0) {
      continue
    }

    rawRowCount += 1
    const ratePerKwh = toCanonicalDollarsPerKwh(numericPrice, 'CENTS_KWH')
    for (const utility of utilities) {
      const rate: Rate = {
        supplier: 'SFE',
        utility,
        zone: normalizedZone,
        startDate: cleanStartDate,
        ratePerKwh,
        effectiveDate,
        term,
        loadFactor,
        productType: matrixProductKeyToRateProduct(),
        minUsageKwh: 0,
        maxUsageKwh: 500000,
      }

      results.push(rate)
    }
  }

  console.log('[SFE Parser] Effective Date Extracted:', effectiveDate)
  console.log('[SFE Parser] Raw Rows Processed:', rawRowCount)
  console.log('[SFE Parser] Total Records Generated (including Ghost Entries):', results.length)
  console.log('[SFE Parser] First Sample Record:', results[0])

  return results
}
