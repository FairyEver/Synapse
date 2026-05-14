import { useState } from "react"
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
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { AgentPermissionModeMenu } from "@/modules/agent/components/permission-mode-menu"
import { permissionModeLabels } from "@/modules/agent/permission-mode-options"
import { SettingsFieldRow } from "@/modules/settings/components/settings-field-row"
import type { SynapseAgentPermissionMode } from "@/types/agent"

const logger = createRendererLogger("settings.agent-defaults")

function AgentDefaultsContent() {
  const { config, updateConfig } = useAppConfig()
  const { promise } = useAppNotifications()
  const [pendingMode, setPendingMode] = useState<SynapseAgentPermissionMode | null>(null)
  const selectedMode = config.agent.defaultPermissionMode

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
      <SettingsFieldRow
        label="默认权限模式"
        controlClassName="w-full md:w-[220px]"
      >
        <AgentPermissionModeMenu
          selectedMode={selectedMode}
          contentClassName="w-56"
          onSelect={selectPermissionMode}
          trigger={(
            <Button
              type="button"
              variant="outline"
              className="w-full justify-between"
              aria-label="默认权限"
            >
              <span className="truncate">{permissionModeLabels[selectedMode]}</span>
              <ChevronDown className="size-4 text-muted-foreground" />
            </Button>
          )}
        />
      </SettingsFieldRow>
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
        <CardTitle className="text-base">默认权限</CardTitle>
      </CardHeader>
      <CardContent>
        <AgentDefaultsContent />
      </CardContent>
    </Card>
  )
}

export { AgentDefaultsPanel, AgentDefaultsContent }
