import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { LoaderCircle } from "lucide-react"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { sanitizeError } from "../../../../electron/services/error-sanitize"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ContentItemIcon } from "@/modules/content/components/content-item-icon"
import { usePromptRun } from "@/modules/prompts/hooks/use-prompt-run"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseAgentProvider } from "@/types/bridge"
import type { SynapseContentMeta } from "@/types/content"

const logger = createRendererLogger("prompts.run-dialog")

type PromptRunDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: SynapseContentMeta<"prompt"> | null
}

function PromptRunDialog({ open, onOpenChange, item }: PromptRunDialogProps) {
  const { config } = useAppConfig()
  const projects = config.global.projects
  const { run, isRunning } = usePromptRun()

  const [selectedProjectId, setSelectedProjectId] = useState<string>("")
  const [providers, setProviders] = useState<SynapseAgentProvider[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState<string>("")
  const [providersLoading, setProvidersLoading] = useState(false)
  const [providersError, setProvidersError] = useState<string | null>(null)
  const providerRequestIdRef = useRef(0)

  const visibleProviders = useMemo(
    () => providers.filter((provider) => !provider.archived),
    [providers],
  )

  const loadProviders = useCallback(async () => {
    const requestId = providerRequestIdRef.current + 1
    providerRequestIdRef.current = requestId
    setProvidersLoading(true)
    setProvidersError(null)
    try {
      const nextProviders = await requireSynapseBridge().agent.listProviders()
      if (requestId !== providerRequestIdRef.current) return
      const visible = nextProviders.filter((provider) => !provider.archived)
      setProviders(nextProviders)
      setSelectedProviderId(visible.find((provider) => provider.active)?.id ?? visible[0]?.id ?? "")
    } catch (rawError) {
      if (requestId !== providerRequestIdRef.current) return
      logger.error("Prompt run: load providers failed.", {
        boundary: "renderer.prompt-run.load-providers",
        ...errorLogMeta(rawError),
      })
      setProviders([])
      setSelectedProviderId("")
      setProvidersError(rawError instanceof Error ? rawError.message : "读取 Provider 失败")
    } finally {
      if (requestId === providerRequestIdRef.current) {
        setProvidersLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const firstProject = projects[0]
    if (firstProject) {
      setSelectedProjectId(firstProject.id)
    }
  }, [open, projects])

  useEffect(() => {
    if (!open) {
      providerRequestIdRef.current += 1
      setProviders([])
      setSelectedProviderId("")
      setProvidersError(null)
      setProvidersLoading(false)
      return
    }
    void loadProviders()
  }, [loadProviders, open])

  const canSubmit = Boolean(item)
    && Boolean(selectedProjectId)
    && Boolean(selectedProviderId)
    && !providersLoading
    && !isRunning

  const handleRun = async (navigate: boolean) => {
    if (!item || !selectedProjectId || !selectedProviderId) return
    const success = await run({
      item,
      projectId: selectedProjectId,
      agentType: "claude-code",
      providerId: selectedProviderId,
      navigate,
    })
    if (success) {
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} data-track="prompt-run-dialog">
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          {item ? (
            <div className="flex items-center gap-3">
              <ContentItemIcon
                className="size-8 shrink-0 [&_svg]:size-4"
                contentId={item.id}
                contentType={item.type}
                icon={item.icon}
                iconType={item.iconType}
                iconImage={item.iconImage}
                title={item.title}
                tone={item.iconBg}
              />
              <div className="min-w-0">
                <DialogTitle className="truncate">{item.title}</DialogTitle>
                {item.description ? (
                  <DialogDescription className="line-clamp-1">
                    {item.description}
                  </DialogDescription>
                ) : null}
              </div>
            </div>
          ) : (
            <DialogTitle>运行提示词</DialogTitle>
          )}
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>项目</Label>
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择项目" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Provider</Label>
            <Select
              value={selectedProviderId}
              onValueChange={setSelectedProviderId}
              disabled={providersLoading || Boolean(providersError) || visibleProviders.length === 0}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={providersLoading ? "正在加载" : "选择 Provider"} />
              </SelectTrigger>
              <SelectContent>
                {visibleProviders.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}{provider.model ? ` · ${provider.model}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {providersError ? (
              <div className="flex items-center gap-2">
                <p className="text-sm text-destructive">{providersError}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => void loadProviders()}>
                  重试
                </Button>
              </div>
            ) : null}
            {!providersLoading && !providersError && visibleProviders.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无 Provider</p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={!canSubmit}
            onClick={() => void handleRun(false)}
          >
            {isRunning ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : null}
            后台发送
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => void handleRun(true)}
          >
            {isRunning ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : null}
            发送并跳转
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function errorLogMeta(error: unknown): { readonly errorName: string; readonly errorLength: number; readonly errorMessage?: string } {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
    ...(message.length > 0 ? { errorMessage: message.length > 200 ? sanitizeError(message).slice(0, 200) + "…" : sanitizeError(message) } : {}),
  }
}

export { PromptRunDialog }
