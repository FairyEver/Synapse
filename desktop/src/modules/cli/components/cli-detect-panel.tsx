import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCliDetect } from "@/modules/cli/hooks/use-cli-detect"
import { CliToolRow } from "@/modules/cli/components/cli-tool-card"

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
