import { useCallback, useEffect, useState } from "react"
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

type WebhookLoadStatus = "loading" | "ready" | "error" | "logged-out"

export function WebhookTriggerConfigForm({
  value,
  onChange,
}: {
  readonly value: WebhookTriggerConfig
  readonly onChange: (value: WebhookTriggerConfig) => void
}) {
  const [webhooks, setWebhooks] = useState<DashboardWebhookDto[]>([])
  const [status, setStatus] = useState<WebhookLoadStatus>("loading")

  const loadWebhooks = useCallback(() => {
    const accountBridge = window.synapse?.account
    if (!accountBridge) {
      setWebhooks([])
      setStatus("error")
      return
    }
    setStatus("loading")
    void (async () => {
      const accountState = await accountBridge.getState()
      if (accountState.status !== "authenticated") {
        setWebhooks([])
        setStatus("logged-out")
        return
      }

      const items = await accountBridge.listWebhooks()
      setWebhooks(items)
      setStatus("ready")
    })()
      .catch(() => {
        setWebhooks([])
        setStatus("error")
      })
  }, [])

  useEffect(() => {
    loadWebhooks()
    return window.synapse?.account?.onStateChanged((event) => {
      if (event.state.status === "authenticated") {
        loadWebhooks()
        return
      }

      setWebhooks([])
      setStatus("logged-out")
    })
  }, [loadWebhooks])

  const selectedWebhook = webhooks.find((webhook) => webhook.publicId === value.webhookPublicId)
  const isMissing = status === "ready" && value.webhookPublicId && !selectedWebhook

  return (
    <div className="grid gap-4">
      <Field>
        <FieldLabel>Webhook</FieldLabel>
        <FieldContent>
          {status === "loading" ? (
            <div className="text-sm text-muted-foreground">加载中...</div>
          ) : status === "logged-out" ? (
            <div className="text-sm text-muted-foreground">登录后可选择 Webhook</div>
          ) : status === "error" ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">加载失败</span>
              <Button type="button" variant="outline" size="sm" onClick={loadWebhooks}>
                重试
              </Button>
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
