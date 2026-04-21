import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useCliDetect } from "@/modules/cli/hooks/use-cli-detect"
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
    <Card className="bg-background">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-base">
          {iconSrc ? (
            <img src={iconSrc} alt={item.label} className="size-6 shrink-0" style={CLI_ICON_CLIP_STYLE} />
          ) : null}
          {item.label}
          <CliStatusBadge installed={item.installed} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {item.path ? (
          <p className="truncate text-sm text-muted-foreground" title={item.path}>
            {item.path}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            未检测到本地安装
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function CliDetectPanel() {
  const { results, loading, refresh } = useCliDetect()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
          disabled={loading}
          onClick={refresh}
        >
          <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
          重新检测
        </Button>
      </div>
      {results.map((item) => (
        <CliToolRow key={item.id} item={item} />
      ))}
    </div>
  )
}

export { CliDetectPanel }
