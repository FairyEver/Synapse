import { type ReactNode, useCallback, useState } from "react"
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
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { ProviderModelSelectDialog } from "@/components/provider-model-select-dialog"
import { useProviderModelLabel } from "@/lib/provider-model"
import { AgentPermissionModeMenu } from "@/modules/agent/components/permission-mode-menu"
import { permissionModeLabels } from "@/modules/agent/permission-mode-options"
import type { SynapseAgentPermissionMode } from "@/types/agent"
import type { ProviderModelSelection } from "@/types/provider-model"

const logger = createRendererLogger("settings.agent-defaults")
const DEFAULTS_FIELD_ROW_CLASSNAME = "grid gap-2 md:grid-cols-[12rem_1fr] md:items-center md:gap-4"

function AgentDefaultFieldRow({
  children,
  label,
}: {
  readonly children: ReactNode
  readonly label: string
}) {
  return (
    <div className={DEFAULTS_FIELD_ROW_CLASSNAME}>
      <div className="text-sm font-medium">{label}</div>
      <div className="min-w-0 md:ml-auto md:w-[17rem]">{children}</div>
    </div>
  )
}

function AgentDefaultsContent() {
  const { config, updateConfig } = useAppConfig()
  const { promise } = useAppNotifications()
  const [pendingMode, setPendingMode] = useState<SynapseAgentPermissionMode | null>(null)
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const selectedMode = config.agent.defaultPermissionMode
  const defaultPM = config.agent.defaultProviderModel
  const resolvedLabel = useProviderModelLabel(defaultPM)

  const saveDefaultPermissionMode = async (nextMode: SynapseAgentPermissionMode) => {
    try {
      await promise(
        () => updateConfig({ agent: { defaultPermissionMode: nextMode } }),
        {
          trackingName: "settings.agent.permission-mode.save",
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
          trackingName: "settings.agent.provider-model.save",
          loading: "正在保存设置...",
          success: () => "设置已保存。",
          error: (error) => error instanceof Error ? error.message : "保存设置失败。",
        },
      )
    } catch (error) {
      logger.error("Agent default provider model save failed.", error)
    }
  }, [promise, updateConfig])

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
        <AgentDefaultFieldRow label="默认权限模式">
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
        </AgentDefaultFieldRow>
        <AgentDefaultFieldRow label="默认供应商和模型">
          <div className="flex min-w-0 w-full items-center gap-2">
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
        </AgentDefaultFieldRow>
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
