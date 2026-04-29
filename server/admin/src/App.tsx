import { AppSidebar } from "@/components/app-sidebar"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"

function routeFromHash(): string {
  return window.location.hash.replace(/^#\/?/, "") || "activation-codes"
}

function titleForRoute(route: string): string {
  switch (route) {
    case "accounts":
      return "账号"
    case "devices":
      return "设备"
    case "system":
      return "系统"
    case "activation-codes":
    default:
      return "激活码"
  }
}

export default function App() {
  const route = routeFromHash()

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
              <h1 className="text-sm font-medium">{titleForRoute(route)}</h1>
            </div>
          </header>
          <main className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <div className="text-sm text-muted-foreground">Loading</div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
