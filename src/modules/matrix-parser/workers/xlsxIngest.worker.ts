/// <reference lib="webworker" />
import * as XLSX from 'xlsx'

export type XlsxIngestRequest = {
  readonly kind: 'parse'
  readonly buffer: ArrayBuffer
  readonly targetSheets: readonly string[]
}

export type XlsxIngestPayload = {
  readonly sheets: Readonly<Record<string, unknown[][]>>
}

export type XlsxIngestResponse =
  | { readonly kind: 'parsed'; readonly payload: XlsxIngestPayload }
  | { readonly kind: 'error'; readonly message: string }

const readBaseOpts = {
  type: 'array' as const,
  cellFormula: false as const,
  cellDates: true as const,
}
const MATRIX_PRICES_ALL_SHEET = 'matrix prices_all'
/** Must match NRG `DATA_ANCHOR` in `nrgParser.ts` (header row discovery). */
const NRG_DATA_ANCHOR = 'START_DATE'

function normalizeNrgAnchorCell(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase()
}

function findNrgHeaderRowIndex(rawData: unknown[][]): number {
  return rawData.findIndex(
    (row) =>
      Array.isArray(row) &&
      row.some((cell) => {
        const normalized = normalizeNrgAnchorCell(cell)
        return normalized === NRG_DATA_ANCHOR || normalized === 'STARTDATE'
      }),
  )
}

function post(res: XlsxIngestResponse) {
  ;(self as DedicatedWorkerGlobalScope).postMessage(res)
}

function sheetToGrid(name: string, sh: XLSX.WorkSheet): unknown[][] {
  const rawData = XLSX.utils.sheet_to_json<unknown[]>(sh, {
    header: 1,
    defval: null,
    raw: true,
  }) as unknown[][]

  if (name.toLowerCase() === MATRIX_PRICES_ALL_SHEET) {
    console.log('%c [X-RAY] RAW ROWS 0-20:', 'color: #0ff; background: #000', rawData.slice(0, 20))
    const headersRowIndex = findNrgHeaderRowIndex(rawData)
    console.log('[X-RAY] Target Anchor Search Result:', headersRowIndex)
  }

  return rawData
}

;(self as DedicatedWorkerGlobalScope).onmessage = (ev: MessageEvent<XlsxIngestRequest>) => {
  try {
    const { buffer, targetSheets } = ev.data
    const wb = XLSX.read(buffer, {
      ...readBaseOpts,
      sheets: [...targetSheets],
    })

    const sheets: Record<string, unknown[][]> = {}
    for (const name of targetSheets) {
      const sh = wb.Sheets[name]
      if (!sh) {
        continue
      }
      sheets[name] = sheetToGrid(name, sh)
    }

    post({
      kind: 'parsed',
      payload: { sheets },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Excel parse failed'
    post({ kind: 'error', message })
  }
}
