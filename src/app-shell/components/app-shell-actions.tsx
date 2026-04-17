import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

type AppShellActionsProps = {
  disabled?: boolean
  onRefresh?: () => void
}

function AppShellActions({ disabled = false, onRefresh }: AppShellActionsProps) {
  return (
    <Button variant="secondary" size="icon" disabled={disabled} onClick={onRefresh}>
      <RefreshCw />
      <span className="sr-only">刷新仓库</span>
    </Button>
  )
}

export { AppShellActions }
