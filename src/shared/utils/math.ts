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

/**
 * True when annual usage falls inside [minUsageKwh, maxUsageKwh].
 * When `maxUsageKwh` is omitted, only the lower bound is enforced.
 */
export function isWithinUsage(
  usageKwh: number,
  minUsageKwh: number,
  maxUsageKwh?: number,
): boolean {
  if (!Number.isFinite(usageKwh) || !Number.isFinite(minUsageKwh)) {
    return false
  }
  if (usageKwh < minUsageKwh) {
    return false
  }
  if (maxUsageKwh === undefined) {
    return true
  }
  if (!Number.isFinite(maxUsageKwh)) {
    return false
  }
  return usageKwh <= maxUsageKwh
}

export type { CommissionPayoutStructureId }
