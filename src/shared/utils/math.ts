import {
  getStructureMultiplier,
  type CommissionPayoutStructureId,
} from './commissionPayoutMultiplier'

/**
 * Estimated broker commission ($) from annual usage, $/kWh margin, split, term, and payout structure.
 * Formula: usageKwh * marginPerKwh * structureMultiplier * brokerSplit.
 */
export function calculateEstimatedCommission(
  usageKwh: number,
  marginPerKwh: number,
  brokerSplit: number,
  termMonths: number,
  structure: CommissionPayoutStructureId,
): number {
  const structureMultiplier = getStructureMultiplier(termMonths, structure)
  return usageKwh * marginPerKwh * structureMultiplier * brokerSplit
}

export type { CommissionPayoutStructureId }
