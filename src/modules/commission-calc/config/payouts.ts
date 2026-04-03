import type { CommissionPayoutStructureId } from '../../../shared/utils/commissionPayoutMultiplier'

export type { CommissionPayoutStructureId }
export { getStructureMultiplier } from '../../../shared/utils/commissionPayoutMultiplier'

export interface PayoutStructureOption {
  readonly id: CommissionPayoutStructureId
  readonly label: string
}

/** UI labels for each payout structure (caps enforced in shared multiplier helper). */
export const PAYOUT_STRUCTURE_OPTIONS: readonly PayoutStructureOption[] = [
  { id: 'upfront_annual', label: 'Upfront Annual (Max 12mo)' },
  { id: 'upfront_2yr', label: '2yr Upfront (Max 24mo)' },
  { id: 'upfront_3yr', label: '3yr Upfront (Max 36mo)' },
  { id: 'pct_50_term', label: '50% of Term' },
  { id: 'pct_75_term', label: '75% of Term' },
  { id: 'pct_90_term', label: '90% of Term' },
]

export function isCommissionPayoutStructureId(
  value: string,
): value is CommissionPayoutStructureId {
  return PAYOUT_STRUCTURE_OPTIONS.some((o) => o.id === value)
}
