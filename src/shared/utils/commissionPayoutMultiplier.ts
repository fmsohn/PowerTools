export type CommissionPayoutStructureId =
  | 'upfront_annual'
  | 'upfront_2yr'
  | 'upfront_3yr'
  | 'pct_50_term'
  | 'pct_75_term'
  | 'pct_90_term'

const MAX_MONTHS_UPFRONT_ANNUAL = 12
const MAX_MONTHS_UPFRONT_2YR = 24
const MAX_MONTHS_UPFRONT_3YR = 36

/**
 * Dimensionless multiplier for (annualUsageKwh * marginPerKwh * brokerSplit).
 * Upfront options: capped months / 12 (years of margin at signing).
 * Percent-of-term: fraction of full-term commission (term/12 annual increments).
 */
export function getStructureMultiplier(
  termMonths: number,
  structure: CommissionPayoutStructureId,
): number {
  switch (structure) {
    case 'upfront_annual':
      return Math.min(MAX_MONTHS_UPFRONT_ANNUAL, termMonths) / 12
    case 'upfront_2yr':
      return Math.min(MAX_MONTHS_UPFRONT_2YR, termMonths) / 12
    case 'upfront_3yr':
      return Math.min(MAX_MONTHS_UPFRONT_3YR, termMonths) / 12
    case 'pct_50_term':
      return 0.5 * (termMonths / 12)
    case 'pct_75_term':
      return 0.75 * (termMonths / 12)
    case 'pct_90_term':
      return 0.9 * (termMonths / 12)
  }
}
