import type { MainActionDefinition } from "../../../electron/action-runtime/action-registry"
import { forwardWebhook, WebhookForwardError } from "../../../electron/runtime/network/webhook-forward"
import { getEphemeralWebhookRequest } from "../../../electron/services/automation/ephemeral-webhook-request"
import { webhookForwardActionManifest } from "./manifest"
import type { WebhookForwardActionConfig } from "./schema"

export function createWebhookForwardAction(): MainActionDefinition<WebhookForwardActionConfig> {
  return {
    manifest: webhookForwardActionManifest,
    buildPermissionRequest: ({ config, context }) => ({
      action: "network.connect", actor: context.actor, resource: new URL(config.url).origin,
      context: { source: "automation", actionType: webhookForwardActionManifest.id, taskId: context.taskId, runId: context.runId },
    }),
    execute: async ({ config, context }) => {
      const raw = getEphemeralWebhookRequest(context.triggerInput)
      if (!raw) return { status: "failed", error: "缺少实时原始 Webhook 请求，不能使用历史记录转发", errorCode: "raw_request_unavailable" }
      const start = Date.now()
      try {
        const result = await forwardWebhook(config.url, raw, context.abortSignal)
        return { status: "success", summary: "转发成功", outputs: { method: raw.method, bodyBytes: result.bodyBytes, bodySha256: result.bodySha256, attempts: result.attempts }, metrics: { httpStatus: result.status, durationMs: Date.now() - start } }
      } catch (error) {
        const code = error instanceof WebhookForwardError ? error.code : "forward_failed"
        return { status: code === "cancelled" ? "cancelled" : code === "timeout" ? "timeout" : "failed", error: `接口转发失败：${code}`, errorCode: code, metrics: { durationMs: Date.now() - start, ...(error instanceof WebhookForwardError && error.status ? { httpStatus: error.status } : {}) } }
      }
    },
  }
}
