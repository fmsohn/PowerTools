/// <reference lib="webworker" />
import type { Rate } from '@/types/market-data'

export type DataTransferRequest =
  | {
      readonly kind: 'export:chunk'
      readonly rates: Rate[]
      readonly isFirst: boolean
      readonly isLast: boolean
    }
  | { readonly kind: 'import:prepare'; readonly payload: ArrayBuffer; readonly filename: string }
  | { readonly kind: 'import:consume'; readonly chunkSize: number }

export type DataTransferResponse =
  | { readonly kind: 'export:chunk'; readonly chunkCount: number; readonly blob?: Blob }
  | { readonly kind: 'import:prepared'; readonly total: number }
  | { readonly kind: 'import:chunk'; readonly rates: Rate[]; readonly processed: number; readonly total: number }
  | { readonly kind: 'import:complete'; readonly total: number }
  | { readonly kind: 'error'; readonly message: string }

function post(response: DataTransferResponse): void {
  ;(self as DedicatedWorkerGlobalScope).postMessage(response)
}

let preparedImportRates: Rate[] | null = null
let exportJsonWriter: WritableStreamDefaultWriter<string> | null = null
let exportCompressedBlobPromise: Promise<Blob> | null = null
let hasWrittenExportData = false

async function readStreamAsText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const response = new Response(stream)
  return response.text()
}

function resetExportState(): void {
  exportJsonWriter = null
  exportCompressedBlobPromise = null
  hasWrittenExportData = false
}

function ensureExportPipeline(): void {
  if (exportJsonWriter && exportCompressedBlobPromise) {
    return
  }

  const textEncoder = new TextEncoder()
  const jsonStream = new TransformStream<string, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(textEncoder.encode(chunk))
    },
  })

  const compressedStream = jsonStream.readable.pipeThrough(new CompressionStream('gzip'))
  exportJsonWriter = jsonStream.writable.getWriter()
  exportCompressedBlobPromise = new Response(compressedStream).blob()
}

;(self as DedicatedWorkerGlobalScope).onmessage = async (event: MessageEvent<DataTransferRequest>) => {
  try {
    if (event.data.kind === 'export:chunk') {
      const rates = event.data.rates
      const chunkText = rates.map((rate) => JSON.stringify(rate, null, 2)).join(',\n')

      if (event.data.isFirst) {
        resetExportState()
        ensureExportPipeline()
        await exportJsonWriter?.write('[\n')
      }

      if (chunkText) {
        if (hasWrittenExportData) {
          await exportJsonWriter?.write(',\n')
        }
        await exportJsonWriter?.write(chunkText)
        hasWrittenExportData = true
      }

      let blob: Blob | undefined
      if (event.data.isLast) {
        await exportJsonWriter?.write('\n]')
        await exportJsonWriter?.close()
        blob = exportCompressedBlobPromise
          ? new Blob([await exportCompressedBlobPromise], { type: 'application/gzip' })
          : undefined
        resetExportState()
      }

      post({
        kind: 'export:chunk',
        chunkCount: rates.length,
        blob,
      })
      return
    }

    if (event.data.kind === 'import:prepare') {
      const isGzip = event.data.filename.toLowerCase().endsWith('.gz')
      const sourceBlob = new Blob([event.data.payload])
      const sourceStream = sourceBlob.stream()
      const decodedText = isGzip
        ? await readStreamAsText(sourceStream.pipeThrough(new DecompressionStream('gzip')))
        : await sourceBlob.text()
      const parsed = JSON.parse(decodedText)
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('File is empty or invalid format')
      }

      preparedImportRates = parsed as Rate[]
      post({ kind: 'import:prepared', total: preparedImportRates.length })
      return
    }

    const sourceRates = preparedImportRates
    if (!sourceRates || sourceRates.length === 0) {
      throw new Error('Import was not prepared')
    }

    const chunkSize = Math.max(1, event.data.chunkSize)
    let processed = 0
    for (let index = 0; index < sourceRates.length; index += chunkSize) {
      const rates = sourceRates.slice(index, index + chunkSize)
      processed += rates.length
      post({
        kind: 'import:chunk',
        rates,
        processed,
        total: sourceRates.length,
      })
    }

    post({ kind: 'import:complete', total: sourceRates.length })
    preparedImportRates = null
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Data transfer worker failed'
    post({ kind: 'error', message })
  }
}
