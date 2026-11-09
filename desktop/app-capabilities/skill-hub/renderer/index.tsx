import { useCallback, useEffect, useState } from "react"
import { RefreshCw, Search } from "lucide-react"
import { useAccount } from "@/app-shell/account"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import { catalog, catalogErrorMessage } from "./catalog-api"
import { CatalogResults } from "./catalog-results"

const ALL_TEAMS = "$all"

function SkillHubCatalog({ reload, refresh }: { reload: number; refresh: () => void }) {
  const [input, setInput] = useState("")
  const [composing, setComposing] = useState(false)
  const [query, setQuery] = useState("")
  const [team, setTeam] = useState(ALL_TEAMS)
  const [teams, setTeams] = useState<Awaited<ReturnType<typeof catalog.teams>>>()
  const [teamsError, setTeamsError] = useState<string>()

  useEffect(() => {
    if (composing) return
    const timer = setTimeout(() => setQuery(input.trim()), 250)
    return () => clearTimeout(timer)
  }, [composing, input])

  useEffect(() => {
    const controller = new AbortController()
    setTeamsError(undefined)
    void catalog.teams(controller.signal).then((value) => {
      if (controller.signal.aborted) return
      setTeams(value)
      setTeam((selected) => value.items.some(({ id }) => id === selected) ? selected : ALL_TEAMS)
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setTeamsError(catalogErrorMessage(cause, "无法读取团队，请刷新重试。"))
    })
    return () => controller.abort()
  }, [reload])

  const noTeams = teams?.selectionState === "none"
  return (
    <div className="@container flex h-full min-h-0 min-w-0 flex-col bg-surface">
      <div className="flex shrink-0 flex-wrap items-center gap-2 p-3" role="search" aria-label="搜索团队技能">
        <InputGroup className="max-w-sm flex-1 basis-44">
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupInput type="search" aria-label="搜索技能" placeholder="搜索技能" maxLength={200}
            value={input} onChange={(event) => setInput(event.currentTarget.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => { setInput(event.currentTarget.value); setComposing(false) }} />
        </InputGroup>
        <Select data-track="skill-hub.catalog.team" value={team} onValueChange={setTeam} disabled={!teams?.items.length}>
          <SelectTrigger aria-label="筛选团队" className="max-w-52">
            <SelectValue className="min-w-0" />
          </SelectTrigger>
          <SelectContent aria-label="团队" align="start" className="max-w-72">
            <SelectItem value={ALL_TEAMS}>全部团队</SelectItem>
            {teams?.items.map(({ id, name }) => (
              <SelectItem key={id} value={id} textValue={name} title={name} className="[&>span:last-child]:min-w-0">
                <span className="min-w-0 wrap-anywhere in-data-[slot=select-value]:truncate">{name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {teamsError && <p role="alert" className="px-3 pb-3 text-sm text-muted-foreground">{teamsError}</p>}
      {noTeams ? (
        <p role="status" className="p-4 text-center text-sm text-muted-foreground">当前账号没有所属团队</p>
      ) : (
        <CatalogResults key={JSON.stringify([reload, team, query])} query={query}
          teamId={team === ALL_TEAMS ? undefined : team} refresh={refresh} />
      )}
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
              <p role="status">账号离线，无法加载团队技能</p>
              <Button type="button" variant="outline" data-track="skill-hub.account.retry" disabled={pendingAction === "refresh"}
                onClick={() => { void refreshAccount() }}>重试</Button>
            </>
          ) : (
            <>
              <p role="status">{signingIn ? "正在登录…" : "登录后查看团队技能"}</p>
              {!signingIn && <Button type="button" data-track="skill-hub.account.login" onClick={() => { void startLogin() }}>登录</Button>}
            </>
          )}
        </div>
      )}
    </SystemAppWindowShell>
  )
}
