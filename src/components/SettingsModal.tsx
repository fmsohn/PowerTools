import { useRef } from 'react'
import { useDataTransfer } from '@/logic/transfer/useDataTransfer'
import { useNotificationService } from '@/shared/notifications/NotificationService'

interface SettingsModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { notify } = useNotificationService()
  const { exportBackup, importBackup, isExporting, isImporting, exportProgress, importProgress } =
    useDataTransfer()
  const DISK_OR_DB_ERROR_MESSAGE = 'DISK FULL or DATABASE ERROR'

  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md px-4">
      <div className="w-full max-w-xl rounded-xl border border-cyan-500/50 bg-black/80 p-6 shadow-[0_0_15px_rgba(0,255,255,0.2)]">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold uppercase tracking-[0.24em] text-cyan-200">Data Management</h2>
            <p className="mt-2 text-sm text-slate-300">
              Export your local rates database or import a backup file.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-md border border-cyan-500/50 px-3 text-xs font-semibold uppercase tracking-wider text-cyan-100 hover:bg-cyan-500/10"
          >
            Close
          </button>
        </div>

        <p className="mb-5 rounded-md border border-fuchsia-500/50 bg-fuchsia-500/10 p-3 text-sm font-semibold text-fuchsia-200">
          Wipe &amp; Replace Warning: Importing will delete all local data.
        </p>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={isExporting || isImporting}
            onClick={async () => {
              try {
                await exportBackup()
                notify({ tone: 'success', message: 'Backup exported to JSON file.' })
              } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to export backup'
                notify({ tone: 'error', message })
              }
            }}
            className="min-h-[44px] rounded-md border border-cyan-500/50 bg-cyan-500/10 px-4 py-2 text-sm font-semibold uppercase tracking-[0.16em] text-cyan-200 shadow-[0_0_15px_rgba(0,255,255,0.2)] transition hover:bg-cyan-500/20 disabled:opacity-60"
          >
            {isExporting
              ? exportProgress?.phase === 'compressing'
                ? 'COMPRESSING...'
                : 'EXPORTING...'
              : 'Export Backup'}
          </button>
          <button
            type="button"
            disabled={isImporting || isExporting}
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[44px] rounded-md border border-fuchsia-500/50 bg-fuchsia-500/10 px-4 py-2 text-sm font-semibold uppercase tracking-[0.16em] text-fuchsia-200 shadow-[0_0_15px_rgba(255,0,255,0.25)] transition hover:bg-fuchsia-500/20 disabled:opacity-60"
          >
            {isImporting
              ? importProgress?.phase === 'decompressing'
                ? 'DECOMPRESSING...'
                : 'IMPORTING...'
              : 'Import Data'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.gz,.json.gz,application/json,application/gzip"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.currentTarget.value = ''
              if (!file) {
                return
              }
              void (async () => {
                try {
                  await importBackup(file)
                } catch (error) {
                  const message = error instanceof Error ? error.message : 'Failed to import data'
                  const upperMessage = message.toUpperCase()
                  const shouldShowDiskAlert =
                    upperMessage.includes('DISK FULL') ||
                    upperMessage.includes('DATABASE') ||
                    upperMessage.includes('INDEXEDDB')
                  notify({
                    tone: 'error',
                    message: shouldShowDiskAlert ? DISK_OR_DB_ERROR_MESSAGE : message,
                  })
                }
              })()
            }}
          />
        </div>

        {(isExporting || isImporting) && (
          <div className="mt-5 rounded-md border border-cyan-500/40 bg-black/70 p-3 shadow-[inset_0_0_10px_rgba(0,255,255,0.2)]">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">
              {isExporting
                ? exportProgress?.phase === 'compressing'
                  ? 'Compressing backup file...'
                  : `Exporting: ${Math.round(exportProgress?.processed ?? 0)} / ${Math.round(exportProgress?.total ?? 0)} rates...`
                : importProgress?.phase === 'decompressing'
                  ? 'Decompressing backup file...'
                  : `Importing: ${importProgress?.percent ?? 0}% (${importProgress?.processed ?? 0}/${importProgress?.total ?? 0})`}
            </p>
            <div className="h-3 overflow-hidden rounded-full border border-cyan-400/60 bg-cyan-950/40">
              <div
                className="h-full bg-gradient-to-r from-cyan-400 via-cyan-300 to-cyan-200 shadow-[0_0_14px_rgba(0,255,255,0.9)] transition-all duration-300"
                style={{
                  width: `${isExporting ? exportProgress?.percent ?? 0 : importProgress?.percent ?? 0}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
