import { useCallback, useId, useRef, useState, type ChangeEvent } from 'react'
import {
  ingestMatrixFile,
  type MatrixConflictHandler,
} from '../ingest/ingestMatrixFile'
import { SUPPLIER_REGISTRY, type SupplierSilo } from '../supplierRegistry'
import { useNotificationService } from '../../../shared/notifications/NotificationService'
import type { Rate } from '../../../types/market-data'
import { DateRequestModal } from './DateRequestModal'
import { MatrixIngestSlabs, type SlabState } from './MatrixIngestSlabs'

export interface FileDropZoneProps {
  readonly onRatesParsed: (rates: Rate[]) => void
  readonly className?: string
}

type ConflictState = {
  readonly matchingSuppliers: readonly SupplierSilo[]
  readonly buffer: ArrayBuffer
  readonly sheetNames: readonly string[]
  readonly file: File
}

type DatePromptState = {
  readonly fileName: string
  readonly supplierName: string
}

export function FileDropZone({ onRatesParsed, className = '' }: FileDropZoneProps) {
  const { notify } = useNotificationService()
  const inputId = useId()
  const recognizedSuppliers = SUPPLIER_REGISTRY.map((supplier) => supplier.name).join(', ')
  const [isDragging, setIsDragging] = useState(false)
  const [sniffing, setSniffing] = useState(false)
  const [slab, setSlab] = useState<SlabState | null>(null)
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  const [batchDates, setBatchDates] = useState<string[]>([])
  const [datePrompt, setDatePrompt] = useState<DatePromptState | null>(null)
  const pendingDateRequestRef = useRef<((value: string | null) => void) | null>(null)

  const closeDatePrompt = useCallback((value: string | null) => {
    const resolver = pendingDateRequestRef.current
    pendingDateRequestRef.current = null
    setDatePrompt(null)
    resolver?.(value)
  }, [])

  const onDateRequest = useCallback(
    (fileName: string, supplierName: string): Promise<string | null> =>
      new Promise((resolve) => {
        pendingDateRequestRef.current = resolve
        setDatePrompt({ fileName, supplierName })
      }),
    [],
  )

  const registerBatchDates = useCallback(
    (rates: readonly Rate[], fileCount: number) => {
      const uniqueDates = Array.from(new Set(rates.map((rate) => rate.effectiveDate.trim())))
      setBatchDates((prev) => {
        const merged = Array.from(new Set([...prev, ...uniqueDates]))
        if (fileCount > 1 && merged.length > 1) {
          notify({
            tone: 'warning',
            message: `Batch upload contains files with different resolved dates: ${merged.join(', ')}`,
          })
        }
        return merged
      })
    },
    [notify],
  )

  const processFile = useCallback(
    async (file: File, fileCount = 1) => {
      setSlab(null)
      setConflict(null)
      setSniffing(true)
      try {
        const onConflictDetected: MatrixConflictHandler = (
          matchingSuppliers,
          buffer,
          sheetNames,
        ) => {
          setConflict({ matchingSuppliers, buffer, sheetNames, file })
          setSlab({
            kind: 'conflict_detected',
            supplierNames: matchingSuppliers.map((supplier) => supplier.name),
          })
        }

        const res = await ingestMatrixFile(file, { onConflictDetected, onDateRequest })
        if (res.kind === 'rates') {
          onRatesParsed(res.rates)
          registerBatchDates(res.rates, fileCount)
          notify({ tone: 'success', message: res.detail })
          setSlab({ kind: 'success', text: res.detail })
          return
        }
        if (res.kind === 'conflict_detected') {
          return
        }
        if (res.kind === 'unknown_matrix') {
          notify({ tone: 'error', message: `Unknown matrix: no supplier match for ${file.name}.` })
          setSlab({ kind: 'unknown_matrix' })
          return
        }
        if (res.kind === 'missing_sheets') {
          notify({ tone: 'error', message: res.message })
          setSlab({ kind: 'missing_sheets', text: res.message })
          return
        }
        notify({ tone: 'error', message: res.message })
        setSlab({ kind: 'reject', text: res.message })
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown upload failure.'
        notify({ tone: 'error', message: reason })
        setSlab({ kind: 'reject', text: reason })
      } finally {
        setSniffing(false)
      }
    },
    [notify, onDateRequest, onRatesParsed, registerBatchDates],
  )

  const processBatch = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return
      }
      setBatchDates([])
      for (const file of files) {
        await processFile(file, files.length)
      }
    },
    [processFile],
  )

  const handleSupplierSelection = useCallback(
    async (supplierId: string) => {
      if (!conflict) {
        return
      }
      setSniffing(true)
      try {
        const res = await ingestMatrixFile(conflict.file, {
          buffer: conflict.buffer,
          selectedSupplierId: supplierId,
          onDateRequest,
        })
        if (res.kind === 'rates') {
          onRatesParsed(res.rates)
          registerBatchDates(res.rates, 1)
          notify({ tone: 'success', message: res.detail })
          setConflict(null)
          setSlab({ kind: 'success', text: res.detail })
          return
        }
        if (res.kind === 'missing_sheets') {
          setConflict(null)
          notify({ tone: 'error', message: res.message })
          setSlab({ kind: 'missing_sheets', text: res.message })
          return
        }
        if (res.kind === 'unknown_matrix') {
          setConflict(null)
          notify({
            tone: 'error',
            message: `Unknown matrix: no supplier match for ${conflict.file.name}.`,
          })
          setSlab({ kind: 'unknown_matrix' })
          return
        }
        if (res.kind === 'conflict_detected') {
          setSlab({
            kind: 'conflict_detected',
            supplierNames: res.matchingSuppliers.map((supplier) => supplier.name),
          })
          return
        }
        setConflict(null)
        notify({ tone: 'error', message: res.message })
        setSlab({ kind: 'reject', text: res.message })
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown upload failure.'
        notify({ tone: 'error', message: reason })
        setConflict(null)
        setSlab({ kind: 'reject', text: reason })
      } finally {
        setSniffing(false)
      }
    },
    [conflict, notify, onDateRequest, onRatesParsed, registerBatchDates],
  )

  const onInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      const files = e.target.files ? Array.from(e.target.files) : []
      e.target.value = ''
      if (file && files.length === 1) {
        void processFile(file, 1)
      } else if (files.length > 1) {
        void processBatch(files)
      }
    },
    [processBatch, processFile],
  )

  const sniffClass = sniffing
    ? 'animate-neon-cyan-sniff border-[#00FFFF] shadow-[6px_6px_0_0_#000,0_0_26px_rgba(0,255,255,0.55)]'
    : 'border-cyan-400/75 shadow-[6px_6px_0_0_#000,0_0_20px_rgba(0,255,255,0.18)] hover:border-cyan-300'

  return (
    <div className={className}>
      <label
        htmlFor={inputId}
        onDragEnter={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragging(false)
          const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : []
          const file = files[0]
          if (file && files.length === 1) {
            void processFile(file, 1)
          } else if (files.length > 1) {
            void processBatch(files)
          }
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-md border-4 border-dashed bg-[#04060a] px-6 py-10 text-center transition-[box-shadow,border-color,transform] hover:shadow-[6px_6px_0_0_#000,0_0_28px_rgba(0,255,255,0.28)] ${sniffClass} ${
          isDragging ? 'scale-[1.01] border-cyan-200' : ''
        }`}
      >
        <span className="text-sm font-bold uppercase tracking-[0.28em] text-cyan-200/90">
          Matrix file
        </span>
        <span className="max-w-md text-sm text-slate-400">
          {`Drop a matrix file (.xlsx, .xlsm, .csv) or click to browse. Recognized suppliers: ${recognizedSuppliers}`}
        </span>
        <input
          id={inputId}
          type="file"
          multiple
          accept=".xlsx,.xlsm,.csv,.json,application/json,text/csv"
          className="sr-only"
          onChange={onInputChange}
        />
      </label>
      <MatrixIngestSlabs
        slab={slab}
        conflict={conflict}
        onSupplierSelected={handleSupplierSelection}
      />
      {batchDates.length > 1 ? (
        <p className="mt-3 text-xs font-bold tracking-wide text-amber-300">
          Warning: this upload session has multiple effective dates ({batchDates.join(', ')}).
        </p>
      ) : null}
      {datePrompt ? (
        <DateRequestModal
          fileName={datePrompt.fileName}
          supplierName={datePrompt.supplierName}
          onConfirm={(isoDate) => closeDatePrompt(isoDate)}
          onCancel={() => closeDatePrompt(null)}
        />
      ) : null}
    </div>
  )
}
