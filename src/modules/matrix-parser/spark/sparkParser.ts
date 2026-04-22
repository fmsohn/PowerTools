import { toCanonicalDollarsPerKwh, UTILITY_MAP, ZONE_MAP } from '../../../constants/market-data.constants'
import { SPARK_MATRIX_FILENAME_KEYWORDS } from '../supplierFilenameKeywords'
import type { LoadFactor, Rate, Utility } from '../../../types/market-data'

const SPARK_POWER_SHEET = 'power_data'
const SPARK_IDENTITY_SHEET = 'Nat Gas R & SC'
const SPARK_IDENTITY_ROW_INDEX = 15
const SPARK_IDENTITY_COL_INDEX = 0
const SPARK_IDENTITY_TOKEN = 'Spark Energy - Major Energy'

const SPARK_UTILITY_MAP: Readonly<Record<string, Utility>> = {
  CPE: 'CENTERPOINT',
  CPL: 'AEP_CENTRAL',
  LPL: 'LPL',
  ONCOR: 'ONCOR',
  TNMP: 'TNMP',
  WTU: 'AEP_NORTH',
}
const SPARK_LOAD_FACTORS: readonly LoadFactor[] = ['LOW', 'MEDIUM', 'HIGH']

function normalizeCell(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizeUpper(value: unknown): string {
  return normalizeCell(value).toUpperCase()
}

function excelSerialToYmd(serial: number): string | null {
  if (!Number.isFinite(serial)) {
    return null
  }
  const ms = (serial - 25569) * 86400_000
  const d = new Date(ms)
  if (!Number.isFinite(d.getTime())) {
    return null
  }
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function coerceDateToIsoYmd(value: unknown): string | undefined {
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
  if (typeof value === 'number') {
    return excelSerialToYmd(value) ?? undefined
  }
  const raw = normalizeCell(value)
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

export function getSparkRequirements(): { targetSheets: readonly string[] } {
  return { targetSheets: [SPARK_POWER_SHEET, SPARK_IDENTITY_SHEET] }
}

export function isSparkMatrix(
  sheetNames: readonly string[],
  fileName?: string,
  firstSheetRows?: unknown[][],
): boolean {
  const hasRequiredTabs =
    sheetNames.includes(SPARK_POWER_SHEET) && sheetNames.includes(SPARK_IDENTITY_SHEET)
  if (hasRequiredTabs) {
    return true
  }

  const base = fileName?.trim().split(/[/\\]/).pop()?.toLowerCase() ?? ''
  if (
    fileName !== undefined &&
    fileName.length > 0 &&
    SPARK_MATRIX_FILENAME_KEYWORDS.some((kw) => base.includes(kw.toLowerCase()))
  ) {
    return true
  }

  const identityProbe =
    firstSheetRows?.[SPARK_IDENTITY_ROW_INDEX]?.[SPARK_IDENTITY_COL_INDEX] ?? ''
  if (normalizeCell(identityProbe).includes(SPARK_IDENTITY_TOKEN)) {
    return true
  }

  return false
}

export function parseSparkSilo(
  sheets: Readonly<Record<string, unknown[][]>>,
  _fileName: string,
  effectiveDate: string,
): Rate[] {
  if (!effectiveDate.trim()) {
    throw new Error('Spark parser: effectiveDate is required.')
  }
  const rows = sheets[SPARK_POWER_SHEET]
  if (!rows || rows.length < 2) {
    return []
  }

  const out: Rate[] = []
  let trueIngestionSum = 0
  let uniqueRows = 0
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? []
    const isoRegion = normalizeUpper(row[1])
    if (isoRegion !== 'ERCOT') {
      continue
    }

    const rawUtility = normalizeUpper(row[2])
    const utility = SPARK_UTILITY_MAP[rawUtility] ?? UTILITY_MAP[rawUtility]
    if (!utility) {
      continue
    }

    const rawZone = normalizeUpper(row[3])
    const zone = ZONE_MAP[rawZone] ?? rawZone
    if (!zone) {
      continue
    }

    const term = Number(row[9])
    if (!Number.isFinite(term) || term <= 0) {
      continue
    }

    const rawRate = Number(row[8])
    if (!Number.isFinite(rawRate) || rawRate <= 0) {
      continue
    }
    const ratePerKwh = toCanonicalDollarsPerKwh(rawRate, 'DOLLARS_KWH')

    const minMwh = Number(row[10])
    const maxMwh = Number(row[11])
    if (!Number.isFinite(minMwh) || !Number.isFinite(maxMwh)) {
      continue
    }
    let minUsageKwh = Math.round(minMwh * 1000)
    const maxUsageKwh = Math.round(maxMwh * 1000)
    if (minUsageKwh === 11000) {
      minUsageKwh = 0
    }

    const startDate = coerceDateToIsoYmd(row[0])
    uniqueRows += 1
    trueIngestionSum += ratePerKwh
    for (const loadFactor of SPARK_LOAD_FACTORS) {
      out.push({
        supplier: 'Spark',
        utility,
        loadFactor,
        ...(startDate ? { startDate } : {}),
        effectiveDate,
        ratePerKwh,
        zone,
        term,
        minUsageKwh,
        maxUsageKwh,
        productType: 'ALL_IN',
      } satisfies Rate)
    }
  }

  const injectedSum = trueIngestionSum * SPARK_LOAD_FACTORS.length
  console.log(
    `%c ⚡ [SPARK] INGESTION %c Unique: ${uniqueRows} | Injected: ${out.length} | True Sum: $${trueIngestionSum.toFixed(4)} | Injected Sum: $${injectedSum.toFixed(4)} | Eff: ${effectiveDate}`,
    'color: #00f2ff; font-weight: bold; background: #000; padding: 4px; border: 1px solid #00f2ff;',
    'color: #fff; background: #222; padding: 4px;',
  )
  console.table([
    {
      Supplier: 'Spark',
      'Unique Rows': uniqueRows,
      'Injected Rows': out.length,
      'Total Sum (True)': `$${trueIngestionSum.toFixed(4)}`,
      'Total Sum (Injected)': `$${injectedSum.toFixed(4)}`,
      Effective: effectiveDate,
      RateUnit: '$/kWh',
    },
  ])
  return out
}
