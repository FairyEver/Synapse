import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

interface ScanButtonProps {
  scanning: boolean
  onScan: () => void
  lastScanInfo?: { elapsedMs: number; newMessages: number } | null
}

export function ScanButton({ scanning, onScan, lastScanInfo }: ScanButtonProps) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={onScan} disabled={scanning}>
        <RefreshCw className={`h-4 w-4 ${scanning ? "animate-spin" : ""}`} />
        {scanning ? "Scanning..." : "Refresh"}
      </Button>
      {lastScanInfo && !scanning ? (
        <span className="text-xs text-muted-foreground">
          {lastScanInfo.newMessages} messages in {(lastScanInfo.elapsedMs / 1000).toFixed(1)}s
        </span>
      ) : null}
    </div>
  )
}
