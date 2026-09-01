import { useEffect, useRef, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Spinner } from "@/components/ui/spinner"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { startTrackedOperation } from "@/lib/ui-tracking"
import type { SynapseGitInitializationPlan, SynapseGitPushTarget, SynapseGitRepository } from "@/types/git"
import type { GitOperationFailure } from "../hooks/use-git-operations"
import { readOperationFailure } from "../hooks/use-git-operations"
import { getGitFailureActionLabel } from "../lib/git-failure-view"

type InitializationRequest = {
  readonly repository: SynapseGitRepository
  readonly onCompleted: () => void | Promise<void>
  readonly onFailure?: (failure: GitOperationFailure, retry: GitInitializationRetry) => void
  readonly preferredMessage?: string
  readonly preferredRemote?: string
}

export type GitInitializationRetry = {
  readonly repository: SynapseGitRepository
  readonly onCompleted: () => void | Promise<void>
  readonly input: { readonly message?: string; readonly remoteName: string }
}

type DialogPhase = "idle" | "loading-targets" | "inspecting" | "executing"

function createOperationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `git-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function isCancelledOperation(error: unknown): boolean {
  return error instanceof Error && (error.name === "GitOperationCancelledError" || /操作已取消/.test(error.message))
}

export function useGitRepositoryInitialization() {
  const [request, setRequest] = useState<InitializationRequest | null>(null)
  const [targets, setTargets] = useState<readonly SynapseGitPushTarget[]>([])
  const [selectedRemote, setSelectedRemote] = useState("")
  const [plan, setPlan] = useState<SynapseGitInitializationPlan | null>(null)
  const [message, setMessage] = useState("Initial commit")
  const [phase, setPhase] = useState<DialogPhase>("idle")
  const [error, setError] = useState<string | null>(null)
  const [failure, setFailure] = useState<GitOperationFailure | null>(null)
  const activeOperationIdRef = useRef<string | null>(null)
  const requestVersionRef = useRef(0)
  const lastRepositoryIdRef = useRef<string | null>(null)

  useEffect(() => () => {
    const operationId = activeOperationIdRef.current
    if (operationId) void requireSynapseBridge().git.cancelOperation(operationId)
  }, [])

  const inspect = async (nextRequest: InitializationRequest, remoteName: string, version: number) => {
    const previousOperationId = activeOperationIdRef.current
    if (previousOperationId) void requireSynapseBridge().git.cancelOperation(previousOperationId)
    const operationId = createOperationId()
    activeOperationIdRef.current = operationId
    setPhase("inspecting")
    setPlan(null)
    setError(null)
    setFailure(null)
    try {
      const nextPlan = await requireSynapseBridge().git.inspectInitialization({
        repositoryId: nextRequest.repository.id,
        remoteName,
        operationId,
      })
      if (requestVersionRef.current === version) setPlan(nextPlan)
    } catch (err) {
      if (requestVersionRef.current !== version) return
      const nextFailure = readOperationFailure(err, undefined, nextRequest.repository.id, "push")
      setFailure(nextFailure)
      setError(nextFailure?.message ?? (err instanceof Error ? err.message : "无法检查远端。"))
    } finally {
      if (activeOperationIdRef.current === operationId) activeOperationIdRef.current = null
      if (requestVersionRef.current === version) setPhase("idle")
    }
  }

  const open = async (nextRequest: InitializationRequest) => {
    const version = requestVersionRef.current + 1
    requestVersionRef.current = version
    if (lastRepositoryIdRef.current !== nextRequest.repository.id) {
      setMessage(nextRequest.preferredMessage ?? "Initial commit")
      setSelectedRemote(nextRequest.preferredRemote ?? "")
    } else {
      if (nextRequest.preferredMessage !== undefined) setMessage(nextRequest.preferredMessage)
      if (nextRequest.preferredRemote !== undefined) setSelectedRemote(nextRequest.preferredRemote)
    }
    lastRepositoryIdRef.current = nextRequest.repository.id
    setRequest(nextRequest)
    setTargets([])
    setPlan(null)
    setError(null)
    setFailure(null)
    setPhase("loading-targets")
    try {
      const nextTargets = await requireSynapseBridge().git.listPushTargets(nextRequest.repository.id)
      if (requestVersionRef.current !== version) return
      setTargets(nextTargets)
      const preferredRemote = nextRequest.preferredRemote ?? selectedRemote
      const selected = nextTargets.some((target) => target.name === preferredRemote)
        ? preferredRemote
        : nextTargets.find((target) => target.preferred)?.name ?? nextTargets[0]?.name ?? ""
      setSelectedRemote(selected)
      if (!selected) {
        setError("仓库没有可推送的远端。")
        setPhase("idle")
        return
      }
      await inspect(nextRequest, selected, version)
    } catch (err) {
      if (requestVersionRef.current !== version) return
      setError(err instanceof Error ? err.message : "无法读取推送远端。")
      setPhase("idle")
    }
  }

  const selectRemote = (remoteName: string) => {
    const currentRequest = request
    if (!currentRequest || remoteName === selectedRemote) return
    setSelectedRemote(remoteName)
    const version = requestVersionRef.current + 1
    requestVersionRef.current = version
    void inspect(currentRequest, remoteName, version)
  }

  const close = () => {
    if (phase === "executing") return
    requestVersionRef.current += 1
    const operationId = activeOperationIdRef.current
    if (operationId) void requireSynapseBridge().git.cancelOperation(operationId)
    activeOperationIdRef.current = null
    setRequest(null)
  }

  const execute = async () => {
    if (!request || !plan) return
    const finishTracking = startTrackedOperation({ component: "git", eventKey: "git.repository.initialize" })
    const operationId = createOperationId()
    activeOperationIdRef.current = operationId
    setPhase("executing")
    setError(null)
    setFailure(null)
    try {
      await requireSynapseBridge().git.initializeRepository({
        repositoryId: request.repository.id,
        branchName: plan.branchName,
        kind: plan.kind,
        message: plan.kind === "create-and-push" ? message.trim() : undefined,
        remoteName: plan.remoteName,
        operationId,
      })
      await request.onCompleted()
      finishTracking("success")
      setRequest(null)
    } catch (err) {
      await request.onCompleted()
      if (isCancelledOperation(err)) {
        finishTracking("cancelled")
        setRequest(null)
        return
      }
      const nextFailure = readOperationFailure(err, undefined, request.repository.id, "push")
      finishTracking("failure")
      setFailure(nextFailure)
      setError(nextFailure?.message ?? (err instanceof Error ? err.message : "初始化仓库失败。"))
    } finally {
      if (activeOperationIdRef.current === operationId) activeOperationIdRef.current = null
      setPhase("idle")
    }
  }

  const target = targets.find((candidate) => candidate.name === selectedRemote) ?? null
  const busy = phase !== "idle"
  const failureActionLabel = getGitFailureActionLabel(failure)

  return {
    open,
    dialog: (
      <Dialog open={request !== null} onOpenChange={(nextOpen) => { if (!nextOpen) close() }}>
        <DialogContent className="sm:max-w-md" showCloseButton={!busy} data-track="git-initialize-dialog">
          <DialogHeader>
            <DialogTitle>
              {plan?.kind === "track-remote" ? "获取远端内容" : plan ? "初始化仓库" : "准备仓库"}
            </DialogTitle>
            <DialogDescription>
              {plan?.kind === "track-remote"
                ? `将获取并切换到 ${plan.remoteName}/${plan.branchName}。`
                : plan
                  ? "创建首个提交后即可推送仓库，不会新增或修改文件。"
                  : "选择远端后将检查初始化方式。"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {phase === "loading-targets" || phase === "inspecting" ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner />
                {phase === "loading-targets" ? "正在读取远端" : "正在检查远端"}
              </div>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>无法继续</AlertTitle>
                <AlertDescription className="flex flex-col gap-2">
                  <span>{error}</span>
                  {failure && failureActionLabel && request?.onFailure ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="self-start"
                      onClick={() => {
                        if (failure.primaryAction === "retry") {
                          if (plan) {
                            void execute()
                          } else {
                            const version = requestVersionRef.current + 1
                            requestVersionRef.current = version
                            void inspect(request, selectedRemote, version)
                          }
                          return
                        }
                        const retry: GitInitializationRetry = {
                          repository: request.repository,
                          onCompleted: request.onCompleted,
                          input: {
                            remoteName: selectedRemote,
                            ...(plan?.kind === "create-and-push" ? { message: message.trim() } : {}),
                          },
                        }
                        setRequest(null)
                        request.onFailure?.(failure, retry)
                      }}
                    >
                      {failureActionLabel}
                    </Button>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
            {targets.length > 1 ? (
              <div className="grid gap-2">
                <Label>推送远端</Label>
                <RadioGroup value={selectedRemote} onValueChange={selectRemote} className="grid gap-2">
                  {targets.map((candidate) => {
                    const id = `git-initialize-remote-${candidate.name}`
                    return (
                      <Label key={candidate.name} htmlFor={id} className="flex min-w-0 items-center gap-3 rounded-md border p-3">
                        <RadioGroupItem id={id} value={candidate.name} />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{candidate.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{candidate.url}</span>
                        </span>
                      </Label>
                    )
                  })}
                </RadioGroup>
              </div>
            ) : null}
            {plan && target ? (
              <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2 text-sm">
                <span className="text-muted-foreground">远端</span>
                <span className="truncate">{target.name}</span>
                <span className="text-muted-foreground">分支</span>
                <span className="truncate">{plan.branchName}</span>
                <span className="text-muted-foreground">地址</span>
                <span className="truncate" title={target.url}>{target.url}</span>
              </div>
            ) : null}
            {plan?.kind === "create-and-push" ? (
              <div className="grid gap-2">
                <Label htmlFor="git-initial-commit-message">提交说明</Label>
                <Input
                  id="git-initial-commit-message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            {phase === "executing" ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const operationId = activeOperationIdRef.current
                  if (operationId) void requireSynapseBridge().git.cancelOperation(operationId)
                }}
              >
                取消操作
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={close}>取消</Button>
            )}
            <Button
              type="button"
              disabled={!plan || busy || (plan.kind === "create-and-push" && !message.trim())}
              onClick={() => void execute()}
            >
              {phase === "executing"
                ? "处理中"
                : plan?.kind === "track-remote"
                  ? "获取远端内容"
                  : "初始化并推送"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ),
  }
}
