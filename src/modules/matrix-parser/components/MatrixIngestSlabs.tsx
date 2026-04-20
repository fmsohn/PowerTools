import type { SupplierSilo } from '../supplierRegistry'

export type SlabState =
  | { readonly kind: 'success'; readonly text: string }
  | { readonly kind: 'unknown_matrix' }
  | {
      readonly kind: 'conflict_detected'
      readonly supplierNames: readonly string[]
    }
  | { readonly kind: 'missing_sheets'; readonly text: string }
  | { readonly kind: 'reject'; readonly text: string }

interface MatrixIngestSlabsProps {
  readonly slab: SlabState | null
  readonly conflict?: {
    readonly matchingSuppliers: readonly SupplierSilo[]
    readonly sheetNames: readonly string[]
  } | null
  readonly onSupplierSelected?: (supplierId: string) => void
}

export function MatrixIngestSlabs({
  slab,
  conflict = null,
  onSupplierSelected,
}: MatrixIngestSlabsProps) {
  if (!slab) {
    return null
  }
  if (slab.kind === 'success') {
    return (
      <div
        className="mt-4 rounded-md border-2 border-[#00FFFF] bg-black px-4 py-3 text-center text-sm text-cyan-200 shadow-[4px_4px_0_0_#000]"
        role="status"
      >
        {slab.text}
      </div>
    )
  }
  if (slab.kind === 'unknown_matrix') {
    return (
      <div
        className="mt-4 rounded-md border-2 border-[#FF00FF] bg-black px-4 py-3 text-center shadow-[4px_4px_0_0_#000]"
        role="alert"
      >
        <p className="m-0 text-sm font-black uppercase tracking-[0.35em] text-[#FF00FF]">
          Unknown Matrix
        </p>
        <p className="mt-2 text-sm text-fuchsia-100/90">
          No supplier sniffer match (filename, sheet name, and header anchors).
        </p>
      </div>
    )
  }
  if (slab.kind === 'conflict_detected') {
    return (
      <div
        className="mt-4 rounded-md border-4 border-[#FFB000] bg-black px-4 py-3 text-center shadow-[6px_6px_0_0_#000,0_0_22px_rgba(255,176,0,0.35)]"
        role="alert"
      >
        <p className="m-0 text-sm font-black uppercase tracking-[0.35em] text-[#FFB000]">
          Supplier Conflict
        </p>
        <p className="mt-2 text-sm text-amber-100/90">
          Multiple supplier silos matched this workbook: {slab.supplierNames.join(', ')}.
        </p>
        {conflict ? (
          <>
            <p className="mt-2 text-xs font-mono text-amber-200/80">
              Tabs: {conflict.sheetNames.join(', ')}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {conflict.matchingSuppliers.map((supplier) => (
                <button
                  key={supplier.id}
                  type="button"
                  onClick={() => onSupplierSelected?.(supplier.id)}
                  className="rounded-md border-2 border-amber-400/70 bg-black px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] text-amber-100 shadow-[4px_4px_0_0_#000] hover:border-amber-200"
                >
                  Use {supplier.name}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    )
  }
  if (slab.kind === 'missing_sheets') {
    return (
      <div
        className="mt-4 rounded-md border-4 border-[#00FFFF] bg-black px-4 py-3 text-center shadow-[6px_6px_0_0_#000,0_0_26px_rgba(0,255,255,0.55),0_0_36px_rgba(255,0,255,0.35)]"
        role="alert"
      >
        <p className="m-0 text-sm font-black uppercase tracking-[0.35em] text-[#00FFFF] drop-shadow-[0_0_8px_rgba(255,0,255,0.9)]">
          Missing Sheet
        </p>
        <p className="mt-2 text-sm text-cyan-100/90">{slab.text}</p>
      </div>
    )
  }
  return (
    <div
      className="mt-4 rounded-md border-2 border-[#FF00FF] bg-black px-4 py-3 text-center text-sm text-fuchsia-100 shadow-[4px_4px_0_0_#000]"
      role="alert"
    >
      {slab.text}
    </div>
  )
}
