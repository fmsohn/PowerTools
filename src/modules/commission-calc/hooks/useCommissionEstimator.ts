import { useEffect, useMemo, useState } from 'react'
import {
  ENERGY_BROKER_SPLIT_DEFAULT,
  ENERGY_BROKER_SPLIT_STORAGE_KEY,
  MARGIN_WARNING,
  TERM_DEFAULT,
} from '../config/constants'
import {
  isCommissionPayoutStructureId,
  type CommissionPayoutStructureId,
} from '../config/payouts'
import { COMMISSION_SESSION_KEYS } from '../config/sessionKeys'
import { validateCommissionInputs } from '../utils/validation'
import { calculateEstimatedCommission } from '../../../shared/utils/math'

function readSession(key: string, fallback: string): string {
  try {
    return sessionStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

/** Empty strings and non-finite values become 0; values clamped with Math.max(0, …). */
function safeNonNegativeNumber(raw: string): number {
  const t = raw.trim().replace(/,/g, '')
  if (t === '') return 0
  const n = Number(t)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

function readBrokerSplitFromLocalStorage(): string {
  try {
    const raw = localStorage.getItem(ENERGY_BROKER_SPLIT_STORAGE_KEY)
    if (raw === null || raw.trim() === '') {
      return String(ENERGY_BROKER_SPLIT_DEFAULT)
    }
    const n = safeNonNegativeNumber(raw)
    if (n <= 0) return String(ENERGY_BROKER_SPLIT_DEFAULT)
    return raw.trim()
  } catch {
    return String(ENERGY_BROKER_SPLIT_DEFAULT)
  }
}

const DEFAULT_STRUCTURE: CommissionPayoutStructureId = 'upfront_annual'

export interface DealData {
  readonly annualUsage: number
  readonly termMonths: number
  readonly termUsage: number
  readonly margin: number
  readonly brokerSplit: number
}

export interface CommissionEstimatorFormState {
  readonly usageStr: string
  readonly setUsageStr: (v: string) => void
  readonly marginStr: string
  readonly setMarginStr: (v: string) => void
  readonly brokerSplitStr: string
  readonly setBrokerSplitStr: (v: string) => void
  readonly termStr: string
  readonly setTermStr: (v: string) => void
  readonly structure: CommissionPayoutStructureId
  readonly setStructure: (v: CommissionPayoutStructureId) => void
}

export interface CommissionEstimatorDerived {
  readonly dealData: DealData
  readonly totalContractValueUsd: number
  readonly inputsReady: boolean
  readonly validationMessages: readonly string[]
  readonly estimatedCommissionUsd: number | null
  readonly marginMilsWarning: boolean
}

export function useCommissionEstimator(): {
  readonly form: CommissionEstimatorFormState
  readonly derived: CommissionEstimatorDerived
} {
  const [usageStr, setUsageStr] = useState('')
  const [marginStr, setMarginStr] = useState('')
  const [brokerSplitStr, setBrokerSplitStr] = useState(
    readBrokerSplitFromLocalStorage,
  )
  const [termStr, setTermStr] = useState(() => String(TERM_DEFAULT))
  const [structure, setStructure] = useState<CommissionPayoutStructureId>(
    () => {
      const raw = readSession(COMMISSION_SESSION_KEYS.structure, '')
      return isCommissionPayoutStructureId(raw) ? raw : DEFAULT_STRUCTURE
    },
  )

  const derived = useMemo((): CommissionEstimatorDerived => {
    const annualUsage = safeNonNegativeNumber(usageStr.replace(/\D/g, ''))
    const termMonths = Math.floor(safeNonNegativeNumber(termStr))
    const margin = safeNonNegativeNumber(marginStr)
    const brokerSplit = safeNonNegativeNumber(brokerSplitStr)
    const termUsage = Math.max(0, (annualUsage / 12) * termMonths)
    const totalContractValueUsd = termUsage * margin * brokerSplit

    const dealData: DealData = {
      annualUsage,
      termMonths,
      termUsage,
      margin,
      brokerSplit,
    }

    const inputsReady =
      annualUsage > 0 &&
      margin > 0 &&
      brokerSplit > 0 &&
      termMonths > 0

    if (!inputsReady) {
      return {
        dealData,
        totalContractValueUsd,
        inputsReady: false,
        validationMessages: [],
        estimatedCommissionUsd: null,
        marginMilsWarning: margin > MARGIN_WARNING,
      }
    }

    const issues = validateCommissionInputs({
      usageKwh: annualUsage,
      marginPerKwh: margin,
      brokerSplit,
      termMonths,
      structure,
    })
    const validationMessages = issues.map((i) => i.message)

    const estimatedCommissionUsd =
      issues.length === 0
        ? calculateEstimatedCommission(
            annualUsage,
            margin,
            brokerSplit,
            termMonths,
            structure,
          )
        : null

    return {
      dealData,
      totalContractValueUsd,
      inputsReady: true,
      validationMessages,
      estimatedCommissionUsd,
      marginMilsWarning: margin > MARGIN_WARNING,
    }
  }, [usageStr, marginStr, brokerSplitStr, termStr, structure])

  useEffect(() => {
    try {
      localStorage.setItem(ENERGY_BROKER_SPLIT_STORAGE_KEY, brokerSplitStr)
    } catch {
      /* ignore */
    }
  }, [brokerSplitStr])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      try {
        sessionStorage.setItem(COMMISSION_SESSION_KEYS.structure, structure)
      } catch {
        /* ignore */
      }
    }, 300)
    return () => window.clearTimeout(handle)
  }, [structure])

  return {
    form: {
      usageStr,
      setUsageStr,
      marginStr,
      setMarginStr,
      brokerSplitStr,
      setBrokerSplitStr,
      termStr,
      setTermStr,
      structure,
      setStructure,
    },
    derived,
  }
}
