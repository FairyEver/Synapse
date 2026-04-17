import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

function AppShellActions() {
  return (
    <Button variant="secondary" size="icon">
      <RefreshCw className="size-4" />
      <span className="sr-only">刷新布局</span>
    </Button>
  )
}

export { AppShellActions }
