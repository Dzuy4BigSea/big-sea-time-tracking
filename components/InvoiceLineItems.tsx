import { formatCents } from '@/lib/format'
import type { InvoiceAppearanceView } from '@/lib/appearance'

export interface InvoiceLineItemView {
  id: string
  description: string
  quantity: number
  unitPriceCents: number
  amountCents: number
}

/**
 * Invoice line-item table, honoring the account's column-visibility settings
 * (InvoiceAppearance). Shared by the internal detail view and the public /i/[token] view.
 */
export function InvoiceLineItems({
  items,
  appearance,
  currency,
}: {
  items: InvoiceLineItemView[]
  appearance: InvoiceAppearanceView
  currency: string
}) {
  const showQty = appearance.showQuantityCol
  const showUnit = appearance.showUnitPriceCol
  const showAmount = appearance.showAmountCol

  return (
    <table className="mt-6 w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
          <th className="py-2 font-medium">Description</th>
          {showQty && <th className="py-2 text-right font-medium">Qty</th>}
          {showUnit && <th className="py-2 text-right font-medium">Unit price</th>}
          {showAmount && <th className="py-2 text-right font-medium">Amount</th>}
        </tr>
      </thead>
      <tbody>
        {items.map((li) => (
          <tr key={li.id} className="border-b border-gray-100">
            <td className="py-2 pr-4">{li.description}</td>
            {showQty && <td className="py-2 text-right text-gray-600">{li.quantity}</td>}
            {showUnit && <td className="py-2 text-right text-gray-600">{formatCents(li.unitPriceCents, currency)}</td>}
            {showAmount && <td className="py-2 text-right">{formatCents(li.amountCents, currency)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
