import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  LOAD_FACTOR_LABELS,
  UTILITY_LABELS,
} from '../../../constants/market-data.constants'
import { SLAB_NEON_FIELD_CLASS } from '../../../shared/components/ValidatedInput'
import { isWithinUsage } from '../../../shared/utils/math'
import type { LoadFactor, Rate, RateProductType, Utility } from '../../../types/market-data'

const STANDARD_TERMS = [12, 24, 36, 48, 60] as const

const FIELD_LABEL =
  'text-[10px] font-bold uppercase tracking-wider text-cyan-400/80'

const SLAB_PANEL =
  'rounded-md border-4 border-cyan-400/70 bg-[#04060a] p-5 text-left shadow-[6px_6px_0_0_rgba(255,0,255,0.45),0_0_14px_rgba(0,255,255,0.25)]'

const NEON_SEPARATOR_CLASS =
  'my-6 h-px w-full border-0 bg-gradient-to-r from-transparent via-cyan-400/35 to-transparent shadow-[0_0_14px_rgba(34,211,238,0.25)]'

const SLAB_SYNC_STRIP =
  'rounded-md border-4 border-cyan-500/35 bg-[#020408] p-4 shadow-[inset_0_0_18px_rgba(34,211,238,0.08)]'

const SLAB_SUPPLIER_BADGE_BASE =
  'inline-flex items-center gap-1.5 rounded-md border-2 bg-[#04060a] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider shadow-[3px_3px_0_0_rgba(0,255,255,0.12)]'

const SLAB_SUPPLIER_BADGE_CURRENT = `${SLAB_SUPPLIER_BADGE_BASE} border-[#22d3ee] text-[#22d3ee]`

const SLAB_SUPPLIER_BADGE_STALE = `${SLAB_SUPPLIER_BADGE_BASE} border-[#fbbf24] text-[#fbbf24] animate-pulse shadow-[3px_3px_0_0_rgba(251,191,36,0.2)]`

/** Discovery comparison table: neon slab, hard-offset stack shadows. */
const DISCOVERY_TABLE_WRAP =
  'overflow-x-auto rounded-md border-4 border-cyan-400 bg-[#04060a] shadow-[6px_6px_0_0_rgba(34,211,238,0.45),10px_10px_0_0_rgba(255,0,255,0.35)]'

const DISCOVERY_TABLE = 'w-full min-w-[360px] border-collapse text-left font-mono text-sm'

const DISCOVERY_WINNER_LEGEND = 'mb-2 text-[11px] font-medium text-slate-400'

/** Lowest rate for that term among displayed columns; ties all get this styling. */
const DISCOVERY_WINNER_CELL =
  'font-bold text-[#4ade80] bg-[rgba(74,222,128,0.09)] [text-shadow:0_0_8px_rgba(34,211,238,0.5),0_0_16px_rgba(74,222,128,0.4),0_0_22px_rgba(16,185,129,0.25)]'

function parseUsageKwh(raw: string): number {
  const n = Number(raw.replace(/,/g, '').trim())
  return Number.isFinite(n) && n >= 0 ? n : Number.NaN
}

function parseCustomTerm(raw: string): number | null {
  const n = Number(raw.replace(/,/g, '').trim())
  if (!Number.isFinite(n) || n <= 0) {
    return null
  }
  return Math.round(n)
}

function isAllLikeOption(value: string): boolean {
  const normalized = value.trim().toUpperCase()
  return (
    normalized === 'ALL' ||
    normalized === 'ALL UTILITIES' ||
    normalized === 'ALL ZONES'
  )
}

/** Display YYYY-MM-DD as MM/DD/YYYY without parsing as UTC (calendar parts only). */
function formatContractStartLabel(ymd: string): string {
  const [y, m, d] = ymd.trim().split('-')
  if (y === undefined || m === undefined || d === undefined) {
    return ymd
  }
  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m) || !/^\d{2}$/.test(d)) {
    return ymd
  }
  return `${m}/${d}/${y}`
}

/** Display YYYY-MM-DD as MM/DD/YYYY without converting timezone. */
function formatPricingEffectiveDateLabel(ymd: string): string {
  const [y, m, d] = ymd.trim().split('-')
  if (y === undefined || m === undefined || d === undefined) {
    return ymd
  }
  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m) || !/^\d{2}$/.test(d)) {
    return ymd
  }
  return `${m}/${d}/${y}`
}

/**
 * Matrix labels (per supplier column text) are normalized to `LoadFactor` at ingest
 * via `LOAD_FACTOR_MAP`; filtering uses that canonical value.
 */
function matchesDiscoveryCriteria(
  rate: Rate,
  ctx: {
    utility: Utility
    zone: string
    productType: RateProductType
    usageKwh: number
    loadFactor: LoadFactor
    startDate: string
  },
): boolean {
  if (rate.utility !== ctx.utility) {
    return false
  }
  if (rate.zone.trim() !== ctx.zone.trim()) {
    return false
  }
  if (rate.productType !== ctx.productType) {
    return false
  }
  if (rate.loadFactor !== ctx.loadFactor) {
    return false
  }
  if (ctx.startDate) {
    const rowDate = rate.startDate ?? ''
    if (rowDate !== ctx.startDate) {
      return false
    }
  }
  return isWithinUsage(ctx.usageKwh, rate.minUsageKwh, rate.maxUsageKwh)
}

const TRIPLE_SEP = '\u0000'

/** Lowest $/kWh per supplier + term + contract start (dedupes overlapping usage tiers). */
function buildBestRateMap(rates: Rate[]): Map<string, number> {
  const rateBySupplierTermStart = new Map<string, number>()
  for (const r of rates) {
    const startKey = (r.startDate ?? '').trim()
    const tripleKey = `${r.supplier}${TRIPLE_SEP}${r.term}${TRIPLE_SEP}${startKey}`
    const prev = rateBySupplierTermStart.get(tripleKey)
    if (prev === undefined || r.ratePerKwh < prev) {
      rateBySupplierTermStart.set(tripleKey, r.ratePerKwh)
    }
  }
  return rateBySupplierTermStart
}

function getCellRate(
  supplier: string,
  term: number,
  desiredStart: string,
  rateBySupplierTermStart: Map<string, number>,
): number | undefined {
  const sep = TRIPLE_SEP
  const trimmedStart = desiredStart.trim()
  if (trimmedStart) {
    return rateBySupplierTermStart.get(
      `${supplier}${sep}${term}${sep}${trimmedStart}`,
    )
  }
  let v: number | undefined
  for (const [key, val] of rateBySupplierTermStart) {
    const parts = key.split(sep)
    const sup = parts[0]
    const t = Number(parts[1])
    if (sup === supplier && t === term) {
      if (v === undefined || val < v) {
        v = val
      }
    }
  }
  return v
}

const RATE_EPS = 1e-10

function nearlyEqualRate(a: number, b: number): boolean {
  return Math.abs(a - b) < RATE_EPS
}

/**
 * Top suppliers for the discovery grid: winners (row minimum) first, then by how often
 * they are 2nd/3rd lowest distinct rate per term, capped at `max`.
 */
function computeTopColumnSuppliers(
  pool: Rate[],
  ctx: DiscoveryCtx,
  selectedTerms: number[],
  max: number,
): string[] {
  const relevant = pool.filter(
    (r) => selectedTerms.includes(r.term) && matchesDiscoveryCriteria(r, ctx),
  )
  const allNames = new Set<string>()
  for (const r of pool) {
    allNames.add(r.supplier)
  }
  if (relevant.length === 0) {
    return [...allNames].sort((a, b) => a.localeCompare(b)).slice(0, max)
  }

  const rateMap = buildBestRateMap(relevant)
  const suppliersInRelevant = new Set<string>()
  for (const r of relevant) {
    suppliersInRelevant.add(r.supplier)
  }

  const isRowWinner = new Set<string>()
  const secondOrThirdCount = new Map<string, number>()
  const winCount = new Map<string, number>()

  for (const term of selectedTerms) {
    const row: { supplier: string; rate: number }[] = []
    for (const s of suppliersInRelevant) {
      const rate = getCellRate(s, term, ctx.startDate, rateMap)
      if (rate !== undefined) {
        row.push({ supplier: s, rate })
      }
    }
    if (row.length === 0) {
      continue
    }
    const distinctSorted = [...new Set(row.map((e) => e.rate))].sort((a, b) => a - b)
    const minRate = distinctSorted[0]
    if (minRate !== undefined) {
      for (const { supplier, rate } of row) {
        if (nearlyEqualRate(rate, minRate)) {
          isRowWinner.add(supplier)
          winCount.set(supplier, (winCount.get(supplier) ?? 0) + 1)
        }
      }
    }
    const tier2 = distinctSorted[1]
    const tier3 = distinctSorted[2]
    for (const { supplier, rate } of row) {
      if (tier2 !== undefined && nearlyEqualRate(rate, tier2)) {
        secondOrThirdCount.set(supplier, (secondOrThirdCount.get(supplier) ?? 0) + 1)
      }
      if (tier3 !== undefined && nearlyEqualRate(rate, tier3)) {
        secondOrThirdCount.set(supplier, (secondOrThirdCount.get(supplier) ?? 0) + 1)
      }
    }
  }

  const score23 = (s: string) => secondOrThirdCount.get(s) ?? 0
  const scoreWins = (s: string) => winCount.get(s) ?? 0

  const tier1 = [...isRowWinner].sort((a, b) => {
    const dw = scoreWins(b) - scoreWins(a)
    if (dw !== 0) {
      return dw
    }
    const d23 = score23(b) - score23(a)
    if (d23 !== 0) {
      return d23
    }
    return a.localeCompare(b)
  })

  const tier2rest = [...suppliersInRelevant].filter((s) => !isRowWinner.has(s))
  tier2rest.sort((a, b) => {
    const d = score23(b) - score23(a)
    if (d !== 0) {
      return d
    }
    return a.localeCompare(b)
  })

  const ordered = [...tier1, ...tier2rest]
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const s of ordered) {
    if (!seen.has(s)) {
      seen.add(s)
      deduped.push(s)
    }
  }
  return deduped.slice(0, max)
}

type DiscoveryCtx = {
  utility: Utility
  zone: string
  productType: RateProductType
  usageKwh: number
  loadFactor: LoadFactor
  startDate: string
}

interface DiscoveryPullBlockProps {
  readonly rates: Rate[]
  readonly selectedTerms: number[]
  /** Stable supplier columns (frontier pool); cells use em dash when no rate for that term. */
  readonly columnSuppliers: readonly string[]
  readonly ctx: DiscoveryCtx
}

/**
 * Isolated pull + results state. Parent remounts this via `key` when discovery
 * filters change so the slate clears without effects.
 */
function formatUsdPerKwh(value: number): string {
  return `$${value.toFixed(5)}/kWh`
}

function DiscoveryPullBlock({
  rates,
  selectedTerms,
  columnSuppliers,
  ctx,
}: DiscoveryPullBlockProps) {
  const [visibleRates, setVisibleRates] = useState<Rate[]>([])
  const [hasPulled, setHasPulled] = useState(false)
  const [pullMessage, setPullMessage] = useState<string | null>(null)

  const comparison = useMemo(() => {
    const rateBySupplierTermStart = buildBestRateMap(visibleRates)
    const supplierColumns = [...columnSuppliers]
    const termRows = [...selectedTerms]
    const minRateByTerm = new Map<number, number>()
    for (const term of termRows) {
      let minV: number | undefined
      for (const supplier of supplierColumns) {
        const v = getCellRate(
          supplier,
          term,
          ctx.startDate,
          rateBySupplierTermStart,
        )
        if (v !== undefined) {
          minV = minV === undefined || v < minV ? v : minV
        }
      }
      if (minV !== undefined) {
        minRateByTerm.set(term, minV)
      }
    }
    return {
      supplierColumns,
      termRows,
      rateBySupplierTermStart,
      minRateByTerm,
    }
  }, [visibleRates, columnSuppliers, selectedTerms, ctx.startDate])

  const usageKwh = ctx.usageKwh

  const handlePullRates = useCallback(() => {
    setPullMessage(null)
    if (!Number.isFinite(usageKwh)) {
      setPullMessage('Enter a valid annual usage (kWh).')
      return
    }
    if (selectedTerms.length === 0) {
      setPullMessage('Select Standard terms or enter at least one custom term.')
      return
    }

    const next = rates.filter(
      (r) =>
        selectedTerms.includes(r.term) && matchesDiscoveryCriteria(r, ctx),
    )
    setVisibleRates(next)
    setHasPulled(true)
  }, [rates, selectedTerms, ctx, usageKwh])

  return (
    <>
      <div className="mt-6 flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={handlePullRates}
          className="min-h-[48px] min-w-[200px] rounded-md border-2 border-cyan-300 bg-[#001818] px-8 py-3 text-sm font-black tracking-[0.25em] text-cyan-100 shadow-[0_0_26px_rgba(0,255,255,0.95),6px_6px_0_0_rgba(255,0,255,0.55)] transition-transform hover:translate-y-px active:translate-y-1 active:shadow-[0_0_18px_rgba(0,255,255,0.75),3px_3px_0_0_rgba(255,0,255,0.45)]"
        >
          PULL RATES
        </button>
        {pullMessage ? (
          <p className="text-sm text-amber-300" role="alert">
            {pullMessage}
          </p>
        ) : null}
      </div>

      {hasPulled ? (
        <section className="mt-8" aria-live="polite">
          <h3 className={`mb-3 ${FIELD_LABEL} text-fuchsia-300/90`}>
            Pulled matrix rows
          </h3>
          {comparison.supplierColumns.length === 0 || selectedTerms.length === 0 ? (
            <p className="text-slate-500">No rows matched this pull.</p>
          ) : (
            <>
              {visibleRates.length === 0 ? (
                <p className="mb-3 text-sm text-amber-200/90">
                  No rows matched this pull; grid shows selected terms and suppliers.
                </p>
              ) : null}
              <div className={DISCOVERY_TABLE_WRAP}>
                <p className={DISCOVERY_WINNER_LEGEND}>
                  Neon Green indicates the lowest rate for that term.
                </p>
                <table className={DISCOVERY_TABLE}>
                  <thead>
                    <tr className="border-b border-cyan-500/40">
                      <th
                        scope="col"
                        className="sticky left-0 z-[2] bg-[#04060a] px-3 py-2.5 text-xs font-black uppercase tracking-widest text-fuchsia-400 shadow-[4px_0_0_0_rgba(34,211,238,0.2)]"
                      >
                        TERM
                      </th>
                      {comparison.supplierColumns.map((name) => (
                        <th
                          key={name}
                          scope="col"
                          className="whitespace-nowrap px-3 py-2.5 text-center text-xs font-black uppercase tracking-widest text-cyan-400"
                        >
                          {name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.termRows.map((term) => (
                      <tr
                        key={term}
                        className="border-b border-cyan-500/15 last:border-b-0 odd:bg-black/20"
                      >
                        <th
                          scope="row"
                          className="sticky left-0 z-[2] bg-[#04060a] px-3 py-2.5 text-fuchsia-400 shadow-[4px_0_0_0_rgba(34,211,238,0.15)]"
                        >
                          {term} mo
                        </th>
                        {comparison.supplierColumns.map((supplier) => {
                          const v = getCellRate(
                            supplier,
                            term,
                            ctx.startDate,
                            comparison.rateBySupplierTermStart,
                          )
                          const minForTerm = comparison.minRateByTerm.get(term)
                          const isWinner =
                            v !== undefined &&
                            minForTerm !== undefined &&
                            nearlyEqualRate(v, minForTerm)
                          return (
                            <td
                              key={supplier}
                              className={`whitespace-nowrap px-3 py-2.5 text-center text-cyan-100/95 ${
                                isWinner ? DISCOVERY_WINNER_CELL : ''
                              }`}
                            >
                              {v !== undefined ? formatUsdPerKwh(v) : '—'}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

        </section>
      ) : (
        <p className="mt-10 text-center text-sm text-slate-600">
          Results appear here after you click PULL RATES.
        </p>
      )}
    </>
  )
}

export interface PricePullerProps {
  readonly rates: Rate[]
  /** Bumps `filterSignature` so discovery remounts after a new matrix file is ingested. */
  readonly ingestionEpoch?: number
}

export function PricePuller({ rates, ingestionEpoch = 0 }: PricePullerProps) {
  const [termMode, setTermMode] = useState<'standard' | 'custom'>('standard')
  const [customTerms, setCustomTerms] = useState<string[]>(['', '', '', '', ''])
  const [productType, setProductType] = useState<RateProductType>('ALL_IN')
  const [usageStr, setUsageStr] = useState('3500')
  const [utility, setUtility] = useState<Utility | ''>('')
  const [zone, setZone] = useState<string>('')
  const [loadFactor, setLoadFactor] = useState<LoadFactor>('LOW')
  const [startDate, setStartDate] = useState<string>('')
  const [extendedTerms, setExtendedTerms] = useState<number[]>([])

  const pricingEffectiveDateIso = useMemo(() => {
    if (rates.length === 0) {
      return null as string | null
    }
    let max = ''
    for (const r of rates) {
      const d = r.effectiveDate.trim()
      if (d > max) {
        max = d
      }
    }
    return max || null
  }, [rates])

  const currentRatesPool = useMemo(() => {
    if (!pricingEffectiveDateIso) {
      return [] as Rate[]
    }
    return rates.filter((r) => r.effectiveDate === pricingEffectiveDateIso)
  }, [rates, pricingEffectiveDateIso])

  const supplierSyncBadges = useMemo(() => {
    const names = new Set<string>()
    for (const r of rates) {
      names.add(r.supplier)
    }
    const sorted = [...names].sort((a, b) => a.localeCompare(b))
    if (!pricingEffectiveDateIso) {
      return sorted.map((supplier) => ({ supplier, status: 'stale' as const }))
    }
    return sorted.map((supplier) => {
      const onFrontier = rates.some(
        (r) => r.supplier === supplier && r.effectiveDate === pricingEffectiveDateIso,
      )
      return {
        supplier,
        status: onFrontier ? ('current' as const) : ('stale' as const),
      }
    })
  }, [rates, pricingEffectiveDateIso])

  const utilitiesInData = useMemo(() => {
    const u = new Set<Utility>()
    for (const r of currentRatesPool) {
      if (isAllLikeOption(r.utility)) {
        continue
      }
      u.add(r.utility)
    }
    return [...u].sort()
  }, [currentRatesPool])

  const effectiveUtility = utilitiesInData.includes(utility as Utility)
    ? (utility as Utility)
    : (utilitiesInData[0] ?? '')

  const uniqueZones = useMemo(() => {
    if (!effectiveUtility) {
      return [] as string[]
    }
    const seen = new Set<string>()
    for (const r of currentRatesPool) {
      if (r.utility !== effectiveUtility) {
        continue
      }
      const z = r.zone.trim()
      if (!z || isAllLikeOption(z)) {
        continue
      }
      seen.add(z)
    }
    return [...seen].sort((a, b) => a.localeCompare(b))
  }, [currentRatesPool, effectiveUtility])

  useEffect(() => {
    setZone((prev) => {
      if (uniqueZones.includes(prev)) {
        return prev
      }
      return uniqueZones[0] ?? ''
    })
  }, [effectiveUtility, uniqueZones])

  const effectiveZone = uniqueZones.includes(zone) ? zone : (uniqueZones[0] ?? '')

  const uniqueStartDates = useMemo(() => {
    const d = new Set<string>()
    for (const r of currentRatesPool) {
      const s = r.startDate?.trim()
      if (s) {
        d.add(s)
      }
    }
    return [...d].sort()
  }, [currentRatesPool])

  const loadFactorsInData = useMemo(() => {
    const loadFactorSet = new Set<LoadFactor>()
    for (const r of currentRatesPool) {
      loadFactorSet.add(r.loadFactor)
    }
    const ordered: LoadFactor[] = ['LOW', 'MEDIUM', 'HIGH']
    return ordered.filter((value) => loadFactorSet.has(value))
  }, [currentRatesPool])

  const effectiveLoadFactor = loadFactorsInData.includes(loadFactor)
    ? loadFactor
    : (loadFactorsInData[0] ?? 'LOW')

  const effectiveStartDate = uniqueStartDates.includes(startDate)
    ? startDate
    : (uniqueStartDates[0] ?? '')

  const selectedTerms = useMemo(() => {
    const baseTerms =
      termMode === 'standard'
        ? [...STANDARD_TERMS]
        : customTerms
            .map(parseCustomTerm)
            .filter((t): t is number => t !== null)
    return [...new Set([...baseTerms, ...extendedTerms])].sort((a, b) => a - b)
  }, [termMode, customTerms, extendedTerms])

  const discoveredLongTerms = useMemo(() => {
    const terms = new Set<number>()
    if (!effectiveUtility || !effectiveZone) {
      return [] as number[]
    }
    for (const rate of currentRatesPool) {
      if (rate.utility !== effectiveUtility) {
        continue
      }
      if (rate.zone.trim() !== effectiveZone.trim()) {
        continue
      }
      if (rate.loadFactor !== effectiveLoadFactor) {
        continue
      }
      if (rate.productType !== productType) {
        continue
      }
      if (rate.term > 60) {
        terms.add(rate.term)
      }
    }
    return [...terms].sort((a, b) => a - b)
  }, [
    currentRatesPool,
    effectiveUtility,
    effectiveZone,
    effectiveLoadFactor,
    productType,
  ])

  const hasHiddenLongTerms = useMemo(
    () => discoveredLongTerms.some((term) => !selectedTerms.includes(term)),
    [discoveredLongTerms, selectedTerms],
  )

  const filterSignature = JSON.stringify({
    utility: effectiveUtility,
    zone: effectiveZone,
    productType,
    usageStr: usageStr.trim(),
    terms: selectedTerms,
    termMode,
    loadFactor: effectiveLoadFactor,
    startDate: effectiveStartDate,
    ingestionEpoch,
    pricingEffectiveDateIso: pricingEffectiveDateIso ?? '',
  })

  const usageKwh = parseUsageKwh(usageStr)

  const ctx = useMemo(
    (): DiscoveryCtx => ({
      utility: effectiveUtility as Utility,
      zone: effectiveZone,
      productType,
      usageKwh,
      loadFactor: effectiveLoadFactor,
      startDate: effectiveStartDate,
    }),
    [
      effectiveUtility,
      effectiveZone,
      productType,
      usageKwh,
      effectiveLoadFactor,
      effectiveStartDate,
    ],
  )

  const columnSuppliers = useMemo(
    () => computeTopColumnSuppliers(currentRatesPool, ctx, selectedTerms, 5),
    [currentRatesPool, ctx, selectedTerms],
  )

  const handleUtilityChange = (nextUtility: Utility) => {
    setUtility(nextUtility)
  }

  return (
    <div className={`mx-auto w-full max-w-5xl ${SLAB_PANEL}`}>
      <header className="mb-6 border-b border-cyan-500/25 pb-4">
        <h2 className="m-0 text-2xl font-semibold tracking-[0.12em] text-cyan-300">
          MATRIX PRICE COMPARISON
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          Make selections below and click Pull Rates to generate rate comparison grid.
        </p>
        <div className="mt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className={FIELD_LABEL}>Supplier sync status</span>
            {pricingEffectiveDateIso ? (
              <span className="font-mono text-[11px] text-cyan-200/90">
                Pricing Effective Date{' '}
                <span className="text-cyan-300">
                  {formatPricingEffectiveDateLabel(pricingEffectiveDateIso)}
                </span>
              </span>
            ) : null}
          </div>
          <div className={`mt-3 ${SLAB_SYNC_STRIP}`} role="region" aria-label="Supplier sync status">
            {supplierSyncBadges.length === 0 ? (
              <p className="text-xs text-slate-500">No supplier rows in the database yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {supplierSyncBadges.map(({ supplier, status }) => (
                  <span
                    key={supplier}
                    className={
                      status === 'current' ? SLAB_SUPPLIER_BADGE_CURRENT : SLAB_SUPPLIER_BADGE_STALE
                    }
                  >
                    {supplier}
                    {status === 'stale' ? (
                      <span className="ml-1 font-black tracking-tight">(STALE)</span>
                    ) : null}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Utility</span>
          <select
            className={`${SLAB_NEON_FIELD_CLASS} w-full min-w-0 cursor-pointer font-mono text-sm`}
            value={effectiveUtility}
            onChange={(e) => handleUtilityChange(e.target.value as Utility)}
          >
            {utilitiesInData.map((u) => (
              <option key={u} value={u}>
                {UTILITY_LABELS[u]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Zone</span>
          <select
            className={`${SLAB_NEON_FIELD_CLASS} w-full min-w-0 cursor-pointer font-mono text-sm`}
            value={effectiveZone}
            onChange={(e) => setZone(e.target.value)}
          >
            {uniqueZones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Load factor</span>
          <select
            className={`${SLAB_NEON_FIELD_CLASS} w-full min-w-0 cursor-pointer font-mono text-sm`}
            value={effectiveLoadFactor}
            onChange={(e) => setLoadFactor(e.target.value as LoadFactor)}
          >
            {loadFactorsInData.map((factor) => (
              <option key={factor} value={factor}>
                {LOAD_FACTOR_LABELS[factor]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Annual usage (kWh)</span>
          <input
            className={`${SLAB_NEON_FIELD_CLASS} font-mono`}
            inputMode="numeric"
            value={usageStr}
            onChange={(e) => setUsageStr(e.target.value)}
            aria-label="Annual usage in kilowatt-hours"
          />
        </label>
      </div>

      <div className="mt-4">
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Contract start date</span>
          <select
            className={`${SLAB_NEON_FIELD_CLASS} w-full min-w-0 cursor-pointer font-mono text-sm md:max-w-md`}
            value={effectiveStartDate}
            onChange={(e) => setStartDate(e.target.value)}
          >
            {uniqueStartDates.map((d) => (
              <option key={d} value={d}>
                {formatContractStartLabel(d)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <hr className={NEON_SEPARATOR_CLASS} aria-hidden />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <span className={FIELD_LABEL}>Contract terms</span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTermMode('standard')}
              className={`min-h-[44px] rounded-md border-2 px-4 py-2 text-xs font-bold tracking-widest transition-all ${
                termMode === 'standard'
                  ? 'border-cyan-400 bg-cyan-950/40 text-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.45)]'
                  : 'border-fuchsia-600/50 bg-black text-slate-300 hover:border-fuchsia-400'
              }`}
            >
              STANDARD (12–60)
            </button>
            <button
              type="button"
              onClick={() => setTermMode('custom')}
              className={`min-h-[44px] rounded-md border-2 px-4 py-2 text-xs font-bold tracking-widest transition-all ${
                termMode === 'custom'
                  ? 'border-cyan-400 bg-cyan-950/40 text-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.45)]'
                  : 'border-fuchsia-600/50 bg-black text-slate-300 hover:border-fuchsia-400'
              }`}
            >
              CUSTOM (5)
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Terms:{' '}
            {selectedTerms.length > 0 ? `${selectedTerms.join(', ')} months` : '—'}
          </p>
          {termMode === 'custom' ? (
            <div className="grid grid-cols-5 gap-2">
              {customTerms.map((v, i) => (
                <label key={i} className="flex flex-col gap-1 text-left">
                  <span className="sr-only">Custom term {i + 1}</span>
                  <input
                    aria-label={`Custom term ${i + 1} (months)`}
                    className={`${SLAB_NEON_FIELD_CLASS} min-w-0 font-mono text-sm`}
                    inputMode="numeric"
                    placeholder="mo"
                    value={v}
                    onChange={(e) => {
                      const next = [...customTerms]
                      next[i] = e.target.value
                      setCustomTerms(next)
                    }}
                  />
                </label>
              ))}
            </div>
          ) : null}
          {hasHiddenLongTerms ? (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  setExtendedTerms((prev) => [
                    ...new Set([...prev, ...discoveredLongTerms]),
                  ])
                }
                className="min-h-[44px] rounded-md border-4 border-cyan-400/70 bg-[#050505] px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] text-cyan-100 shadow-[6px_6px_0_0_rgba(255,0,255,0.45)] transition-transform hover:translate-y-px active:translate-y-1"
              >
                Max Terms
              </button>
              <span className="text-xs text-slate-400">
                Beyond 60 mo in matrix (not in selection):{' '}
                {discoveredLongTerms
                  .filter((t) => !selectedTerms.includes(t))
                  .join(', ')}{' '}
                months
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <span className={FIELD_LABEL}>Product type</span>
          <div
            className="flex rounded-md border-4 border-cyan-500/40 bg-black p-1 shadow-[4px_4px_0_0_rgba(255,0,255,0.35)]"
            role="group"
            aria-label="Product type"
          >
            <button
              type="button"
              onClick={() => setProductType('ALL_IN')}
              className={`min-h-[44px] flex-1 rounded-sm px-2 text-xs font-bold tracking-wider ${
                productType === 'ALL_IN'
                  ? 'bg-cyan-600/30 text-cyan-100 shadow-[inset_0_0_12px_rgba(34,211,238,0.35)]'
                  : 'text-slate-500 hover:text-cyan-200'
              }`}
            >
              ALL-IN
            </button>
            <button
              type="button"
              onClick={() => setProductType('NODAL')}
              className={`min-h-[44px] flex-1 rounded-sm px-2 text-xs font-bold tracking-wider ${
                productType === 'NODAL'
                  ? 'bg-fuchsia-700/25 text-fuchsia-100 shadow-[inset_0_0_12px_rgba(217,70,239,0.35)]'
                  : 'text-slate-500 hover:text-fuchsia-200'
              }`}
            >
              NODAL PT
            </button>
          </div>
        </div>
      </div>

      <DiscoveryPullBlock
        key={filterSignature}
        rates={currentRatesPool}
        selectedTerms={selectedTerms}
        columnSuppliers={columnSuppliers}
        ctx={ctx}
      />
    </div>
  )
}
