import { LOAD_FACTOR_MAP, toCanonicalDollarsPerKwh, UTILITY_MAP } from '../../constants/market-data.constants'
import type { LoadFactor, Rate, Utility } from '../../types/market-data'

const CHARIOT_DATA_SHEET = 'Data-ECRSINCLUDED'
const CHARIOT_PRESENTATION_SHEET = 'PresentationSheet'
const CHARIOT_SUPPLIER_KEY = 'ChariotEnergy'

const CHARIOT_HEADER_EXPECTATIONS: ReadonlyArray<readonly [colIndex: number, label: string]> = [
  [1, 'TDSP'],
  [2, 'ZoneHub'],
  [3, 'Profile'],
  [5, 'UsageBand'],
  [6, 'Term'],
  [7, 'Price'],
] as const

const CHARIOT_COL = {
  tdsp: 1,
  zoneHub: 2,
  profile: 3,
  usageBand: 5,
  term: 6,
  price: 7,
} as const

const SKIP_PROFILES = new Set(['BUSNODEM', 'NMLIGHT'])

/** Row 10 Col A on PresentationSheet: "Pricing (expires at ... MM/DD/YYYY)" */
const PRESENTATION_PRICING_EXPIRES_DATE =
  /Pricing\s*\([^)]*expires\s+at[^)]*?(\d{1,2})\/(\d{1,2})\/(\d{4})/i

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

function extractChariotFilenameDateIso(fileName: string): string | null {
  const re = /(\d{4})(\d{2})(\d{2})|(\d{1,2})[.-](\d{1,2})[.-](\d{2,4})/g
  let match: RegExpExecArray | null
  while ((match = re.exec(fileName)) !== null) {
    let year: number
    let month: number
    let day: number
    if (match[1] && match[2] && match[3]) {
      year = Number(match[1])
      month = Number(match[2])
      day = Number(match[3])
    } else if (match[4] && match[5] && match[6]) {
      month = Number(match[4])
      day = Number(match[5])
      year = Number(match[6])
      if (year < 100) {
        year = 2000 + year
      }
    } else {
      continue
    }
    if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) {
      continue
    }
    const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (isIsoYmd(iso)) {
      return iso
    }
  }
  return null
}

function extractPresentationSheetExpiryDateIso(presentationRows: unknown[][] | undefined): string | null {
  if (!presentationRows || presentationRows.length < 10) {
    return null
  }
  const cell = String(presentationRows[9]?.[0] ?? '').trim()
  const m = PRESENTATION_PRICING_EXPIRES_DATE.exec(cell)
  if (!m || !m[1] || !m[2] || !m[3]) {
    return null
  }
  const month = Number(m[1])
  const day = Number(m[2])
  const year = Number(m[3])
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) {
    return null
  }
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return isIsoYmd(iso) ? iso : null
}

function findSheetRowsCaseInsensitive(
  sheets: Readonly<Record<string, unknown[][]>>,
  target: string,
): unknown[][] | undefined {
  const t = target.trim().toLowerCase()
  for (const [name, rows] of Object.entries(sheets)) {
    if (name.trim().toLowerCase() === t) {
      return rows
    }
  }
  return undefined
}

function presentationSheetRowsFromPreviews(
  sheetPreviews: Readonly<Record<string, unknown[][]>> | undefined,
): unknown[][] | undefined {
  if (!sheetPreviews) {
    return undefined
  }
  for (const [name, rows] of Object.entries(sheetPreviews)) {
    if (name.trim().toLowerCase() === CHARIOT_PRESENTATION_SHEET.toLowerCase()) {
      return rows
    }
  }
  return undefined
}

function cellC20ContainsChariot(rows: unknown[][] | undefined): boolean {
  if (!rows || rows.length < 19) {
    return false
  }
  // Excel row 19, column C (0-based row 18, col 2)
  const marker = String(rows[18]?.[2] ?? '')
  return marker.toLowerCase().includes('chariot')
}

function mapUtility(raw: unknown): Utility | undefined {
  const key = normalizeUpper(raw)
  if (key === 'AEPTCC') return UTILITY_MAP.AEP_CENTRAL
  if (key === 'AEPTNC') return UTILITY_MAP.AEP_NORTH
  if (key === 'CNPT') return UTILITY_MAP.CENTERPOINT
  if (key === 'LPL') return UTILITY_MAP.LPL
  if (key === 'ONCOR') return UTILITY_MAP.ONCOR
  if (key === 'TNMP') return UTILITY_MAP.TNMP
  return undefined
}

function mapLoadProfile(raw: unknown): LoadFactor | undefined {
  const key = normalizeUpper(raw)
  if (key === 'BUSHILF') return LOAD_FACTOR_MAP.HIGH
  if (key === 'BUSMEDLF') return LOAD_FACTOR_MAP.MEDIUM
  if (key === 'BUSLOLF') return LOAD_FACTOR_MAP.LOW
  return undefined
}

function parseUsageBandRange(raw: unknown): { minUsageKwh: number; maxUsageKwh: number } | null {
  const s = String(raw ?? '').trim()
  const m = /(\d[\d,]*)\s*to\s*(\d[\d,]*)/i.exec(s)
  if (!m || !m[1] || !m[2]) {
    return null
  }
  const minUsageKwh = Number(m[1].replace(/,/g, ''))
  const maxUsageKwh = Number(m[2].replace(/,/g, ''))
  if (!Number.isFinite(minUsageKwh) || !Number.isFinite(maxUsageKwh)) {
    return null
  }
  return { minUsageKwh, maxUsageKwh }
}

function parseTermMonths(raw: unknown): number | null {
  const s = String(raw ?? '').trim()
  const m = /(\d{1,2})/.exec(s)
  if (!m || !m[1]) {
    return null
  }
  const term = Number(m[1])
  return Number.isFinite(term) ? term : null
}

function validateChariotHeaderRow(row: unknown[] | undefined): boolean {
  if (!row) {
    return false
  }
  for (const [colIndex, label] of CHARIOT_HEADER_EXPECTATIONS) {
    if (String(row[colIndex] ?? '').trim() !== label) {
      return false
    }
  }
  return true
}

export function getChariotRequirements(): { targetSheets: readonly string[] } {
  return { targetSheets: [CHARIOT_DATA_SHEET, CHARIOT_PRESENTATION_SHEET] }
}

export function isChariotMatrix(
  sheetNames: readonly string[],
  fileName?: string,
  firstSheetRows?: unknown[][],
  sheetPreviews?: Readonly<Record<string, unknown[][]>>,
): boolean {
  if (String(fileName ?? '').toLowerCase().includes('chariot')) {
    return true
  }
  const presentationRows =
    presentationSheetRowsFromPreviews(sheetPreviews) ??
    (sheetNames[0]?.trim().toLowerCase() === CHARIOT_PRESENTATION_SHEET.toLowerCase()
      ? firstSheetRows
      : undefined)
  return cellC20ContainsChariot(presentationRows)
}

export function parseChariotSilo(
  sheets: Readonly<Record<string, unknown[][]>>,
  fileName: string,
  fallbackEffectiveDate: string,
): Rate[] {
  const rows = findSheetRowsCaseInsensitive(sheets, CHARIOT_DATA_SHEET)
  if (!rows || rows.length === 0) {
    console.error(`[Chariot] Missing or empty “${CHARIOT_DATA_SHEET}” sheet.`)
    return []
  }

  const headerRow = rows[0] ?? []
  if (!validateChariotHeaderRow(headerRow)) {
    console.log(
      '%c ❌ CHARIOT HEADER MISMATCH',
      'color: #c62828; font-weight: bold; font-size: 13px;',
      'Expected Row 1: B=TDSP, C=ZoneHub, D=Profile, F=UsageBand, G=Term, H=Price (exact).',
      headerRow,
    )
    return []
  }

  const presentationRows = findSheetRowsCaseInsensitive(sheets, CHARIOT_PRESENTATION_SHEET)
  const effectiveDate =
    extractChariotFilenameDateIso(fileName)?.trim() ||
    extractPresentationSheetExpiryDateIso(presentationRows)?.trim() ||
    fallbackEffectiveDate.trim()
  if (!effectiveDate || !isIsoYmd(effectiveDate)) {
    console.error('[Chariot] Invalid effective date after filename / fallback resolution.')
    return []
  }

  const records: Rate[] = []
  let rawRowCount = 0
  let totalRateSum = 0

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const rawTdsp = row[CHARIOT_COL.tdsp]
    const rawZone = row[CHARIOT_COL.zoneHub]
    const rawProfile = row[CHARIOT_COL.profile]
    const rawUsage = row[CHARIOT_COL.usageBand]
    const rawTerm = row[CHARIOT_COL.term]
    const rawPrice = row[CHARIOT_COL.price]

    const rowHasSignal = [rawTdsp, rawZone, rawProfile, rawUsage, rawTerm, rawPrice].some((cell) =>
      String(cell ?? '').trim(),
    )
    if (!rowHasSignal) {
      continue
    }

    rawRowCount += 1

    const profileKey = normalizeUpper(rawProfile)
    if (SKIP_PROFILES.has(profileKey)) {
      continue
    }

    const utility = mapUtility(rawTdsp)
    const loadFactor = mapLoadProfile(rawProfile)
    const usage = parseUsageBandRange(rawUsage)
    const term = parseTermMonths(rawTerm)
    if (!utility || !loadFactor || !usage || term === null) {
      continue
    }

    const numericPrice = Number(String(rawPrice ?? '').replace(/[$,\s]/g, ''))
    if (!Number.isFinite(numericPrice)) {
      continue
    }

    const ratePerKwh = toCanonicalDollarsPerKwh(numericPrice, 'DOLLARS_KWH')
    totalRateSum += ratePerKwh

    records.push({
      supplier: CHARIOT_SUPPLIER_KEY,
      utility,
      zone: normalizeUpper(rawZone),
      loadFactor,
      effectiveDate,
      ratePerKwh,
      term,
      minUsageKwh: usage.minUsageKwh,
      maxUsageKwh: usage.maxUsageKwh,
      productType: 'ALL_IN',
    } satisfies Rate)
  }

  console.log(
    `%c Chariot Energy — records: ${records.length} | raw rows processed: ${rawRowCount} | sum of rates ingested: ${totalRateSum.toFixed(6)} $/kWh`,
    'background: #ff6b00; color: #fff; font-weight: bold; padding: 4px 10px; border-radius: 4px;',
  )

  return records
}
