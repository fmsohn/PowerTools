import { CommissionEstimatorFields } from './CommissionEstimatorFields'
import { CommissionEstimatorSummary } from './CommissionEstimatorSummary'
import { useCommissionEstimator } from '../hooks/useCommissionEstimator'

export function CommissionEstimator() {
  const { form, derived } = useCommissionEstimator()

  return (
    <section
      className="flex w-full max-w-lg flex-col px-4 py-8 text-left"
      aria-labelledby="commission-estimator-title"
    >
      <h1
        id="commission-estimator-title"
        className="mb-2 mt-0 text-3xl font-medium text-text-h"
      >
        Commission Estimator
      </h1>
      <p className="mb-6 text-sm text-text">
        Model broker commission from usage, margin, and payout structure.
      </p>

      <CommissionEstimatorFields form={form} derived={derived} />
      <CommissionEstimatorSummary derived={derived} />

      <footer className="mt-10 border-t border-border-subtle pt-4 text-center text-xs text-text">
        Estimates only. Subject to final supplier verification.
      </footer>
    </section>
  )
}
