import type { LoadFactor, Rate, Utility } from '../../../types/market-data'
import { NEXTERA_MATRIX_FILENAME_KEYWORDS } from '../supplierFilenameKeywords'

const NEXTERA_SHEET_HINT = 'MATRIX'
const EXPECTED_ANCHOR_HEADERS = [
  'Utility',
  'Start Month',
  'Annual Usage Range',
  'Zone',
  'Load Factor',
  'Term',
  'Price',
] as const

const NEXTERA_UTILITY_MAP: Readonly<Record<string, Utility>> = {
  ONCOR: 'ONCOR',
  CPE: 'CENTERPOINT',
  AEPWTU: 'AEP_NORTH',
  AEPCPL: 'AEP_CENTRAL',
  TNMP: 'TNMP',
  LPL: 'LPL',
}

const NEXTERA_LOAD_FACTOR_MAP: Readonly<Record<string, LoadFactor>> = {
  HLF: 'HIGH',
  MLF: 'MEDIUM',
  LLF: 'LOW',
}

function normalizeCell(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
}

function normalizeUpper(value: unknown): string {
  return normalizeCell(value).toUpperCase()
}

function hasNexteraHeaderDna(rows: any[][]): boolean {
  if (!rows || rows.length === 0) {
    console.log('[NextEra DNA] Failed: No rows available for header verification.')
    return false
  }

  const candidateIndexes = [0, 1]
  for (const rowIndex of candidateIndexes) {
    const row = rows[rowIndex] ?? []
    const product = normalizeUpper(row[0])
    const utility = normalizeUpper(row[1])
    const term = normalizeUpper(row[2])
    const price = normalizeUpper(row[3])

    if (
      product === 'PRODUCT' &&
      utility === 'UTILITY' &&
      term === 'TERM' &&
      price === 'PRICE'
    ) {
      return true
    }
  }

  console.log(
    '[NextEra DNA] Failed: Expected header DNA at columns [0..3] as Product/Utility/Term/Price in row 0 or 1.',
  )
  return false
}

function findAnchorRowIndex(rows: unknown[][]): number {
  const fuzzyHeaders = EXPECTED_ANCHOR_HEADERS.slice(0, 3).map((header) => header.toUpperCase())

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const matches = EXPECTED_ANCHOR_HEADERS.every((header, idx) => {
      return normalizeUpper(row[idx]).trim() === header.toUpperCase().trim()
    })
    if (matches) {
      return i
    }

    const normalizedRow = row.map((cell) => normalizeUpper(cell))
    const fuzzyMatches = fuzzyHeaders.every((header) => normalizedRow.includes(header))
    if (fuzzyMatches) {
      return i
    }
  }
  return -1
}

function parseStartMonthToIso(value: unknown): string | null {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-01`
  }

  if (typeof value === 'string' && /^[A-Z][a-z]{2}\s/.test(value)) {
    const casted = new Date(value)
    if (!isNaN(casted.getTime())) {
      return `${String(casted.getFullYear()).padStart(4, '0')}-${String(casted.getMonth() + 1).padStart(2, '0')}-01`
    }
  }

  const raw = String(value ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.split(' ')[0]
  }

  const normalizedRaw = normalizeCell(value)
  if (!normalizedRaw) {
    return null
  }
  const match = /^([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(normalizedRaw)
  if (!match || !match[1] || !match[2]) {
    return null
  }
  const monthToken = match[1].toUpperCase()
  const monthMap: Readonly<Record<string, number>> = {
    JAN: 1,
    FEB: 2,
    MAR: 3,
    APR: 4,
    MAY: 5,
    JUN: 6,
    JUL: 7,
    AUG: 8,
    SEP: 9,
    OCT: 10,
    NOV: 11,
    DEC: 12,
  }
  const month = monthMap[monthToken]
  if (!month) {
    return null
  }
  const yearToken = match[2]
  const year =
    yearToken.length === 2
      ? 2000 + Number(yearToken)
      : Number(yearToken)
  if (!Number.isFinite(year)) {
    return null
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`
}

function parseUsageRangeMwhToKwhBounds(value: unknown): { minUsageKwh: number; maxUsageKwh?: number } | null {
  const raw = normalizeCell(value)
  if (!raw) {
    return null
  }
  const compact = raw.replace(/,/g, '')
  const rangeMatch = /^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/.exec(compact)
  if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
    const minMwh = Number(rangeMatch[1])
    const maxMwh = Number(rangeMatch[2])
    if (Number.isFinite(minMwh) && Number.isFinite(maxMwh)) {
      return {
        minUsageKwh: Math.round(minMwh * 1000),
        maxUsageKwh: Math.round(maxMwh * 1000),
      }
    }
  }
  const plusMatch = /^(\d+(?:\.\d+)?)\s*\+$/.exec(compact)
  if (plusMatch && plusMatch[1]) {
    const minMwh = Number(plusMatch[1])
    if (Number.isFinite(minMwh)) {
      return { minUsageKwh: Math.round(minMwh * 1000) }
    }
  }
  const exactMatch = /^(\d+(?:\.\d+)?)$/.exec(compact)
  if (exactMatch && exactMatch[1]) {
    const maxMwh = Number(exactMatch[1])
    if (Number.isFinite(maxMwh)) {
      return { minUsageKwh: 0, maxUsageKwh: Math.round(maxMwh * 1000) }
    }
  }
  return null
}

function parsePrice(value: unknown): number | null {
  const raw = normalizeCell(value)
  if (!raw) {
    return null
  }
  const parsed = Number(raw.replace(/[$,\s]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function parseTermMonths(value: unknown): number | null {
  const raw = normalizeCell(value)
  if (!raw) {
    return null
  }
  const match = /\d+/.exec(raw)
  if (!match || !match[0]) {
    return null
  }
  const term = Number(match[0])
  return Number.isFinite(term) && term > 0 ? term : null
}

export function getNexteraRequirements(): { targetSheets: readonly string[] } {
  return { targetSheets: ['*'] }
}

export function isNexteraMatrix(
  sheetNames: readonly string[],
  fileName?: string,
  rows?: unknown[][],
): boolean {
  if (sheetNames.length !== 1) {
    console.log(`[NextEra DNA] Failed: Expected 1 tab, found ${sheetNames.length}.`)
    return false
  }

  const normalizedFileName = normalizeUpper(fileName ?? '')
  const containsAtlanticMarker =
    normalizedFileName.includes('AE TEXAS') || normalizedFileName.includes('ATLANTIC')
  const containsAtlanticTab = sheetNames.some((sheetName) => {
    const normalized = normalizeUpper(sheetName)
    return normalized.includes('AE TEXAS') || normalized.includes('ATLANTIC')
  })
  if (containsAtlanticMarker || containsAtlanticTab) {
    console.log('[NextEra DNA] Failed: Atlantic/AE Texas marker found in filename or tab name.')
    return false
  }

  if (rows && rows.length > 0 && !hasNexteraHeaderDna(rows as any[][])) {
    return false
  }

  if (rows && rows.length > 0 && findAnchorRowIndex(rows) >= 0) {
    return true
  }

  const fileBase = fileName?.trim().split(/[/\\]/).pop()?.toLowerCase() ?? ''
  const fileUpper = normalizeUpper(fileName ?? '')
  if (
    fileName !== undefined &&
    fileName.length > 0 &&
    (NEXTERA_MATRIX_FILENAME_KEYWORDS.some((kw) => fileBase.includes(kw.toLowerCase())) ||
      fileUpper.includes('PRICINGMATRIX'))
  ) {
    return true
  }
  const matchedSheet = sheetNames.some((name) => {
    const normalized = normalizeUpper(name)
    return normalized === 'PRICING' || normalized.includes(normalizeUpper(NEXTERA_SHEET_HINT))
  })
  if (!matchedSheet) {
    console.log(`[NextEra DNA] Failed: No matching matrix sheet found. Checked sheets: ${sheetNames.join(', ') || '(none)'}`)
  }
  return matchedSheet
}

export function parseNexteraSilo(
  sheets: Readonly<Record<string, unknown[][]>>,
  effectiveDate: string,
): Rate[] {
  const out: Rate[] = []
  const unknownMappings: string[] = []
  let ingestedCount = 0;
  let skippedMissing = 0;
  let skippedNueces = 0;
  const prices: number[] = [];
  const utilityCounts: Record<string, number> = {};

  for (const [sheetName, rows] of Object.entries(sheets)) {
    const anchorIndex = findAnchorRowIndex(rows)
    if (anchorIndex < 0) {
      continue
    }
    for (let rowIndex = anchorIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] ?? []
      const utilityRaw = normalizeUpper(row[0])
      const startMonthRaw = normalizeCell(row[1])
      const usageRaw = normalizeCell(row[2])
      const zone = normalizeCell(row[3])
      const loadFactorRaw = normalizeUpper(row[4])
      const term = parseTermMonths(row[5])
      const price = parsePrice(row[6])

      if (!utilityRaw && !startMonthRaw && !usageRaw && !zone && !loadFactorRaw) {
        continue
      }
      if (utilityRaw === 'NUECES COOP') {
        skippedNueces += 1
        continue
      }

      const utility = NEXTERA_UTILITY_MAP[utilityRaw]
      const loadFactor = NEXTERA_LOAD_FACTOR_MAP[loadFactorRaw]
      const startDate = parseStartMonthToIso(startMonthRaw)
      const usageBounds = parseUsageRangeMwhToKwhBounds(usageRaw)

      if (!utility) {
        unknownMappings.push(`Unknown utility "${utilityRaw}" on sheet "${sheetName}".`)
        continue
      }
      if (!loadFactor) {
        unknownMappings.push(`Unknown load factor "${loadFactorRaw}" on sheet "${sheetName}".`)
        continue
      }
      if (!startDate) {
        unknownMappings.push(`Invalid start month "${startMonthRaw}" on sheet "${sheetName}".`)
        continue
      }
      if (!usageBounds) {
        unknownMappings.push(`Invalid usage range "${usageRaw}" on sheet "${sheetName}".`)
        continue
      }
      if (!zone || term === null || price === null) {
        skippedMissing += 1
        continue
      }

      out.push({
        supplier: 'NextEra',
        utility,
        loadFactor,
        startDate,
        effectiveDate,
        ratePerKwh: price,
        zone,
        term,
        minUsageKwh: usageBounds.minUsageKwh,
        maxUsageKwh: usageBounds.maxUsageKwh,
        productType: 'ALL_IN',
      } satisfies Rate)
      ingestedCount += 1
      prices.push(price)
      utilityCounts[utility] = (utilityCounts[utility] ?? 0) + 1
    }
  }

  const sum = prices.reduce((a, b) => a + b, 0);
  const avg = sum / prices.length || 0;
  
  console.log("%c [Ingest Success] - NextEra", "color: #00FFFF; font-weight: bold;");
  console.log(`✅ Ingested Rates: ${ingestedCount}`);
  console.log(`❌ Skipped (Total): ${skippedMissing + skippedNueces}`);
  console.log(`    - Missing/NA Cells: ${skippedMissing}`);
  console.log(`    - Nueces Coop (Filtered): ${skippedNueces}`);
  console.log("\n[Utility Reconciliation Ledger]");
  console.log(utilityCounts);
  console.log(`\nRates Summary - Min: ${Math.min(...prices)}, Max: ${Math.max(...prices)}, Avg: ${avg.toFixed(4)}, Sum: ${sum.toFixed(2)}`);

  if (unknownMappings.length > 0) {
    throw new Error(`NextEra mapping reject: ${unknownMappings[0]}`)
  }

  return out
}
