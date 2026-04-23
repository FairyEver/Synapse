import { Fragment } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { EditorDirectoriesContent } from "@/modules/settings/components/editor-directories-panel"
import { useCliDetect } from "@/modules/cli/hooks/use-cli-detect"
import { CliToolRow } from "@/modules/cli/components/cli-tool-card"

function ToolsPanel() {
  const { results, loading, refresh } = useCliDetect()

  return (
    <div className="flex flex-col gap-4">
      <Card className="bg-background">
        <CardHeader>
          <CardTitle className="text-base">IDE</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <EditorDirectoriesContent />
        </CardContent>
      </Card>

      <Card className="bg-background">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">命令行工具</CardTitle>
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
        </CardHeader>
        <CardContent className="p-0">
          {results.map((item, index) => (
            <Fragment key={item.id}>
              {index > 0 ? <Separator /> : null}
              <CliToolRow item={item} />
            </Fragment>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

export { ToolsPanel }
