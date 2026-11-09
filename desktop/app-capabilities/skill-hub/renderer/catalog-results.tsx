import { useCallback, useEffect, useRef, useState } from "react"
import { Package, PackagePlus } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFrame, DialogFrameBody, DialogFrameHeader } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import type { SkillHubSummary } from "@synapse/shared/skill-hub-contracts"
import type { HubCatalogDetail } from "../shared/ipc-result"
import { catalog, CatalogError, catalogErrorMessage } from "./catalog-api"

function SkillIcon({ skill }: { skill: Pick<SkillHubSummary, "id" | "iconUrl" | "revision"> }) {
  const { id, iconUrl, revision } = skill
  const [src, setSrc] = useState<string>()

  useEffect(() => {
    if (!iconUrl) return
    const controller = new AbortController()
    void catalog.icon(id, controller.signal).then((base64) => {
      if (!controller.signal.aborted && base64) setSrc(`data:image/png;base64,${base64}`)
    }).catch(() => {
      if (!controller.signal.aborted) setSrc(undefined)
    })
    return () => controller.abort()
  }, [id, iconUrl, revision])

  return (
    <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-muted-foreground" aria-hidden="true">
      {src ? <img alt="" src={src} className="size-full object-cover" onError={() => setSrc(undefined)} /> : <Package className="size-5" />}
    </span>
  )
}

function SkillBadges({ skill }: { skill: Pick<SkillHubSummary, "createdBy" | "currentVersion"> }) {
  const author = skill.createdBy.displayName.trim()
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {author && <Badge variant="outline" className="max-w-full" title={author}><span className="truncate">@{author}</span></Badge>}
      <Badge variant="secondary">v{skill.currentVersion.number}</Badge>
    </div>
  )
}

function SkillCard({ skill, installing, onOpen, onInstall }: {
  skill: SkillHubSummary
  installing: boolean
  onOpen: (trigger: HTMLButtonElement) => void
  onInstall: () => void
}) {
  return (
    <Card asChild size="sm">
      <li>
        <CardContent className="flex h-full min-w-0 flex-col gap-2">
          <button
            type="button"
            aria-label={`查看 ${skill.displayName}`}
            data-track="skill-hub.skill.open"
            data-track-native="true"
            className="group flex min-w-0 items-start gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => onOpen(event.currentTarget)}
          >
            <SkillIcon key={skill.revision} skill={skill} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium group-hover:underline" title={skill.displayName}>{skill.displayName}</span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">{skill.displayDescription}</span>
              <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground" title={skill.package.name}>{skill.package.name}</span>
            </span>
          </button>
          <div className="min-w-0 pl-12"><SkillBadges skill={skill} /></div>
          <div className="mt-auto flex justify-end">
            <Button type="button" variant="outline" aria-label={`安装 ${skill.displayName}`} disabled={installing}
              data-track="skill-hub.skill.install" onClick={onInstall}>
              <PackagePlus />安装
            </Button>
          </div>
        </CardContent>
      </li>
    </Card>
  )
}

function SkillDetail({ summary, trigger, installing, onClose, onInstall }: {
  summary: SkillHubSummary
  trigger: HTMLButtonElement
  installing: boolean
  onClose: () => void
  onInstall: () => void
}) {
  const [detail, setDetail] = useState<HubCatalogDetail>()
  const [error, setError] = useState<string>()
  const [attempt, retry] = useState(0)

  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => catalog.detail(summary.id)).then((value) => {
      if (active) setDetail(value)
    }).catch((cause: unknown) => {
      if (active) setError(catalogErrorMessage(cause, "无法读取技能详情，请重试。"))
    })
    return () => { active = false }
  }, [summary.id, attempt])

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} className="max-h-[80vh] min-w-0 overflow-hidden p-0 sm:max-w-2xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (trigger.isConnected) trigger.focus({ preventScroll: true })
        }}
      >
        <DialogFrame className="max-h-[80vh]">
          <DialogFrameHeader bordered title={detail?.skill.displayName ?? summary.displayName} titleClassName="whitespace-normal wrap-anywhere" actions={detail && (
            <Button type="button" variant="outline" data-track="skill-hub.detail.install" disabled={installing} onClick={onInstall}>
              <PackagePlus />安装
            </Button>
          )} />
          <DialogFrameBody className="overflow-y-auto px-5 py-4">
            {detail ? (
              <div className="min-w-0 space-y-4">
                <div className="flex min-w-0 items-start gap-3">
                  <SkillIcon key={detail.skill.revision} skill={detail.skill} />
                  <div className="min-w-0 space-y-2">
                    <p className="whitespace-pre-wrap wrap-anywhere text-sm">{detail.skill.displayDescription}</p>
                    <p className="wrap-anywhere font-mono text-xs text-muted-foreground">{detail.skill.package.name}</p>
                    <SkillBadges skill={detail.skill} />
                  </div>
                </div>
                <h3 className="font-mono text-sm font-medium">SKILL.md</h3>
                <pre data-allow-select="true" className="whitespace-pre-wrap wrap-anywhere rounded-md bg-muted p-3 font-mono text-sm leading-relaxed">{detail.content}</pre>
              </div>
            ) : error ? (
              <CatalogMessage error action={() => { setError(undefined); retry((value) => value + 1) }}>{error}</CatalogMessage>
            ) : <p role="status" className="text-sm text-muted-foreground">正在加载技能详情…</p>}
          </DialogFrameBody>
        </DialogFrame>
      </DialogContent>
    </Dialog>
  )
}

function CatalogMessage({ children, action, error }: {
  children: string
  action?: () => void
  error?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 p-4 text-sm text-muted-foreground">
      <p role={error ? "alert" : "status"}>{children}</p>
      {action && <Button type="button" variant="outline" data-track="skill-hub.catalog.retry" onClick={action}>重试</Button>}
    </div>
  )
}

export function CatalogResults({ query, refresh }: { query: string; refresh: () => void }) {
  const [items, setItems] = useState<SkillHubSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState<{ message: string; reset: boolean }>()
  const [selection, setSelection] = useState<{ skill: SkillHubSummary; trigger: HTMLButtonElement }>()
  const [installing, setInstalling] = useState(false)
  const request = useRef<AbortController | null>(null)
  const installation = useRef<AbortController | null>(null)

  const loadPage = useCallback(async (cursor?: string) => {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setFailure(undefined)
    try {
      const page = await catalog.list(query, cursor)
      if (controller.signal.aborted) return
      setItems((previous) => cursor ? [...new Map([...previous, ...page.items].map((item) => [item.id, item])).values()] : page.items)
      setNextCursor(page.nextCursor)
      setLoaded(true)
    } catch (cause) {
      if (!controller.signal.aborted) setFailure({
        message: catalogErrorMessage(cause, "无法读取技能，请重试。"),
        reset: cause instanceof CatalogError && cause.code === "HUB_INVALID_CURSOR",
      })
    } finally {
      if (!controller.signal.aborted) {
        request.current = null
        setLoading(false)
      }
    }
  }, [query])

  useEffect(() => {
    void loadPage()
    return () => {
      request.current?.abort()
      request.current = null
      installation.current?.abort()
      installation.current = null
    }
  }, [loadPage])

  async function install(skillId: string) {
    if (installation.current) return
    const controller = new AbortController()
    installation.current = controller
    setInstalling(true)
    try {
      await catalog.install(skillId)
    } catch (cause) {
      if (!controller.signal.aborted) toast.error(catalogErrorMessage(cause, "无法打开技能安装器，请重试。"))
    } finally {
      if (!controller.signal.aborted) {
        installation.current = null
        setInstalling(false)
      }
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
      {!loaded && !failure && (
        <div role="status" aria-label="正在加载技能" className="grid grid-cols-1 gap-2 @2xl:grid-cols-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      )}
      {items.length > 0 && (
        <ul aria-label="技能" className="grid grid-cols-1 gap-2 @2xl:grid-cols-2">
          {items.map((skill) => (
            <SkillCard key={skill.id} skill={skill} installing={installing}
              onOpen={(trigger) => setSelection({ skill, trigger })}
              onInstall={() => { void install(skill.id) }} />
          ))}
        </ul>
      )}
      {failure ? (
        <CatalogMessage error action={failure.reset ? refresh : () => { void loadPage(nextCursor ?? undefined) }}>{failure.message}</CatalogMessage>
      ) : loaded && items.length === 0 ? (
        <CatalogMessage>{query ? "没有匹配的技能" : "暂无技能"}</CatalogMessage>
      ) : nextCursor && (
        <div className="flex justify-center py-3">
          <Button type="button" variant="outline" data-track="skill-hub.catalog.more" disabled={loading}
            onClick={() => { void loadPage(nextCursor) }}>{loading ? "加载中…" : "加载更多"}</Button>
        </div>
      )}
      {selection && <SkillDetail summary={selection.skill} trigger={selection.trigger} installing={installing}
        onClose={() => setSelection(undefined)} onInstall={() => { void install(selection.skill.id) }} />}
    </div>
  )
}
