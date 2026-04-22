import * as XLSX from 'xlsx'
import { SUPPLIER_REGISTRY } from '../supplierRegistry'
import type { SupplierSilo } from '../supplierRegistry'
import { isRate, type Rate } from '../../../types/market-data'
import { parseXlsxInWorker } from './parseXlsxInWorker'

export type MatrixIngestResult =
  | { readonly kind: 'rates'; readonly rates: Rate[]; readonly detail: string }
  | { readonly kind: 'unknown_matrix' }
  | {
      readonly kind: 'conflict_detected'
      readonly matchingSuppliers: readonly SupplierSilo[]
      readonly sheetNames: readonly string[]
    }
  | { readonly kind: 'missing_sheets'; readonly message: string; readonly missing: readonly string[] }
  | { readonly kind: 'reject'; readonly message: string }

export interface MatrixConflictHandler {
  (
    matchingSuppliers: readonly SupplierSilo[],
    buffer: ArrayBuffer,
    sheetNames: readonly string[],
  ): void | Promise<void>
}

export interface IngestMatrixFileOptions {
  readonly buffer?: ArrayBuffer
  readonly selectedSupplierId?: string
  readonly onConflictDetected?: MatrixConflictHandler
  readonly onDateRequest?:
    | ((fileName: string, supplierName: string) => Promise<string | null | undefined> | string | null | undefined)
    | undefined
}

function isIsoYmd(value: string): boolean {
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return false
  }
  const [yRaw, mRaw, dRaw] = trimmed.split('-')
  if (!yRaw || !mRaw || !dRaw) {
    return false
  }
  const year = Number(yRaw)
  const month = Number(mRaw)
  const day = Number(dRaw)
  const dt = new Date(Date.UTC(year, month - 1, day))
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() + 1 === month &&
    dt.getUTCDate() === day
  )
}

function parseMonthNameDateToken(name: string): string | null {
  const sfeFilePattern =
    /(?:^|[^\w])(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s(\d{1,2}),\s(\d{4})(?:[^\w]|$)/i
  const match = name.match(sfeFilePattern)
  if (!match) {
    return null
  }
  const [, monthStr, dayRaw, yearRaw] = match
  if (!monthStr || !dayRaw || !yearRaw) {
    return null
  }
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
  const month = monthMap[monthStr.toLowerCase()]
  if (!month) {
    return null
  }
  const isoDate = `${yearRaw}-${month}-${dayRaw.padStart(2, '0')}`
  return isIsoYmd(isoDate) ? isoDate : null
}

/** Universal MDY (US) date tokens in filenames: `4-20-2026`, `04.20.26`, etc. */
export function extractDateFromFilename(name: string): string | null {
  const re = /(\d{4})(\d{2})(\d{2})|(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/g
  let match: RegExpExecArray | null
  while ((match = re.exec(name)) !== null) {
    let yearToken = ''
    let monthToken = ''
    let dayToken = ''

    if (match[1] && match[2] && match[3]) {
      yearToken = match[1]
      monthToken = match[2]
      dayToken = match[3]
    } else if (match[4] && match[5] && match[6]) {
      monthToken = match[4]
      dayToken = match[5]
      yearToken = match[6]
    } else {
      continue
    }

    const month = Number(monthToken)
    const day = Number(dayToken)
    let year = Number(yearToken)
    if (yearToken.length === 2 && Number.isFinite(year)) {
      year = 2000 + year
    }
    if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) {
      continue
    }
    const isoDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (isIsoYmd(isoDate)) {
      console.log(
        `%c [Date Extraction] Resolved ${isoDate} from ${name} (universal MDY)`,
        'color: #00FFFF; font-weight: bold;',
      )
      return isoDate
    }
  }
  return null
}

function fileBaseLower(fileName: string): string {
  return fileName.trim().split(/[/\\]/).pop()?.toLowerCase() ?? ''
}

function resolveSuppliersLayered(
  fileName: string,
  sheetNames: readonly string[],
  firstSheetRows: unknown[][] | undefined,
  sheetPreviews: Readonly<Record<string, unknown[][]>> | undefined,
): SupplierSilo[] {
  const filenameDate = extractDateFromFilename(fileName)
  const level1 =
    filenameDate !== null
      ? SUPPLIER_REGISTRY.filter((s) =>
          s.keywords.some((kw) => fileBaseLower(fileName).includes(kw.toLowerCase())),
        )
      : []

  if (sheetPreviews === undefined) {
    console.log('%c[Forensic Ingest] sheetPreviews is undefined before identify()', 'color:#e91e63;font-weight:bold', {
      fileName,
      sheetNames,
      firstSheetRowsDefined: firstSheetRows !== undefined,
    })
  } else {
    const previewKeys = Object.keys(sheetPreviews)
    const previewCounts = previewKeys.map((k) => [k, (sheetPreviews[k] ?? []).length] as const)
    console.log('%c[Forensic Ingest] handoff to supplier.identify()', 'color:#e91e63;font-weight:bold', {
      fileName,
      sheetNames: [...sheetNames],
      sheetPreviewKeys: previewKeys,
      rowCountsBySheet: Object.fromEntries(previewCounts),
    })
  }

  const dnaMatches = SUPPLIER_REGISTRY.filter((supplier) =>
    supplier.identify(sheetNames, fileName, firstSheetRows, sheetPreviews),
  )

  if (level1.length === 1) {
    const primary = level1[0]!
    if (dnaMatches.includes(primary)) {
      return [primary]
    }
    if (dnaMatches.length > 0) {
      return dnaMatches
    }
    return [primary]
  }

  return dnaMatches
}

export function extractDateFromFileName(name: string): string | null {
  const monthNameDate = parseMonthNameDateToken(name)
  if (monthNameDate) {
    console.log(
      `%c [Date Extraction] Resolved ${monthNameDate} from ${name} (month-name token)`,
      'color: #00FFFF; font-weight: bold;',
    )
    return monthNameDate
  }

  const ymd = /(?:^|[^\d])(\d{4})\.(\d{2})\.(\d{2})(?:[^\d]|$)/.exec(name)
  if (ymd && ymd[1] && ymd[2] && ymd[3]) {
    const isoDate = `${ymd[1]}-${ymd[2]}-${ymd[3]}`
    if (isIsoYmd(isoDate)) {
      console.log(
        `%c [Date Extraction] Resolved ${isoDate} from ${name}`,
        'color: #00FFFF; font-weight: bold;',
      )
      return isoDate
    }
  }

  const universal = extractDateFromFilename(name)
  if (universal) {
    return universal
  }

  const mdy = /(?:^|[^\d])(\d{2})-(\d{2})-(\d{4})(?:[^\d]|$)/.exec(name)
  if (mdy && mdy[1] && mdy[2] && mdy[3]) {
    const isoDate = `${mdy[3]}-${mdy[1]}-${mdy[2]}`
    if (isIsoYmd(isoDate)) {
      console.log(
        `%c [Date Extraction] Resolved ${isoDate} from ${name}`,
        'color: #00FFFF; font-weight: bold;',
      )
      return isoDate
    }
  }

  const mmddyyyy = /(?:^|[^\d])(\d{2})(\d{2})(\d{4})/.exec(name)
  if (mmddyyyy && mmddyyyy[1] && mmddyyyy[2] && mmddyyyy[3]) {
    const compactIsoDate = `${mmddyyyy[3]}-${mmddyyyy[1]}-${mmddyyyy[2]}`
    if (isIsoYmd(compactIsoDate)) {
      console.log(
        `%c [Date Extraction] Resolved ${compactIsoDate} from ${name}`,
        'color: #00FFFF; font-weight: bold;',
      )
      return compactIsoDate
    }
  }

  console.warn(`[Date Extraction] Failed to resolve date from filename: ${name}`)
  return null
}

function normalizeRequestedDateToIso(value: string): string | null {
  const trimmed = value.trim()
  if (isIsoYmd(trimmed)) {
    return trimmed
  }
  const mdy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(trimmed)
  if (!mdy || !mdy[1] || !mdy[2] || !mdy[3]) {
    return null
  }
  const isoDate = `${mdy[3]}-${mdy[1]}-${mdy[2]}`
  return isIsoYmd(isoDate) ? isoDate : null
}

function normalizeRatesEffectiveDate(rates: Rate[], effectiveDate: string): Rate[] {
  if (!isIsoYmd(effectiveDate)) {
    throw new Error('Resolved effective date is invalid.')
  }
  return rates.map((r) => ({
    ...r,
    effectiveDate,
  }))
}

function normalizeJsonRatesEffectiveDate(rows: unknown[], effectiveDate: string): unknown[] {
  if (!isIsoYmd(effectiveDate)) {
    throw new Error('Resolved effective date is invalid.')
  }
  return rows.map((row): unknown => {
    if (typeof row !== 'object' || row === null) {
      return row
    }
    const r = row as Record<string, unknown>
    return { ...r, effectiveDate }
  })
}

function findWorkbookSheetName(requested: string, sheetNames: readonly string[]): string | null {
  for (const sheetName of sheetNames) {
    if (sheetName === requested) {
      return sheetName
    }
  }
  return null
}

function parseSupplierWorkbook(
  supplier: SupplierSilo,
  sheets: Readonly<Record<string, unknown[][]>>,
  fileName: string,
  effectiveDate: string,
): Rate[] {
  return supplier.parse(sheets as Record<string, unknown[][]>, fileName, effectiveDate)
}

function extractChariotDateFromWorkbookPreview(sheetPreviews: Readonly<Record<string, unknown[][]>>): string | null {
  const presentationSheet = sheetPreviews.PresentationSheet
  if (!presentationSheet) {
    return null
  }
  const rawCell = presentationSheet[9]?.[0]
  if (typeof rawCell !== 'string') {
    return null
  }
  const match = /expires at 5PM CST on (\d{1,2})\/(\d{1,2})\/(\d{4})\):/i.exec(rawCell)
  if (!match || !match[1] || !match[2] || !match[3]) {
    return null
  }
  const isoDate = `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`
  return isIsoYmd(isoDate) ? isoDate : null
}

async function resolveEffectiveDate(
  file: File,
  supplier: SupplierSilo | null,
  sheets: Readonly<Record<string, unknown[][]>>,
  sheetPreviews: Readonly<Record<string, unknown[][]>>,
  onDateRequest?: IngestMatrixFileOptions['onDateRequest'],
): Promise<string> {
  let supplierReason = ''
  const fromSupplier = supplier?.extractEffectiveDate?.(sheets, file.name) ?? null
  if (typeof fromSupplier === 'string' && isIsoYmd(fromSupplier)) {
    return fromSupplier
  }
  if (typeof fromSupplier === 'string' && fromSupplier.trim()) {
    supplierReason = fromSupplier.trim()
  } else if (fromSupplier !== null && fromSupplier !== undefined) {
    supplierReason = `${supplier?.name ?? 'Supplier'} Date Regex Failed`
  }

  const fromFileName = extractDateFromFileName(file.name)
  if (fromFileName) {
    return fromFileName
  }

  if (supplier?.id === 'chariot') {
    const fromWorkbook = extractChariotDateFromWorkbookPreview(sheetPreviews)
    if (fromWorkbook) {
      console.log(
        `%c [Date Extraction] Resolved ${fromWorkbook} from Chariot PresentationSheet metadata`,
        'color: #00FFFF; font-weight: bold;',
      )
      return fromWorkbook
    }
    throw new Error('[Date Extraction] Failed to resolve date from filename.')
  }

  if (!onDateRequest) {
    if (supplierReason) {
      throw new Error(supplierReason)
    }
    throw new Error('Effective date missing and no date request handler was provided.')
  }

  const supplierLabel = supplier?.name ?? 'Unknown Supplier'
  const requested = await onDateRequest(
    file.name,
    `${supplierLabel} (date not found in filename, and supplier extraction failed)`,
  )
  const requestedDate = typeof requested === 'string' ? requested.trim() : ''
  if (!requestedDate) {
    throw new Error('Import Aborted: Pricing date is required.')
  }
  const normalizedRequestedDate = normalizeRequestedDateToIso(requestedDate)
  if (!normalizedRequestedDate) {
    throw new Error('Manual date entry must be ISO (YYYY-MM-DD) or MM-DD-YYYY.')
  }
  return normalizedRequestedDate
}

export async function ingestMatrixFile(
  file: File,
  options: IngestMatrixFileOptions = {},
): Promise<MatrixIngestResult> {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.json')) {
    try {
      const text = await file.text()
      const parsed: unknown = JSON.parse(text)
      if (!Array.isArray(parsed)) {
        return { kind: 'reject', message: 'JSON root must be an array of matrix rows.' }
      }
      const effectiveDate =
        extractDateFromFileName(file.name) ??
        normalizeRequestedDateToIso((await options.onDateRequest?.(file.name, 'JSON Import'))?.trim() ?? '') ??
        ''
      if (!effectiveDate) {
        return { kind: 'reject', message: 'Import Aborted: Pricing date is required.' }
      }
      if (!isIsoYmd(effectiveDate)) {
        return { kind: 'reject', message: 'Manual date entry must be ISO (YYYY-MM-DD) or MM-DD-YYYY.' }
      }
      const normalizedJson = normalizeJsonRatesEffectiveDate(parsed, effectiveDate)
      if (!normalizedJson.every(isRate)) {
        return {
          kind: 'reject',
          message:
            'Each JSON row must already be a normalized rate shape (supplier, utility, loadFactor, effectiveDate, ratePerKwh in $/kWh, zone, term, usage, productType).',
        }
      }
      const rates = normalizedJson as Rate[]
      if (rates.length === 0) {
        return {
          kind: 'reject',
          message: 'No normalized rates found in JSON payload.',
        }
      }
      return {
        kind: 'rates',
        rates,
        detail: `Loaded ${rates.length} rate row(s) from “${file.name}”.`,
      }
    } catch {
      return { kind: 'reject', message: 'Could not read or parse that file as JSON.' }
    }
  }

  if (!/\.(xlsx|xlsm|csv)$/i.test(file.name)) {
    return {
      kind: 'reject',
      message: 'Drop a matrix workbook (.xlsx, .xlsm, .csv) or a JSON pivot export.',
    }
  }

  const buffer = options.buffer ?? (await file.arrayBuffer())
  const wb = XLSX.read(buffer, { type: 'array', sheetRows: 20 })
  console.log('[Sentry] Found Sheets:', wb.SheetNames)
  const sheetNames = wb.SheetNames ?? []
  const firstSheetName = sheetNames[0]
  const firstSheet = firstSheetName ? wb.Sheets[firstSheetName] : undefined
  const firstSheetRows = firstSheet
    ? (XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as unknown[][])
    : undefined
  const sheetPreviews: Record<string, unknown[][]> = {}
  for (const name of sheetNames) {
    const sh = wb.Sheets[name]
    if (sh) {
      sheetPreviews[name] = XLSX.utils.sheet_to_json(sh, { header: 1 }) as unknown[][]
    }
  }
  const matchingSuppliers = resolveSuppliersLayered(file.name, sheetNames, firstSheetRows, sheetPreviews)
  if (matchingSuppliers.length === 0) {
    console.error('[Sentry] Unknown Matrix. No DNA match for sheets:', wb.SheetNames)
    return { kind: 'unknown_matrix' }
  }

  if (!options.selectedSupplierId && matchingSuppliers.length > 1) {
    await options.onConflictDetected?.(matchingSuppliers, buffer, sheetNames)
    return {
      kind: 'conflict_detected',
      matchingSuppliers,
      sheetNames,
    }
  }

  const supplier =
    (options.selectedSupplierId
      ? matchingSuppliers.find((candidate) => candidate.id === options.selectedSupplierId)
      : matchingSuppliers[0]) ?? null
  if (!supplier) {
    return { kind: 'unknown_matrix' }
  }

  const { targetSheets } = supplier.getReqs()
  if (targetSheets.length === 0) {
    return { kind: 'unknown_matrix' }
  }

  const resolvedTargetSheets: string[] = []
  const missingSheets: string[] = []
  for (const requestedSheet of targetSheets) {
    if (requestedSheet === '*') {
      resolvedTargetSheets.push(...sheetNames)
      continue
    }
    const resolvedSheet = findWorkbookSheetName(requestedSheet, sheetNames)
    if (resolvedSheet) {
      resolvedTargetSheets.push(resolvedSheet)
    } else {
      missingSheets.push(requestedSheet)
    }
  }
  if (missingSheets.length > 0) {
    return {
      kind: 'missing_sheets',
      message: `Required tab(s) missing from workbook: ${missingSheets.join(', ')}.`,
      missing: missingSheets,
    }
  }

  try {
    const xlsx = await parseXlsxInWorker(buffer, resolvedTargetSheets)
    const { sheets } = xlsx.payload
    const effectiveDate = await resolveEffectiveDate(
      file,
      supplier,
      sheets,
      sheetPreviews,
      options.onDateRequest,
    )
    const rates = normalizeRatesEffectiveDate(
      parseSupplierWorkbook(supplier, sheets, file.name, effectiveDate),
      effectiveDate,
    )
    if (rates.length === 0) {
      return {
        kind: 'reject',
        message: 'Matrix matched, but no rates were produced — check anchors and term columns.',
      }
    }

    return {
      kind: 'rates',
      rates,
      detail:
        supplier.id === 'nextera'
          ? `Success: Imported ${rates.length} NextEra rates (Excluding Nueces Coop).`
          : `Loaded ${rates.length} rate row(s) from “${file.name}” (${supplier.id}) for ${effectiveDate}.`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown ingestion error.'
    return {
      kind: 'reject',
      message,
    }
  }
}
