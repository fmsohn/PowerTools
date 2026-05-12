import { useCallback, useMemo, useState } from 'react'
import {
  appendRatesChunk,
  clearAllRates,
  countRates,
  setMetadata,
  initDB,
  isDatabaseReady,
  iterateRatesInChunks,
} from '@/lib/db'
import type {
  DataTransferRequest,
  DataTransferResponse,
} from '@/logic/transfer/dataTransfer.worker'

interface TransferProgress {
  readonly processed: number
  readonly total: number
  readonly percent: number
  readonly phase?: 'processing' | 'compressing' | 'decompressing'
}

interface UseDataTransferResult {
  readonly isExporting: boolean
  readonly isImporting: boolean
  readonly exportProgress: TransferProgress | null
  readonly importProgress: TransferProgress | null
  readonly exportBackup: () => Promise<void>
  readonly importBackup: (file: File) => Promise<void>
}

const EXPORT_CHUNK_SIZE = 1000
const IMPORT_CHUNK_SIZE = 5000
const DISK_OR_DB_ERROR_MESSAGE = 'DISK FULL or DATABASE ERROR'

function createTransferWorker(): Worker {
  return new Worker(new URL('./dataTransfer.worker.ts', import.meta.url), {
    type: 'module',
  })
}

function calculateProgress(
  processed: number,
  total: number,
  phase: TransferProgress['phase'] = 'processing',
): TransferProgress {
  const safeTotal = Math.max(1, total)
  return {
    processed,
    total,
    percent: Math.min(100, Math.round((processed / safeTotal) * 100)),
    phase,
  }
}

function runWorkerRequest(worker: Worker, request: DataTransferRequest): Promise<DataTransferResponse> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<DataTransferResponse>) => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      resolve(event.data)
    }
    const onError = () => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      reject(new Error('Data transfer worker failed to start'))
    }

    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    worker.postMessage(request as DataTransferRequest)
  })
}

function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function updateFrontierMetadataFromChunk(
  rates: readonly { effectiveDate: string; supplier: string }[],
  current: { latestDate: string; suppliersAtLatestDate: Set<string> },
): void {
  for (const rate of rates) {
    const candidateDate = rate.effectiveDate.trim()
    if (!candidateDate) {
      continue
    }
    if (candidateDate > current.latestDate) {
      current.latestDate = candidateDate
      current.suppliersAtLatestDate.clear()
      current.suppliersAtLatestDate.add(rate.supplier)
      continue
    }
    if (candidateDate === current.latestDate) {
      current.suppliersAtLatestDate.add(rate.supplier)
    }
  }
}

export function useDataTransfer(): UseDataTransferResult {
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<TransferProgress | null>(null)
  const [importProgress, setImportProgress] = useState<TransferProgress | null>(null)

  const exportBackup = useCallback(async () => {
    setIsExporting(true)
    setExportProgress({ processed: 0, total: 1, percent: 0, phase: 'processing' })
    const worker = createTransferWorker()
    try {
      const total = await countRates()
      setExportProgress(calculateProgress(0, total, 'processing'))

      let processed = 0
      let exportBlob: Blob | null = null

      if (total === 0) {
        const emptyResponse = await runWorkerRequest(worker, {
          kind: 'export:chunk',
          rates: [],
          isFirst: true,
          isLast: true,
        })
        if (emptyResponse.kind === 'error') {
          throw new Error(emptyResponse.message)
        }
        if (emptyResponse.kind !== 'export:chunk') {
          throw new Error('Unexpected export response from worker')
        }
        exportBlob = emptyResponse.blob ?? null
      } else {
        for await (const ratesChunk of iterateRatesInChunks(EXPORT_CHUNK_SIZE)) {
          const response = await runWorkerRequest(worker, {
            kind: 'export:chunk',
            rates: ratesChunk,
            isFirst: processed === 0,
            isLast: processed + ratesChunk.length >= total,
          })

          if (response.kind === 'error') {
            throw new Error(response.message)
          }
          if (response.kind !== 'export:chunk') {
            throw new Error('Unexpected export response from worker')
          }

          processed += response.chunkCount
          if (response.blob) {
            exportBlob = response.blob
          }
          setExportProgress(calculateProgress(processed, total, 'processing'))
        }
      }

      if (!exportBlob) {
        throw new Error('Export failed to produce backup file')
      }

      const isoDate = new Date().toISOString().slice(0, 10)
      setExportProgress(calculateProgress(total, total, 'compressing'))
      triggerDownload(`powertools-rates-backup-${isoDate}.json.gz`, exportBlob)
    } finally {
      worker.terminate()
      setIsExporting(false)
      setExportProgress(null)
    }
  }, [])

  const importBackup = useCallback(async (file: File) => {
    const isGzip = file.name.toLowerCase().endsWith('.gz')
    setIsImporting(true)
    setImportProgress({
      processed: 0,
      total: 1,
      percent: 0,
      phase: isGzip ? 'decompressing' : 'processing',
    })
    const worker = createTransferWorker()
    let lastSuccessfulChunkIndex = -1
    const metadataState = { latestDate: '', suppliersAtLatestDate: new Set<string>() }
    try {
      if (!isDatabaseReady()) {
        await initDB()
      }
      await clearAllRates()
      const payload = await file.arrayBuffer()
      const prepared = await runWorkerRequest(worker, { kind: 'import:prepare', payload, filename: file.name })
      if (prepared.kind === 'error') {
        throw new Error(prepared.message)
      }
      if (prepared.kind !== 'import:prepared') {
        throw new Error('Unexpected import preparation response from worker')
      }
      setImportProgress(calculateProgress(0, prepared.total, isGzip ? 'decompressing' : 'processing'))

      let writeQueue = Promise.resolve()

      await new Promise<void>((resolve, reject) => {
        const onMessage = (event: MessageEvent<DataTransferResponse>) => {
          const response = event.data

          if (response.kind === 'error') {
            cleanup()
            reject(new Error(response.message))
            return
          }

          if (response.kind === 'import:chunk') {
            const chunkIndex = Math.floor((response.processed - response.rates.length) / IMPORT_CHUNK_SIZE)
            writeQueue = writeQueue
              .then(async () => {
                try {
                  await appendRatesChunk(response.rates)
                  updateFrontierMetadataFromChunk(response.rates, metadataState)
                } catch (error) {
                  console.error('IndexedDB chunk write failed', error)
                  throw new Error(DISK_OR_DB_ERROR_MESSAGE)
                }
                lastSuccessfulChunkIndex = chunkIndex
                setImportProgress(calculateProgress(response.processed, response.total, 'processing'))
              })
              .catch((error: unknown) => {
                cleanup()
                console.error('Import interrupted. Last successful chunk index:', lastSuccessfulChunkIndex)
                reject(error instanceof Error ? error : new Error('Failed to import data chunk'))
              })
            return
          }

          if (response.kind === 'import:complete') {
            writeQueue
              .then(() => {
                cleanup()
                resolve()
              })
              .catch((error: unknown) => {
                cleanup()
                console.error('Import interrupted. Last successful chunk index:', lastSuccessfulChunkIndex)
                reject(error instanceof Error ? error : new Error('Failed to finalize import'))
              })
          }
        }

        const onError = () => {
          cleanup()
          console.error('Import interrupted. Last successful chunk index:', lastSuccessfulChunkIndex)
          reject(new Error('Data transfer worker failed during import'))
        }

        const cleanup = () => {
          worker.removeEventListener('message', onMessage)
          worker.removeEventListener('error', onError)
        }

        worker.addEventListener('message', onMessage)
        worker.addEventListener('error', onError)
        worker.postMessage({ kind: 'import:consume', chunkSize: IMPORT_CHUNK_SIZE } as DataTransferRequest)
      })

      await Promise.all([
        setMetadata('pricingEffectiveDateIso', metadataState.latestDate || null),
        setMetadata(
          'syncedSuppliers',
          [...metadataState.suppliersAtLatestDate].sort((a, b) => a.localeCompare(b)),
        ),
      ])

      alert(`Success: ${prepared.total} rates imported and verified.`)
      setTimeout(() => window.location.reload(), 1500)
    } catch (error) {
      console.error('Import failed. Last successful chunk index:', lastSuccessfulChunkIndex)
      throw error
    } finally {
      worker.terminate()
      setIsImporting(false)
      setImportProgress(null)
    }
  }, [])

  return useMemo(
    () => ({
      isExporting,
      isImporting,
      exportProgress,
      importProgress,
      exportBackup,
      importBackup,
    }),
    [exportBackup, importBackup, exportProgress, importProgress, isExporting, isImporting],
  )
}
