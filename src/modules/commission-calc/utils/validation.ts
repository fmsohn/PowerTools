import type { CommissionPayoutStructureId } from '../config/payouts'

export interface CommissionEstimateInputs {
  readonly usageKwh: number
  readonly marginPerKwh: number
  readonly brokerSplit: number
  readonly termMonths: number
  readonly structure: CommissionPayoutStructureId
}

export type CommissionValidationIssueCode =
  | 'negative_value'
  | 'broker_split_over_one'
  | 'margin_over_cap'

export interface CommissionValidationIssue {
  readonly code: CommissionValidationIssueCode
  readonly message: string
}

const MAX_MARGIN_PER_KWH = 0.05

export function validateCommissionInputs(
  inputs: CommissionEstimateInputs,
): readonly CommissionValidationIssue[] {
  const issues: CommissionValidationIssue[] = []

  if (
    inputs.usageKwh < 0 ||
    inputs.marginPerKwh < 0 ||
    inputs.brokerSplit < 0 ||
    inputs.termMonths < 0
  ) {
    issues.push({
      code: 'negative_value',
      message: 'Usage, margin, broker split, and term must be zero or positive.',
    })
  }

  if (inputs.brokerSplit > 1) {
    issues.push({
      code: 'broker_split_over_one',
      message: 'Broker split cannot exceed 1.0 (100%).',
    })
  }

  if (inputs.marginPerKwh > MAX_MARGIN_PER_KWH) {
    issues.push({
      code: 'margin_over_cap',
      message: `Margin cannot exceed ${MAX_MARGIN_PER_KWH} $/kWh for this estimator.`,
    })
  }

  return issues
}
