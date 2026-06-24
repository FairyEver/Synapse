import { ChevronRight } from "lucide-react"
import type { SynapseSystemAppId, SynapseSystemAppManifest } from "@/modules/apps/types"

type AppLauncherGridProps = {
  readonly apps: readonly SynapseSystemAppManifest[]
  readonly onOpenApp: (appId: SynapseSystemAppManifest["id"]) => void
}

const appDescriptions = {
  "resource-repository": "技能、规则、提示词",
  git: "仓库、提交、同步",
  database: "表、字段、数据记录",
  "document-template": "模板与 JSON",
  screenshot: "屏幕截图",
  "editor-scan": "编辑器扫描与安装状态",
  "usage-monitor": "CC 与 Codex 用量",
  "model-price": "模型价格规则",
} satisfies Record<SynapseSystemAppId, string>

export function AppLauncherGrid({ apps, onOpenApp }: AppLauncherGridProps) {
  return (
    <div className="divide-y divide-border">
      {apps.map((app) => (
        <button
          key={app.id}
          type="button"
          className="flex min-h-16 w-full items-center gap-3 py-2 pl-3 pr-7 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() => onOpenApp(app.id)}
        >
          <img
            src={app.icon}
            alt=""
            className="size-14 shrink-0 object-cover"
            draggable={false}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium leading-tight">{app.name}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {appDescriptions[app.id]}
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}
