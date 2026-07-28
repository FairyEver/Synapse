import { ChevronDown, CircleUserRound, LoaderCircle, LogIn, LogOut, RefreshCw, Settings } from "lucide-react"
import { useAccount } from "@/app-shell/account"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { buildAccountDashboardHomeUrl } from "@/lib/account-dashboard-url"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import type { SynapseAccountState } from "@/types/account"

type AccountUserControlProps = {
  variant?: "toolbar" | "panel"
  onOpenSettings?: () => void
}

const logger = createRendererLogger("account-user-control")
const toolbarButtonClassName = "h-9 px-3 has-data-[icon=inline-start]:pl-3 has-data-[icon=inline-end]:pr-3"

function getHandle(state: SynapseAccountState): string | null {
  if (state.status !== "authenticated") return null
  const handle = state.profile.user.handle.trim()
  return handle ? handle : null
}

function getAccountTitle(state: SynapseAccountState): string {
  if (state.status === "authenticated") return getHandle(state) ?? state.profile.user.email
  if (state.status === "authenticating") return "登录中"
  return "未登录"
}

function getAccountDetail(state: SynapseAccountState): string {
  if (state.status === "authenticated" && state.connectivity === "offline") return "离线"
  if (state.status === "authenticated") return state.profile.user.email
  if (state.status === "authenticating") return "正在等待浏览器登录"
  if (state.status === "error") return state.message
  return "可选"
}

function isAccountOffline(state: SynapseAccountState): boolean {
  return state.status === "authenticated" && state.connectivity === "offline"
}

function AccountUserControl({
  variant = "toolbar",
  onOpenSettings,
}: AccountUserControlProps) {
  const {
    cancelLogin,
    isLoading,
    logout,
    pendingAction,
    refresh,
    startLogin,
    state,
  } = useAccount()
  const { warning } = useAppNotifications()
  const isAuthenticating = state.status === "authenticating"
  const isActionPending = isLoading || pendingAction !== null
  const isBusy = isActionPending || isAuthenticating

  const runAndReport = async (action: () => Promise<SynapseAccountState>): Promise<void> => {
    const nextState = await action()
    if (nextState.status === "error") {
      warning(nextState.message)
    }
  }

  const handleLogin = () => {
    void runAndReport(startLogin)
  }

  const handleCancelLogin = () => {
    void runAndReport(cancelLogin)
  }

  const handleRefresh = () => {
    void runAndReport(refresh)
  }

  const handleLogout = () => {
    void runAndReport(logout)
  }

  const handleOpenDashboard = () => {
    try {
      void requireBridgeDomain("shell").openExternal(buildAccountDashboardHomeUrl())
        .catch((error) => {
          logger.warn("Failed to open account dashboard.", { error })
          warning("无法打开管理后台。")
        })
    } catch (error) {
      logger.warn("Failed to open account dashboard.", { error })
      warning("无法打开管理后台。")
    }
  }

  if (variant === "panel") {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            {isBusy ? <LoaderCircle className="size-4 animate-spin" /> : <CircleUserRound className="size-4" />}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{getAccountTitle(state)}</p>
            <p className="truncate text-sm text-muted-foreground">{getAccountDetail(state)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {state.status === "authenticated" ? (
            <>
              {isAccountOffline(state) ? (
                <>
                  <Button variant="outline" size="sm" disabled={isBusy} onClick={handleRefresh}>
                    <RefreshCw data-icon="inline-start" className={pendingAction === "refresh" ? "animate-spin" : undefined} />
                    重试连接
                  </Button>
                  <Button variant="outline" size="sm" disabled={isBusy} onClick={handleLogin}>
                    <LogIn data-icon="inline-start" />
                    重新登录
                  </Button>
                </>
              ) : null}
              <Button variant="outline" size="sm" disabled={isBusy} onClick={handleLogout}>
                <LogOut data-icon="inline-start" />
                退出
              </Button>
            </>
          ) : (
            <Button size="sm" disabled={isActionPending} onClick={isAuthenticating ? handleCancelLogin : handleLogin}>
              {isAuthenticating ? (
                <LoaderCircle data-icon="inline-start" className="animate-spin" />
              ) : (
                <CircleUserRound data-icon="inline-start" />
              )}
              {isAuthenticating ? "取消" : "登录"}
            </Button>
          )}
        </div>
      </div>
    )
  }

  if (state.status !== "authenticated") {
    return (
      <Button
        variant="ghost"
        size="sm"
        className={toolbarButtonClassName}
        disabled={isActionPending}
        onClick={isAuthenticating ? handleCancelLogin : handleLogin}
      >
        {isAuthenticating ? (
          <LoaderCircle data-icon="inline-start" className="animate-spin" />
        ) : (
          <CircleUserRound data-icon="inline-start" />
        )}
        {isAuthenticating ? "取消" : "登录"}
      </Button>
    )
  }

  return (
    <DropdownMenu data-track="account-user-menu">
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={`${toolbarButtonClassName} max-w-48`}>
          <CircleUserRound data-icon="inline-start" />
          <span className="truncate">{getAccountTitle(state)}</span>
          {isAccountOffline(state) ? (
            <span className="text-muted-foreground">离线</span>
          ) : null}
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem className="h-auto py-2" onSelect={handleOpenDashboard}>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-sm font-medium">{getAccountTitle(state)}</span>
            {getHandle(state) ? (
              <span className="truncate text-xs text-muted-foreground">{state.profile.user.email}</span>
            ) : null}
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {onOpenSettings ? (
          <DropdownMenuItem onSelect={onOpenSettings}>
            <Settings />
            账号设置
          </DropdownMenuItem>
        ) : null}
        {isAccountOffline(state) ? (
          <>
            <DropdownMenuItem onSelect={handleRefresh} disabled={isBusy}>
              <RefreshCw className={pendingAction === "refresh" ? "animate-spin" : undefined} />
              重试连接
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleLogin} disabled={isBusy}>
              <LogIn />
              重新登录
            </DropdownMenuItem>
          </>
        ) : null}
        {onOpenSettings || isAccountOffline(state) ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem variant="destructive" onSelect={handleLogout} disabled={isBusy}>
          <LogOut />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { AccountUserControl }
