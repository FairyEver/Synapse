import { useCallback, useEffect, useState } from "react"
import { ExternalLink } from "lucide-react"
import type { DashboardWebhookDto } from "@synapse/shared"

import { requestOpenSettingsAccount } from "@/app-shell/navigation"
import { ConfigurationFieldError, configurationFieldProps, type ConfigurationFieldErrors } from "../../../src/components/configuration-field-error"
import { createRendererLogger } from "@/app-shell/logging"
import { buildAccountWebhookCreationUrl } from "@/lib/account-dashboard-url"
import { requireBridgeDomain } from "@/lib/electron-bridge"
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

const logger = createRendererLogger("automation.webhook-config")

function useOpenWebhookCreation() {
  const [error, setError] = useState(false)
  const open = useCallback(async () => {
    setError(false)
    try {
      await requireBridgeDomain("shell").openExternal(buildAccountWebhookCreationUrl())
    } catch (error) {
      logger.warn("Failed to open Webhook creation page.", { error })
      setError(true)
    }
  }, [])
  return { open, error }
}

export function WebhookTriggerConfigForm({
  value,
  onChange,
  fieldErrors,
}: {
  readonly fieldErrors?: ConfigurationFieldErrors
  readonly value: WebhookTriggerConfig
  readonly onChange: (value: WebhookTriggerConfig) => void
}) {
  const [webhooks, setWebhooks] = useState<DashboardWebhookDto[]>([])
  const [status, setStatus] = useState<WebhookLoadStatus>("loading")
  const creation = useOpenWebhookCreation()

  const loadWebhooks = useCallback(() => {
    const accountBridge = window.synapse?.account
    if (!accountBridge) {
      setWebhooks([])
      setStatus("error")
      return
    }
    setStatus("loading")
    void (async () => {
      const accountState = await accountBridge.state.get()
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
    window.addEventListener("focus", loadWebhooks)
    const unsubscribe = window.synapse?.account?.state.onChanged((event) => {
      if (event.state.status === "authenticated") {
        loadWebhooks()
        return
      }

      setWebhooks([])
      setStatus("logged-out")
    })
    return () => {
      window.removeEventListener("focus", loadWebhooks)
      unsubscribe?.()
    }
  }, [loadWebhooks])

  const selectedWebhook = webhooks.find((webhook) => webhook.publicId === value.webhookPublicId)
  const savedWebhookLabel = value.webhookName || value.webhookPublicId || ""
  const isMissing = status === "ready" && value.webhookPublicId && !selectedWebhook
  const isDisabled = status === "ready" && selectedWebhook?.enabled === false

  return (
    <div className="grid gap-4">
      <Field>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor="automation-webhook-select">Webhook</FieldLabel>
          <Button type="button" variant="ghost" onClick={() => void creation.open()}>
            创建 Webhook
            <ExternalLink data-icon="inline-end" />
          </Button>
        </div>
        <FieldContent>
          {creation.error ? (
            <div role="alert" className="text-sm text-destructive">无法打开 Webhook 创建页面</div>
          ) : null}
          {status === "loading" ? (
            <div className="text-sm text-muted-foreground">加载中...</div>
          ) : status === "logged-out" ? (
            <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-muted-foreground">登录后可选择 Webhook</span><Button type="button" variant="outline" onClick={requestOpenSettingsAccount}>登录</Button></div>
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
                <Button type="button" variant="outline" size="default" onClick={loadWebhooks}>
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
              <SelectTrigger id="automation-webhook-select" {...configurationFieldProps(fieldErrors, "webhookPublicId", "automation-webhook-select")} className="w-full">
                <SelectValue placeholder="选择 Webhook" />
              </SelectTrigger>
              <SelectContent>
                {!webhooks.length ? <p className="px-2 py-1 text-sm text-muted-foreground">暂无 Webhook，请先创建</p> : null}
                {webhooks.map((webhook) => (
                  <SelectItem key={webhook.id} value={webhook.publicId} disabled={!webhook.enabled}>
                    {webhook.enabled ? webhook.name : `${webhook.name}（停用）`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <ConfigurationFieldError errors={fieldErrors} name="webhookPublicId" id="automation-webhook-select" />
          {isMissing ? (
            <div className="text-sm text-destructive">Webhook 不存在或已删除</div>
          ) : null}
          {isDisabled ? (
            <div className="text-sm text-destructive">
              Webhook 已停用，启用后才会触发自动化
            </div>
          ) : null}
        </FieldContent>
      </Field>
    </div>
  )
}
