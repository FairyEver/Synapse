import { useEffect, useState } from "react"
import type { DashboardWebhookDto } from "@synapse/shared"

import {
  Field,
  FieldContent,
  FieldLabel,
} from "../../../src/components/ui/field"
import { Button } from "../../../src/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../src/components/ui/select"
import type { WebhookTriggerConfig } from "./schema"

export function WebhookTriggerConfigForm({
  value,
  onChange,
}: {
  readonly value: WebhookTriggerConfig
  readonly onChange: (value: WebhookTriggerConfig) => void
}) {
  const [webhooks, setWebhooks] = useState<DashboardWebhookDto[]>([])
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")

  const loadWebhooks = () => {
    const accountBridge = window.synapse?.account
    if (!accountBridge) {
      setWebhooks([])
      setStatus("error")
      return
    }
    setStatus("loading")
    accountBridge.listWebhooks()
      .then((items) => {
        setWebhooks(items)
        setStatus("ready")
      })
      .catch(() => {
        setWebhooks([])
        setStatus("error")
      })
  }

  useEffect(() => {
    loadWebhooks()
  }, [])

  const selectedWebhook = webhooks.find((webhook) => webhook.publicId === value.webhookPublicId)
  const savedWebhookLabel = value.webhookName || value.webhookPublicId || ""
  const isMissing = status === "ready" && value.webhookPublicId && !selectedWebhook

  return (
    <div className="grid gap-4">
      <Field>
        <FieldLabel>Webhook</FieldLabel>
        <FieldContent>
          {status === "loading" ? (
            <div className="text-sm text-muted-foreground">加载中...</div>
          ) : status === "error" ? (
            <div className="grid gap-2">
              {savedWebhookLabel ? (
                <Button type="button" variant="outline" className="w-full justify-start font-normal" disabled>
                  {savedWebhookLabel}
                </Button>
              ) : null}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {savedWebhookLabel ? "列表加载失败" : "加载失败"}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={loadWebhooks}>
                  重试
                </Button>
              </div>
            </div>
          ) : (
            <Select
              value={selectedWebhook?.publicId ?? ""}
              onValueChange={(publicId) => {
                const webhook = webhooks.find((item) => item.publicId === publicId)
                if (!webhook) return
                onChange({ webhookPublicId: webhook.publicId, webhookName: webhook.name })
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择 Webhook" />
              </SelectTrigger>
              <SelectContent>
                {webhooks.map((webhook) => (
                  <SelectItem key={webhook.id} value={webhook.publicId} disabled={!webhook.enabled}>
                    {webhook.enabled ? webhook.name : `${webhook.name}（停用）`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {isMissing ? (
            <div className="text-sm text-destructive">Webhook 不存在或已删除</div>
          ) : null}
        </FieldContent>
      </Field>
    </div>
  )
}
