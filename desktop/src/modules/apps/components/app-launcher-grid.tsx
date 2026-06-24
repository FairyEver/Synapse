import type { SynapseSystemAppId, SynapseSystemAppManifest } from "@/modules/apps/types"

type AppLauncherGridProps = {
  readonly apps: readonly SynapseSystemAppManifest[]
  readonly onOpenApp: (appId: SynapseSystemAppManifest["id"]) => void
}

const appDescriptions = {
  agent: "Agent 会话",
  workflow: "流程编排",
  drive: "文件与分享",
  automation: "触发器与运行",
  launcher: "系统应用",
  settings: "系统配置",
  "resource-repository": "技能、规则、提示词",
  git: "仓库、提交、同步",
  database: "表、字段、数据记录",
  "document-template": "模板与 JSON",
  terminal: "会话、命令输入",
  screenshot: "屏幕截图",
  "editor-scan": "编辑器扫描与安装状态",
  "usage-monitor": "CC 与 Codex 用量",
  "model-price": "模型价格规则",
} satisfies Record<SynapseSystemAppId, string>

export function AppLauncherGrid({ apps, onOpenApp }: AppLauncherGridProps) {
  return (
    <div
      data-app-launcher-grid
      className="mx-auto grid w-fit grid-cols-2 justify-items-center gap-x-8 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
    >
      {apps.map((app) => (
        <button
          key={app.id}
          type="button"
          className="group flex h-40 w-36 flex-col items-center justify-start rounded-xl px-3 py-3 text-center outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-background/60 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
          onClick={() => onOpenApp(app.id)}
        >
          <img
            src={app.icon}
            alt=""
            className="size-22 shrink-0 object-cover transition-transform duration-150 ease-out group-hover:scale-[1.035] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            draggable={false}
          />
          <span className="mt-3 flex min-w-0 flex-1 flex-col items-center">
            <span className="block max-w-full truncate text-sm font-medium leading-tight text-foreground">{app.name}</span>
            <span className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">
              {appDescriptions[app.id]}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}
