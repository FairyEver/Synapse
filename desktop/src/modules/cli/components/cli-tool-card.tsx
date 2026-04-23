import { CLI_ICON_CLIP_STYLE, getCliIconSrc } from "@/modules/cli/lib/cli-icons"
import type { SynapseCliDetectResult } from "@/types/cli"

function CliStatusBadge({ installed }: { installed: boolean }) {
  return installed ? (
    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-400">
      已安装
    </span>
  ) : (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      未安装
    </span>
  )
}

function CliToolRow({ item }: { item: SynapseCliDetectResult }) {
  const iconSrc = getCliIconSrc(item.id)
  return (
    <div className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex items-center gap-2 font-medium">
        {iconSrc ? (
          <img src={iconSrc} alt={item.label} className="size-5 shrink-0" style={CLI_ICON_CLIP_STYLE} />
        ) : null}
        {item.label}
        <CliStatusBadge installed={item.installed} />
      </div>
      {item.path ? (
        <p className="truncate text-sm text-muted-foreground" title={item.path}>
          {item.path}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          未检测到本地安装
        </p>
      )}
    </div>
  )
}

export { CliToolRow }
