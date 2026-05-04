import * as React from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { PageState } from "@/components/page-state"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AccountDetailPage } from "@/pages/account-detail-page"
import { AccountsPage } from "@/pages/accounts-page"
import { ActivationCodesPage } from "@/pages/activation-codes-page"
import { AuditLogsPage } from "@/pages/audit-logs-page"
import { DevicesPage } from "@/pages/devices-page"
import { LoginPage } from "@/pages/login-page"
import { SystemPage } from "@/pages/system-page"
import { adminApi, type AdminSession } from "@/lib/api"
import { useIdleTimeout } from "@/hooks/use-idle-timeout"

type Route =
  | { name: "activation-codes" }
  | { name: "accounts" }
  | { name: "account-detail"; accountId: string }
  | { name: "devices" }
  | { name: "audit-logs" }
  | { name: "system" }

function routeFromHash(): Route {
  const route = window.location.hash.replace(/^#\/?/, "") || "activation-codes"
  const [section, id] = route.split("/")
  if (section === "accounts" && id) return { name: "account-detail", accountId: id }
  if (section === "accounts") return { name: "accounts" }
  if (section === "devices") return { name: "devices" }
  if (section === "audit-logs") return { name: "audit-logs" }
  if (section === "system") return { name: "system" }
  return { name: "activation-codes" }
}

function useHashRoute(): Route {
  const [route, setRoute] = React.useState(routeFromHash)
  React.useEffect(() => {
    const handleHashChange = () => setRoute(routeFromHash())
    window.addEventListener("hashchange", handleHashChange)
    return () => window.removeEventListener("hashchange", handleHashChange)
  }, [])
  return route
}

function titleForRoute(route: Route): string {
  switch (route.name) {
    case "account-detail":
      return "账号详情"
    case "accounts":
      return "账号"
    case "devices":
      return "设备"
    case "audit-logs":
      return "审计日志"
    case "system":
      return "系统"
    case "activation-codes":
    default:
      return "激活码"
  }
}

export default function App() {
  const route = useHashRoute()
  const [session, setSession] = React.useState<AdminSession | null | undefined>(undefined)

  React.useEffect(() => {
    let alive = true
    adminApi
      .getSession()
      .then((result) => {
        if (alive) setSession(result)
      })
      .catch(() => {
        if (alive) setSession(null)
      })
    return () => {
      alive = false
    }
  }, [])

  function handleLogout() {
    adminApi
      .logout()
      .catch(() => undefined)
      .finally(() => setSession(null))
  }

  const handleIdleTimeout = React.useCallback(() => {
    adminApi.logout().catch(() => undefined).finally(() => setSession(null))
  }, [])

  useIdleTimeout(handleIdleTimeout)

  if (session === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <PageState>加载中</PageState>
      </main>
    )
  }

  if (session === null) {
    return <LoginPage onLoggedIn={setSession} />
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar
          activeRoute={route.name === "account-detail" ? "accounts" : route.name}
          user={{
            name: "Admin",
            email: session.email,
            avatar: "",
          }}
          onLogout={handleLogout}
        />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-center" />
              <h1 className="text-sm font-medium">{titleForRoute(route)}</h1>
            </div>
          </header>
          <main className="flex flex-1 flex-col gap-4 p-4 pt-0">
            {route.name === "activation-codes" ? <ActivationCodesPage /> : null}
            {route.name === "accounts" ? <AccountsPage /> : null}
            {route.name === "account-detail" ? (
              <AccountDetailPage accountId={route.accountId} />
            ) : null}
            {route.name === "devices" ? <DevicesPage /> : null}
            {route.name === "audit-logs" ? <AuditLogsPage /> : null}
            {route.name === "system" ? <SystemPage /> : null}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
