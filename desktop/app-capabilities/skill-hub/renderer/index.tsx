import { useCallback, useEffect, useState } from "react"
import { RefreshCw, Search } from "lucide-react"
import { useAccount } from "@/app-shell/account"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import { CatalogResults } from "./catalog-results"

function SkillHubCatalog({ reload, refresh }: { reload: number; refresh: () => void }) {
  const [input, setInput] = useState("")
  const [composing, setComposing] = useState(false)
  const [query, setQuery] = useState("")

  useEffect(() => {
    if (composing) return
    const timer = setTimeout(() => setQuery(input.trim()), 250)
    return () => clearTimeout(timer)
  }, [composing, input])

  return (
    <div className="@container flex h-full min-h-0 min-w-0 flex-col bg-surface">
      <div className="flex shrink-0 justify-end p-3" role="search" aria-label="搜索技能">
        <InputGroup className="max-w-sm">
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupInput type="search" aria-label="搜索技能" placeholder="搜索技能" maxLength={200}
            value={input} onChange={(event) => setInput(event.currentTarget.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => { setInput(event.currentTarget.value); setComposing(false) }} />
        </InputGroup>
      </div>
      <CatalogResults key={JSON.stringify([reload, query])} query={query} refresh={refresh} />
    </div>
  )
}

export function SkillHubModule() {
  const { state, isLoading, pendingAction, startLogin, refresh: refreshAccount } = useAccount()
  const [reload, setReload] = useState(0)
  const refresh = useCallback(() => setReload((value) => value + 1), [])
  const signingOut = pendingAction === "logout"
  const accountId = state.status === "authenticated" && state.connectivity === "online" && !signingOut ? state.profile.user.id : null
  const offline = state.status === "authenticated" && state.connectivity === "offline"
  const signingIn = state.status === "authenticating" || pendingAction === "login"

  return (
    <SystemAppWindowShell
      left={<span className="truncate text-sm font-semibold">SkillHub</span>}
      actions={
        <SystemAppTopBarActionButton type="button" iconOnly aria-label="刷新技能" tooltip="刷新技能"
          data-track="skill-hub.catalog.refresh" disabled={!accountId || isLoading} onClick={refresh}>
          <RefreshCw />
        </SystemAppTopBarActionButton>
      }
    >
      {accountId && !isLoading ? <SkillHubCatalog key={accountId} reload={reload} refresh={refresh} /> : (
        <div className="flex h-full flex-wrap content-center items-center justify-center gap-3 p-4 text-sm text-muted-foreground">
          {isLoading || signingOut ? <p role="status">{signingOut ? "正在退出…" : "正在读取账号…"}</p> : offline ? (
            <>
              <p role="status">账号离线，无法加载技能</p>
              <Button type="button" variant="outline" data-track="skill-hub.account.retry" disabled={pendingAction === "refresh"}
                onClick={() => { void refreshAccount() }}>重试</Button>
            </>
          ) : (
            <>
              <p role="status">{signingIn ? "正在登录…" : "登录后查看技能"}</p>
              {!signingIn && <Button type="button" data-track="skill-hub.account.login" onClick={() => { void startLogin() }}>登录</Button>}
            </>
          )}
        </div>
      )}
    </SystemAppWindowShell>
  )
}
