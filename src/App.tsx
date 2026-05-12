import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { SettingsModal } from '@/components/SettingsModal'
import { rateMergeKey, type Rate } from '@/types/market-data'
import { Navigation } from './components/layout/Navigation'
import { CommissionEstimator } from './modules/commission-calc'
import {
  FileDropZone,
  PricePuller,
} from './modules/matrix-parser'
import {
  appendRatesChunk,
  getAllRates,
  isPersistenceSyncing,
  setMetadata,
  subscribePersistenceStatus,
} from './lib/db'
import { NotificationProvider } from './shared/notifications/NotificationService'

function mergeRateTables(prev: Rate[] | null, incoming: Rate[]): Rate[] {
  const map = new Map<string, Rate>()
  for (const r of prev ?? []) {
    map.set(rateMergeKey(r), r)
  }
  for (const r of incoming) {
    map.set(rateMergeKey(r), r)
  }
  return Array.from(map.values())
}

function buildSyncMetadata(rates: readonly Rate[]): {
  readonly pricingEffectiveDateIso: string | null
  readonly syncedSuppliers: string[]
} {
  let pricingEffectiveDateIso = ''
  for (const rate of rates) {
    const normalizedDate = rate.effectiveDate.trim()
    if (normalizedDate > pricingEffectiveDateIso) {
      pricingEffectiveDateIso = normalizedDate
    }
  }
  if (!pricingEffectiveDateIso) {
    return { pricingEffectiveDateIso: null, syncedSuppliers: [] }
  }
  const suppliers = new Set<string>()
  for (const rate of rates) {
    if (rate.effectiveDate.trim() === pricingEffectiveDateIso) {
      suppliers.add(rate.supplier)
    }
  }
  return {
    pricingEffectiveDateIso,
    syncedSuppliers: [...suppliers].sort((a, b) => a.localeCompare(b)),
  }
}

function App() {
  const [activeView, setActiveView] = useState<'calculator' | 'parser' | 'comparison'>('calculator')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [matrixData, setMatrixData] = useState<Rate[] | null>(null)
  const [ingestionEpoch, setIngestionEpoch] = useState(0)
  const [persistenceSyncing, setPersistenceSyncing] = useState(() => isPersistenceSyncing())
  const [lastCommittedCount, setLastCommittedCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const stored = await getAllRates()
        if (!cancelled && stored.length > 0) {
          setMatrixData(stored)
        }
      } catch {
        // IndexedDB unavailable or blocked; keep null state.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const unsubscribe = subscribePersistenceStatus((next) => {
      setPersistenceSyncing(next)
    })
    return () => {
      unsubscribe()
    }
  }, [])

  const matrixRates = matrixData ?? []

  return (
    <NotificationProvider>
      <div className="app-shell bg-[#000000] text-[#FFFFFF]">
        <Navigation
          activeView={activeView}
          onViewChange={setActiveView}
          onSettingsOpen={() => setIsSettingsOpen(true)}
          isPersistenceSyncing={persistenceSyncing}
        />
        <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
        <main className="flex flex-1 flex-col items-center">
          {activeView === 'calculator' ? (
            <CommissionEstimator />
          ) : (
            <section className="mt-8 w-full max-w-5xl px-4 pb-12">
              {activeView === 'parser' ? (
                <FileDropZone
                  className="mb-8"
                  onNavigateToComparison={() => {
                    setActiveView('comparison')
                    // Clear the success milestone after the user has successfully transitioned.
                    setTimeout(() => setLastCommittedCount(null), 500)
                  }}
                  onRatesParsed={async (newRates) => {
                    let merged: Rate[] = []
                    flushSync(() => {
                      setMatrixData((prev) => {
                        merged = mergeRateTables(prev, newRates)
                        return merged
                      })
                    })
                    setIngestionEpoch((n) => n + 1)
                    await appendRatesChunk(newRates)
                    const syncMetadata = buildSyncMetadata(merged)
                    await Promise.all([
                      setMetadata('pricingEffectiveDateIso', syncMetadata.pricingEffectiveDateIso),
                      setMetadata('syncedSuppliers', syncMetadata.syncedSuppliers),
                    ])
                    window.dispatchEvent(
                      new CustomEvent('powertools-metadata-update', {
                        detail: {
                          pricingEffectiveDateIso: syncMetadata.pricingEffectiveDateIso,
                          syncedSuppliers: syncMetadata.syncedSuppliers,
                        },
                      }),
                    )
                    setLastCommittedCount(merged.length)
                    return merged.length
                  }}
                  committedRecordCount={lastCommittedCount}
                />
              ) : null}
              <PricePuller
                rates={matrixRates}
                ingestionEpoch={ingestionEpoch}
              />
            </section>
          )}
        </main>
      </div>
    </NotificationProvider>
  )
}

export default App
