import { mailInternalReceivedManifest } from "../../../automation-trigger-packages/builtin/mail-internal-received/manifest"
import { mailReceivedManifest } from "../../../automation-trigger-packages/builtin/mail-received/manifest"

const mailTypes: ReadonlySet<string> = new Set([mailInternalReceivedManifest.id, mailReceivedManifest.id])
/** Importing configuration never imports a machine's live receipt subscription. */
export function sanitizeImportedMailAutomation(value: unknown, types: ReadonlySet<string> = mailTypes): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const row = value as Record<string, unknown>
  const trigger = row.trigger as { type?: unknown } | undefined
  const { mailSubscription: _local, ...portable } = row
  return typeof trigger?.type === "string" && types.has(trigger.type) ? { ...portable, enabled: false, nextRunAt: undefined } : portable
}
