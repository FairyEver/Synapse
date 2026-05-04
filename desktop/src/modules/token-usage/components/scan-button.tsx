import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

interface ScanButtonProps {
  scanning: boolean
  onScan: () => void
  lastScanInfo?: { elapsedMs: number; newMessages: number } | null
  error?: Error | null
}

export function ScanButton({ scanning, onScan, lastScanInfo, error }: ScanButtonProps) {
  return (
    <div className="flex items-center gap-2">
      {error && !scanning ? (
        <span className="text-xs text-destructive">Scan failed</span>
      ) : lastScanInfo && !scanning ? (
        <span className="text-xs text-muted-foreground">
          {lastScanInfo.newMessages > 0
            ? `${lastScanInfo.newMessages} new in ${(lastScanInfo.elapsedMs / 1000).toFixed(1)}s`
            : `Up to date (${(lastScanInfo.elapsedMs / 1000).toFixed(1)}s)`}
        </span>
      ) : null}
      <Button variant="outline" size="sm" onClick={onScan} disabled={scanning}>
        <RefreshCw className={`h-3.5 w-3.5 ${scanning ? "animate-spin" : ""}`} />
        {scanning ? "Scanning..." : "Refresh"}
      </Button>
    </div>
  )
}
