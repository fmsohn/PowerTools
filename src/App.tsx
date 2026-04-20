import { useEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import { Navigation } from './components/layout/Navigation'
import { CommissionEstimator } from './modules/commission-calc'
import {
  FileDropZone,
  parseNrgMatrix,
  PricePuller,
  type NrgMatrixPivotRow,
} from './modules/matrix-parser'
import { getAllRates, saveRatesToDisk } from './lib/db'
import { NotificationProvider } from './shared/notifications/NotificationService'
import { rateMergeKey, type Rate } from './types/market-data'

const DEMO_NRG_PIVOT_ROWS: NrgMatrixPivotRow[] = [
  {
    supplier: 'NRG Demo',
    utilityLabel: 'CNP',
    loadFactorLabel: 'LOW',
    startDate: '01/01/2026',
    zone: 'LZ_NORTH',
    productType: 'ALL_IN',
    productLabel: '',
    usageTierLabel: '0-5000',
    termPrices: {
      12: 0.095,
      24: 0.088,
      36: 0.082,
      48: 0.079,
      60: 0.077,
      72: 0.075,
      84: 0.073,
    },
  },
  {
    supplier: 'NRG Demo',
    utilityLabel: 'ONCOR',
    loadFactorLabel: 'MEDIUM',
    startDate: '03/15/2026',
    zone: 'LZ_WEST',
    productType: 'ALL_IN',
    productLabel: '',
    usageTierLabel: '5001+',
    termPrices: {
      12: 0.091,
      36: 0.084,
      60: 0.078,
      72: 0.076,
    },
  },
  {
    supplier: 'NRG Demo',
    utilityLabel: 'CNP',
    loadFactorLabel: 'LOW',
    startDate: '01/01/2026',
    zone: 'LZ_NORTH',
    productType: 'NODAL',
    productLabel: '',
    usageTierLabel: '0-5000',
    termPrices: { 12: 0.091, 60: 0.074, 72: 0.071 },
  },
]

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

function App() {
  const [activeView, setActiveView] = useState<'calculator' | 'parser'>('calculator')
  const [matrixData, setMatrixData] = useState<Rate[] | null>(null)
  const [ingestionEpoch, setIngestionEpoch] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const stored = await getAllRates()
        if (!cancelled && stored.length > 0) {
          setMatrixData(stored)
        }
      } catch {
        // IndexedDB unavailable or blocked; keep demo/null state
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const demoRates = useMemo(() => {
    const effectiveDate = new Date().toISOString().split('T')[0]
    return parseNrgMatrix(DEMO_NRG_PIVOT_ROWS, { effectiveDate })
  }, [])
  const matrixRates = matrixData ?? demoRates

  return (
    <NotificationProvider>
      <div className="app-shell bg-[#000000] text-[#FFFFFF]">
        <Navigation activeView={activeView} onViewChange={setActiveView} />
        <main className="flex flex-1 flex-col items-center">
          {activeView === 'calculator' ? (
            <CommissionEstimator />
          ) : (
            <section className="mt-8 w-full max-w-5xl px-4 pb-12">
              <FileDropZone
                className="mb-8"
                onRatesParsed={async (newRates) => {
                  let merged: Rate[] = []
                  flushSync(() => {
                    setMatrixData((prev) => {
                      merged = mergeRateTables(prev, newRates)
                      return merged
                    })
                  })
                  setIngestionEpoch((n) => n + 1)
                  await saveRatesToDisk(merged)
                }}
              />
              <PricePuller rates={matrixRates} ingestionEpoch={ingestionEpoch} />
            </section>
          )}
        </main>
      </div>
    </NotificationProvider>
  )
}

export default App
