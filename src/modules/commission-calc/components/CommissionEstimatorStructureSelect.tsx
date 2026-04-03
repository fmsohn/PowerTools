import { SLAB_NEON_FIELD_CLASS } from '../../../shared/components/ValidatedInput'
import {
  isCommissionPayoutStructureId,
  type CommissionPayoutStructureId,
  PAYOUT_STRUCTURE_OPTIONS,
} from '../config/payouts'

export interface CommissionEstimatorStructureSelectProps {
  readonly value: CommissionPayoutStructureId
  readonly onChange: (value: CommissionPayoutStructureId) => void
}

export function CommissionEstimatorStructureSelect({
  value,
  onChange,
}: CommissionEstimatorStructureSelectProps) {
  return (
    <div className="flex flex-col gap-1 text-left">
      <label
        htmlFor="commission-structure"
        className="text-[10px] font-bold uppercase tracking-wider text-cyan-400/80"
      >
        Payout structure
      </label>
      <select
        id="commission-structure"
        className={SLAB_NEON_FIELD_CLASS}
        value={value}
        onChange={(e) => {
          const v = e.target.value
          if (isCommissionPayoutStructureId(v)) onChange(v)
        }}
      >
        {PAYOUT_STRUCTURE_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
