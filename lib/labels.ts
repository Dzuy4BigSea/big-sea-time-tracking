import type { DisplayBadge } from '@/modules/invoicing/invoiceState'

export const BADGE_STYLES: Record<DisplayBadge, string> = {
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-blue-100 text-blue-700',
  pending: 'bg-teal-100 text-teal-700',
  late: 'bg-red-100 text-red-700',
  paid: 'bg-green-100 text-green-700',
  written_off: 'bg-gray-100 text-gray-500',
  closed: 'bg-gray-100 text-gray-500',
}

export const BADGE_LABEL: Record<DisplayBadge, string> = {
  draft: 'Draft',
  sent: 'Sent',
  pending: 'Pending',
  late: 'Late',
  paid: 'Paid',
  written_off: 'Written off',
  closed: 'Closed',
}

export const PAYMENT_TERM_LABEL: Record<string, string> = {
  due_on_receipt: 'Due on receipt',
  net_15: 'Net 15',
  net_30: 'Net 30',
  net_45: 'Net 45',
  net_60: 'Net 60',
  custom: 'Custom',
}

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  check: 'Check',
  bank_transfer: 'Bank transfer',
  card: 'Card',
  other: 'Other',
}
