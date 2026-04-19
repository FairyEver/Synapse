import { Download, LoaderCircle } from "lucide-react"
import { useState, useCallback } from "react"
import { useAppNotifications } from "@/app-shell/notifications"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { requireSynapseBridge } from "@/lib/electron-bridge"

function LogExportPanel() {
  const { promise } = useAppNotifications()
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = useCallback(async () => {
    setIsExporting(true)
    try {
      await promise(
        () => requireSynapseBridge().log.export(),
        {
          loading: "正在导出日志...",
          success: (result) => `已导出 ${result.entryCount} 条日志到 ${result.filePath}`,
          error: (error) => error instanceof Error ? error.message : "导出日志失败",
        }
      )
    } finally {
      setIsExporting(false)
    }
  }, [promise])

  return (
    <Card className="bg-background">
      <CardHeader>
        <CardTitle>日志</CardTitle>
        <CardDescription>导出应用运行日志，用于排查问题。</CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="outline"
          size="sm"
          disabled={isExporting}
          onClick={handleExport}
        >
          {isExporting ? (
            <LoaderCircle className="animate-spin" data-icon="inline-start" />
          ) : (
            <Download data-icon="inline-start" />
          )}
          {isExporting ? "导出中..." : "导出全部日志"}
        </Button>
      </CardContent>
    </Card>
  )
}

export { LogExportPanel }
