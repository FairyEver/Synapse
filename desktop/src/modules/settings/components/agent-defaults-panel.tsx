import { useCallback, useEffect, useState } from "react"
import { ChevronDown } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FieldGroup } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { ProviderModelSelectDialog } from "@/components/provider-model-select-dialog"
import { useProviderModelLabel } from "@/lib/provider-model"
import { AgentPermissionModeMenu } from "@/modules/agent/components/permission-mode-menu"
import { permissionModeLabels } from "@/modules/agent/permission-mode-options"
import { SettingsFieldRow } from "@/modules/settings/components/settings-field-row"
import type { SynapseAgentPermissionMode } from "@/types/agent"
import type { ProviderModelSelection } from "@/types/provider-model"

const logger = createRendererLogger("settings.agent-defaults")
const TOKEN_THRESHOLD_UNIT = 10_000
const DEFAULTS_FIELD_ROW_CLASSNAME = "grid gap-2 md:grid-cols-[12rem_minmax(0,28rem)] md:items-center md:gap-4"
const DEFAULTS_FIELD_CONTENT_CLASSNAME = "min-w-0 md:max-w-none"
const DEFAULTS_FIELD_CONTROL_CLASSNAME = "w-full"

function AgentDefaultsContent() {
  const { config, updateConfig } = useAppConfig()
  const { promise } = useAppNotifications()
  const [pendingMode, setPendingMode] = useState<SynapseAgentPermissionMode | null>(null)
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const selectedMode = config.agent.defaultPermissionMode
  const defaultPM = config.agent.defaultProviderModel
  const rolloverPrompt = config.agent.conversationRolloverPrompt
  const resolvedLabel = useProviderModelLabel(defaultPM)
  const [costThresholdDraft, setCostThresholdDraft] = useState(String(rolloverPrompt.costThresholdCny))
  const [tokenThresholdDraft, setTokenThresholdDraft] = useState(
    String(rolloverPrompt.tokenThreshold / TOKEN_THRESHOLD_UNIT),
  )
  const [costThresholdError, setCostThresholdError] = useState<string | null>(null)
  const [tokenThresholdError, setTokenThresholdError] = useState<string | null>(null)

  useEffect(() => {
    setCostThresholdDraft(String(rolloverPrompt.costThresholdCny))
    setTokenThresholdDraft(String(rolloverPrompt.tokenThreshold / TOKEN_THRESHOLD_UNIT))
    setCostThresholdError(null)
    setTokenThresholdError(null)
  }, [rolloverPrompt.costThresholdCny, rolloverPrompt.tokenThreshold])

  const saveDefaultPermissionMode = async (nextMode: SynapseAgentPermissionMode) => {
    try {
      await promise(
        () => updateConfig({ agent: { defaultPermissionMode: nextMode } }),
        {
          loading: "正在保存设置...",
          success: () => "设置已保存。",
          error: (error) => error instanceof Error ? error.message : "保存设置失败。",
        },
      )
    } catch (error) {
      logger.error("Agent default permission setting save failed.", error)
    }
  }

  const saveDefaultProviderModel = useCallback(async (selection: ProviderModelSelection | null) => {
    const value = selection ? { providerId: selection.providerId, modelTier: selection.modelTier } : null
    try {
      await promise(
        () => updateConfig({ agent: { defaultProviderModel: value } }),
        {
          loading: "正在保存设置...",
          success: () => "设置已保存。",
          error: (error) => error instanceof Error ? error.message : "保存设置失败。",
        },
      )
    } catch (error) {
      logger.error("Agent default provider model save failed.", error)
    }
  }, [promise, updateConfig])

  const saveConversationRolloverPrompt = useCallback(async (
    nextPrompt: typeof rolloverPrompt,
  ) => {
    try {
      await promise(
        () => updateConfig({ agent: { conversationRolloverPrompt: nextPrompt } }),
        {
          loading: "正在保存设置...",
          success: () => "设置已保存。",
          error: (error) => error instanceof Error ? error.message : "保存设置失败。",
        },
      )
    } catch (error) {
      logger.error("Agent conversation rollover threshold save failed.", error)
    }
  }, [promise, updateConfig])

  const saveCostThresholdDraft = () => {
    const nextValue = Number(costThresholdDraft)
    if (!Number.isFinite(nextValue) || nextValue <= 0) {
      setCostThresholdError("请输入大于 0 的金额。")
      return
    }
    setCostThresholdError(null)
    if (nextValue === rolloverPrompt.costThresholdCny) return
    void saveConversationRolloverPrompt({
      ...rolloverPrompt,
      costThresholdCny: nextValue,
    })
  }

  const saveTokenThresholdDraft = () => {
    const normalizedDraft = tokenThresholdDraft.trim()
    const nextWanTokens = Number(normalizedDraft)
    if (!/^\d+$/.test(normalizedDraft) || nextWanTokens <= 0) {
      setTokenThresholdError("请输入大于 0 的整数。")
      return
    }
    const tokenThreshold = nextWanTokens * TOKEN_THRESHOLD_UNIT
    setTokenThresholdError(null)
    if (tokenThreshold === rolloverPrompt.tokenThreshold) return
    void saveConversationRolloverPrompt({
      ...rolloverPrompt,
      tokenThreshold,
    })
  }

  const selectPermissionMode = (mode: SynapseAgentPermissionMode) => {
    if (mode === selectedMode) return
    if (mode === "bypassPermissions") {
      setPendingMode(mode)
      return
    }
    void saveDefaultPermissionMode(mode)
  }

  return (
    <>
      <FieldGroup className="gap-3">
        <SettingsFieldRow
          className={DEFAULTS_FIELD_ROW_CLASSNAME}
          contentClassName={DEFAULTS_FIELD_CONTENT_CLASSNAME}
          label="默认权限模式"
          controlClassName={DEFAULTS_FIELD_CONTROL_CLASSNAME}
        >
          <AgentPermissionModeMenu
            selectedMode={selectedMode}
            onSelect={selectPermissionMode}
            trigger={(
              <Button
                type="button"
                variant="outline"
                className="w-full justify-between"
                aria-label="默认权限"
              >
                <span className="truncate">{permissionModeLabels[selectedMode]}</span>
                <ChevronDown data-icon="inline-end" />
              </Button>
            )}
          />
        </SettingsFieldRow>
        <SettingsFieldRow
          className={DEFAULTS_FIELD_ROW_CLASSNAME}
          contentClassName={DEFAULTS_FIELD_CONTENT_CLASSNAME}
          label="默认供应商和模型"
          controlClassName={DEFAULTS_FIELD_CONTROL_CLASSNAME}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-w-0 flex-1 justify-between"
              aria-label="默认供应商"
              onClick={() => setProviderDialogOpen(true)}
            >
              <span className="min-w-0 truncate text-muted-foreground">
                {defaultPM ? resolvedLabel || "..." : "选择供应商 + 模型"}
              </span>
              <ChevronDown data-icon="inline-end" />
            </Button>
            {defaultPM ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                aria-label="清除默认供应商"
                onClick={() => void saveDefaultProviderModel(null)}
              >
                清除
              </Button>
            ) : null}
          </div>
          <ProviderModelSelectDialog
            open={providerDialogOpen}
            onOpenChange={setProviderDialogOpen}
            defaultSelection={defaultPM ?? undefined}
            onSelect={(selection) => saveDefaultProviderModel(selection)}
          />
        </SettingsFieldRow>
        <SettingsFieldRow
          className={DEFAULTS_FIELD_ROW_CLASSNAME}
          contentClassName={DEFAULTS_FIELD_CONTENT_CLASSNAME}
          label="长对话金额阈值"
          error={costThresholdError}
          controlClassName={DEFAULTS_FIELD_CONTROL_CLASSNAME}
        >
          <InputGroup>
            <InputGroupInput
              aria-label="长对话金额阈值"
              aria-invalid={costThresholdError ? true : undefined}
              className="text-right"
              inputMode="decimal"
              value={costThresholdDraft}
              onChange={(event) => {
                setCostThresholdDraft(event.currentTarget.value)
                setCostThresholdError(null)
              }}
              onBlur={saveCostThresholdDraft}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur()
                }
              }}
            />
            <InputGroupAddon align="inline-end">元</InputGroupAddon>
          </InputGroup>
        </SettingsFieldRow>
        <SettingsFieldRow
          className={DEFAULTS_FIELD_ROW_CLASSNAME}
          contentClassName={DEFAULTS_FIELD_CONTENT_CLASSNAME}
          label="长对话 Token 阈值"
          error={tokenThresholdError}
          controlClassName={DEFAULTS_FIELD_CONTROL_CLASSNAME}
        >
          <InputGroup>
            <InputGroupInput
              aria-label="长对话 Token 阈值"
              aria-invalid={tokenThresholdError ? true : undefined}
              className="text-right"
              inputMode="numeric"
              value={tokenThresholdDraft}
              onChange={(event) => {
                setTokenThresholdDraft(event.currentTarget.value)
                setTokenThresholdError(null)
              }}
              onBlur={saveTokenThresholdDraft}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur()
                }
              }}
            />
            <InputGroupAddon align="inline-end">万 token</InputGroupAddon>
          </InputGroup>
        </SettingsFieldRow>
      </FieldGroup>
      <AlertDialog open={pendingMode !== null} onOpenChange={(open) => {
        if (!open) {
          setPendingMode(null)
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>启用默认跳过权限</AlertDialogTitle>
            <AlertDialogDescription>
              新建 Agent 对话将跳过工具权限确认。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const mode = pendingMode
                setPendingMode(null)
                if (mode) {
                  void saveDefaultPermissionMode(mode)
                }
              }}
            >
              启用
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function AgentDefaultsPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">模型默认设置</CardTitle>
      </CardHeader>
      <CardContent>
        <AgentDefaultsContent />
      </CardContent>
    </Card>
  )
}

export { AgentDefaultsPanel, AgentDefaultsContent }
