import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

type AppShellActionsProps = {
  busy?: boolean
  disabled?: boolean
  onRefresh?: () => void
  title?: string
}

function AppShellActions({
  busy = false,
  disabled = false,
  onRefresh,
  title = "刷新仓库",
}: AppShellActionsProps) {
  return (
    <Button variant="secondary" size="icon" disabled={disabled} onClick={onRefresh} title={title}>
      <RefreshCw className={busy ? "animate-spin" : undefined} />
      <span className="sr-only">{title}</span>
    </Button>
  )
}

export { AppShellActions }
