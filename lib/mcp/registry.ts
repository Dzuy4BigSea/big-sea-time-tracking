import 'server-only'
import type { Tool } from './context'
import { directoryTools } from './tools/directory'
import { projectTools } from './tools/projects'
import { timeTools } from './tools/time'
import { invoiceTools } from './tools/invoices'
import { expenseTools } from './tools/expenses'

/**
 * Every tool the Track2 MCP server exposes (specs/22 mapping table). Not exposed in v1, by design:
 * send_invoice, record_payment, delete_invoice (outbound / money-moving — done in the web app).
 */
export const MCP_TOOLS: Tool[] = [...directoryTools, ...projectTools, ...timeTools, ...invoiceTools, ...expenseTools]
