import { ValidatedInput } from '../../../shared/components/ValidatedInput'
import { formatUsd, formatUsage } from '../../../shared/utils/formatters'
import type {
  CommissionEstimatorDerived,
  CommissionEstimatorFormState,
} from '../hooks/useCommissionEstimator'
import { CommissionEstimatorStructureSelect } from './CommissionEstimatorStructureSelect'

const FIELD_LABEL_CLASS =
  'text-[10px] font-bold uppercase tracking-wider text-cyan-400/80'

export interface CommissionEstimatorFieldsProps {
  readonly form: CommissionEstimatorFormState
  readonly derived: CommissionEstimatorDerived
}

function formatTermUsageKwh(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

export function CommissionEstimatorFields({
  form,
  derived,
}: CommissionEstimatorFieldsProps) {
  const invalid =
    derived.inputsReady && derived.validationMessages.length > 0

  return (
    <div className="flex flex-col gap-5 pb-safe">
      <div className="grid grid-cols-2 gap-2">
        <ValidatedInput
          label="Annual Usage"
          hint="Total kWh customer consumes in a year."
          labelClassName={FIELD_LABEL_CLASS}
          value={formatUsage(form.usageStr)}
          persistValue={form.usageStr}
          onChange={form.setUsageStr}
          transformOnChange={(raw) => raw.replace(/,/g, '')}
          type="text"
          inputMode="numeric"
          min="0"
          step="1"
          inputClassName="text-base font-mono"
          aria-invalid={invalid}
        />

        <div className="flex flex-col gap-1 text-left">
          <span className={FIELD_LABEL_CLASS}>Total Term Usage</span>
          <div className="flex min-h-[44px] w-full items-center rounded-md border-4 border-cyan-900/50 bg-black px-3 py-2 font-mono text-sm text-slate-500 shadow-slab-dark">
            {formatTermUsageKwh(derived.dealData.termUsage)} kWh
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-1">
          <ValidatedInput
            label="Margin"
            hint="Enter as decimal. 1 cent = 0.01."
            labelClassName={FIELD_LABEL_CLASS}
            value={form.marginStr}
            onChange={form.setMarginStr}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.001"
            slabBorderClassName={
              derived.marginMilsWarning
                ? 'animate-pulse border-amber-500'
                : undefined
            }
            aria-invalid={invalid}
          />
        </div>

        <div className="col-span-1">
          <ValidatedInput
            label="Term"
            labelClassName={FIELD_LABEL_CLASS}
            value={form.termStr}
            onChange={form.setTermStr}
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            aria-invalid={invalid}
          />
        </div>

        <div className="col-span-1">
          <ValidatedInput
            label="Broker Split"
            labelClassName={FIELD_LABEL_CLASS}
            value={form.brokerSplitStr}
            onChange={form.setBrokerSplitStr}
            type="number"
            inputMode="decimal"
            min="0"
            max="1"
            step="0.01"
            aria-invalid={invalid}
          />
        </div>
      </div>

      <CommissionEstimatorStructureSelect
        value={form.structure}
        onChange={form.setStructure}
      />

      <div className="flex flex-col gap-4 border-t border-border-subtle pt-5">
        <div className="flex flex-col gap-1 text-left">
          <span className={FIELD_LABEL_CLASS}>Estimated Upfront Payment</span>
          {derived.estimatedCommissionUsd !== null ? (
            <p className="font-mono text-2xl text-cyan-400">
              {formatUsd(derived.estimatedCommissionUsd)}
            </p>
          ) : (
            <p className="font-mono text-2xl text-cyan-400/40">
              {derived.inputsReady
                ? '—'
                : 'Enter fields to estimate.'}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1 text-left">
          <span className={FIELD_LABEL_CLASS}>Total Contract Value</span>
          <p className="font-mono text-sm text-slate-400">
            {formatUsd(derived.totalContractValueUsd)}
          </p>
        </div>
      </div>
    </div>
  )
}
