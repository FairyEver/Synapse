import { CONTENT_TYPE_DEFINITIONS } from "@/config/content-types"
import type { SynapseContentType } from "@/types/content"

export const CC_CONNECT_APP_TABS = [
  { id: "agent-sessions", label: "会话" },
  { id: "connectors", label: "连接" },
  { id: "automation", label: "自动化" },
] as const

export type CcConnectAppTabId = (typeof CC_CONNECT_APP_TABS)[number]["id"]

export type AppTabId = SynapseContentType | CcConnectAppTabId | "data-store" | "editor-scan" | "settings"

export function getAppShellTabs(): Array<{ id: AppTabId; label: string }> {
  return [
    ...CONTENT_TYPE_DEFINITIONS.map((definition) => ({
      id: definition.id,
      label: definition.tabLabel,
    })),
    ...CC_CONNECT_APP_TABS,
    { id: "data-store", label: "数据库" },
    { id: "editor-scan", label: "IDE" },
    { id: "settings", label: "设置" },
  ]
}
