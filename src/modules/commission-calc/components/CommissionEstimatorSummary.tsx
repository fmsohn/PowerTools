import type { CommissionEstimatorDerived } from '../hooks/useCommissionEstimator'

export interface CommissionEstimatorSummaryProps {
  readonly derived: CommissionEstimatorDerived
}

export function CommissionEstimatorSummary({
  derived,
}: CommissionEstimatorSummaryProps) {
  if (derived.validationMessages.length === 0) {
    return null
  }

  return (
    <div className="mt-6 rounded-lg border-4 border-amber-500/40 bg-code-bg px-4 py-4 text-left">
      <h2 className="mb-2 mt-0 text-sm font-medium text-amber-200">
        Fix these issues
      </h2>
      <ul className="list-disc space-y-1 pl-5 text-sm text-amber-100/90">
        {derived.validationMessages.map((msg) => (
          <li key={msg}>{msg}</li>
        ))}
      </ul>
    </div>
  )
}
