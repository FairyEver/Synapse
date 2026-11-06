import { automationFormatIssue } from "../../../automation-trigger-packages/compatibility"
import type { AutomationItem } from "../automation/types"
import { mailInternalReceivedManifest } from "../../../automation-trigger-packages/builtin/mail-internal-received/manifest"
import { mailReceivedManifest } from "../../../automation-trigger-packages/builtin/mail-received/manifest"

const mailTypes: ReadonlySet<string> = new Set([mailInternalReceivedManifest.id, mailReceivedManifest.id])
/** Importing configuration never imports a machine's live receipt subscription. */
export function sanitizeImportedMailAutomation(value: unknown, types: ReadonlySet<string> = mailTypes): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const row = value as Record<string, unknown>
  const trigger = row.trigger as { type?: unknown } | undefined
  const portable = { ...row }
  delete portable.mailSubscription
  return typeof trigger?.type === "string" && types.has(trigger.type) ? { ...portable, enabled: false, nextRunAt: undefined } : portable
}

/** 不支持的格式只读保留，导入不得恢复其自动执行。 */
export function sanitizeImportedAutomation(value: unknown, types: ReadonlySet<string> = mailTypes): unknown {
  const portable = sanitizeImportedMailAutomation(value, types)
  if (!portable || typeof portable !== "object" || Array.isArray(portable)) return portable
  const row = portable as Record<string, unknown>
  return automationFormatIssue(row as unknown as AutomationItem) ? { ...row, enabled: false, nextRunAt: undefined } : portable
}
