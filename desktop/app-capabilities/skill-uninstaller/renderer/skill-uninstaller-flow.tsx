import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { createRendererLogger } from "@/app-shell/logging"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel, FieldSet } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { getEditorLabel } from "@/lib/editor-registry"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import { startTrackedOperation } from "@/lib/ui-tracking"
import type {
  SkillUninstallBatchResult,
  SkillUninstallCandidate,
  SkillUninstallQuery,
} from "../shared/schema"
import { runSkillUninstallBatches } from "../shared/batch"
import { SkillNameCombobox } from "./skill-name-combobox"

const logger = createRendererLogger("skill-uninstaller.flow")

export type SkillUninstallerFlowProps = {
  readonly mode: "page" | "modal"
  readonly initialQuery?: SkillUninstallQuery
  readonly queryReadOnly?: boolean
  readonly autoScan?: boolean
  readonly onCancel?: () => void
  readonly onCompleted?: (result: SkillUninstallBatchResult) => Promise<void> | void
}

type QueryUpdate = SkillUninstallQuery | ((current: SkillUninstallQuery) => SkillUninstallQuery)

type SkillNameOptionsState = {
  readonly names: readonly string[]
  readonly loading: boolean
  readonly warning?: string
  readonly error?: string
}

const EMPTY_SKILL_NAME_OPTIONS: SkillNameOptionsState = {
  names: [],
  loading: false,
}

export function SkillUninstallerFlow({
  mode,
  initialQuery,
  queryReadOnly = false,
  autoScan = false,
  onCancel,
  onCompleted,
}: SkillUninstallerFlowProps) {
  const [query, setQuery] = useState<SkillUninstallQuery>(() => initialQuery ?? { name: "" })
  const [scanId, setScanId] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<Awaited<ReturnType<ReturnType<typeof getSkillUninstallerBridge>["scan"]>> | null>(null)
  const [scanQuery, setScanQuery] = useState<SkillUninstallQuery | null>(null)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [uninstalling, setUninstalling] = useState(false)
  const [cancellingUninstall, setCancellingUninstall] = useState(false)
  const [uninstallProgress, setUninstallProgress] = useState<{ completed: number; total: number } | null>(null)
  const [failureMessages, setFailureMessages] = useState<Record<string, string>>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)
  const [nameOptions, setNameOptions] = useState<SkillNameOptionsState>(EMPTY_SKILL_NAME_OPTIONS)
  const activeScanIdRef = useRef<string | null>(null)
  const activeNameScanIdRef = useRef<string | null>(null)
  const activeUninstallIdRef = useRef<string | null>(null)
  const uninstallCancelRequestedRef = useRef(false)
  const skillUninstallerBridge = useMemo(getSkillUninstallerBridge, [])
  const repositoryBridge = useMemo(() => requireBridgeDomain("settings").repository, [])

  const normalizedQuery = useMemo<SkillUninstallQuery>(() => ({
    name: query.name.trim(),
    ...(query.searchRootPath?.trim() ? { searchRootPath: query.searchRootPath } : {}),
  }), [query])

  const cancelScan = useCallback(async () => {
    const activeScanId = activeScanIdRef.current
    if (!activeScanId) return
    activeScanIdRef.current = null
    setScanId(null)
    setScanning(false)
    setScanResult(null)
    setScanQuery(null)
    setSelectedPaths(new Set())
    try {
      await skillUninstallerBridge.cancelScan({ scanId: activeScanId })
    } catch (error) {
      logger.warn("Skill uninstall scan cancellation failed.", { error })
    }
  }, [skillUninstallerBridge])

  const cancelNameScan = useCallback(() => {
    const activeScanId = activeNameScanIdRef.current
    activeNameScanIdRef.current = null
    if (!activeScanId) return
    void skillUninstallerBridge.cancelScan({ scanId: activeScanId }).catch((error) => {
      logger.warn("Skill name scan cancellation failed.", { error })
    })
  }, [skillUninstallerBridge])

  const scanNameOptions = useCallback(async (searchRootPath?: string) => {
    if (queryReadOnly) return
    cancelNameScan()
    const nextScanId = crypto.randomUUID()
    activeNameScanIdRef.current = nextScanId
    setNameOptions({ names: [], loading: true })
    try {
      const result = await skillUninstallerBridge.scanNames({
        scanId: nextScanId,
        ...(searchRootPath?.trim() ? { searchRootPath } : {}),
      })
      if (activeNameScanIdRef.current !== nextScanId) return
      setNameOptions({
        names: result.names,
        loading: false,
        ...(result.complete ? {} : {
          warning: result.warnings[0] ?? "部分目录未扫描完成。",
        }),
      })
    } catch (error) {
      if (activeNameScanIdRef.current !== nextScanId) return
      logger.warn("Skill name scan failed.", { error })
      setNameOptions({
        names: [],
        loading: false,
        error: "Skill 名称加载失败，可继续输入。",
      })
    } finally {
      if (activeNameScanIdRef.current === nextScanId) activeNameScanIdRef.current = null
    }
  }, [cancelNameScan, queryReadOnly, skillUninstallerBridge])

  const startScan = useCallback(async () => {
    if (!normalizedQuery.name) {
      setErrorMessage("请输入 Skill 名称。")
      return
    }
    if (activeScanIdRef.current) await cancelScan()
    const finishTracking = startTrackedOperation({ component: "skill-uninstaller", eventKey: "skill-uninstaller.target.scan" })

    const nextScanId = crypto.randomUUID()
    activeScanIdRef.current = nextScanId
    setScanId(nextScanId)
    setScanning(true)
    setScanResult(null)
    setScanQuery(normalizedQuery)
    setSelectedPaths(new Set())
    setFailureMessages({})
    setErrorMessage(null)
    setNoticeMessage(null)

    try {
      const result = await skillUninstallerBridge.scan({ scanId: nextScanId, query: normalizedQuery })
      if (activeScanIdRef.current !== nextScanId) {
        finishTracking("cancelled")
        return
      }
      setScanResult(result)
      finishTracking("success")
    } catch (error) {
      if (activeScanIdRef.current !== nextScanId) {
        finishTracking("cancelled")
        return
      }
      finishTracking("failure")
      logger.error("Skill uninstall scan failed.", { error })
      setErrorMessage(error instanceof Error ? error.message : "扫描失败。")
    } finally {
      if (activeScanIdRef.current === nextScanId) {
        activeScanIdRef.current = null
        setScanId(null)
        setScanning(false)
      }
    }
  }, [cancelScan, normalizedQuery, skillUninstallerBridge])

  const updateQuery = useCallback((update: QueryUpdate) => {
    const activeScanId = activeScanIdRef.current
    if (activeScanId) {
      activeScanIdRef.current = null
      setScanId(null)
      setScanning(false)
      void skillUninstallerBridge.cancelScan({ scanId: activeScanId }).catch((error) => {
        logger.warn("Skill uninstall scan cancellation after query change failed.", { error })
      })
    }
    setQuery((current) => typeof update === "function" ? update(current) : update)
    setScanResult(null)
    setScanQuery(null)
    setSelectedPaths(new Set())
    setFailureMessages({})
    setErrorMessage(null)
    setNoticeMessage(null)
  }, [skillUninstallerBridge])

  useEffect(() => {
    if (autoScan && normalizedQuery.name) void startScan()
  }, [autoScan, normalizedQuery.name, startScan])

  useEffect(() => {
    if (!queryReadOnly) void scanNameOptions(initialQuery?.searchRootPath)
  }, [initialQuery?.searchRootPath, queryReadOnly, scanNameOptions])

  useEffect(() => {
    return () => {
      const activeScanId = activeScanIdRef.current
      activeScanIdRef.current = null
      if (activeScanId) void skillUninstallerBridge.cancelScan({ scanId: activeScanId }).catch((error) => {
        logger.warn("Skill uninstall scan cancellation on unmount failed.", { error })
      })
      cancelNameScan()
      uninstallCancelRequestedRef.current = true
      const activeUninstallId = activeUninstallIdRef.current
      activeUninstallIdRef.current = null
      if (activeUninstallId) void skillUninstallerBridge.cancelUninstall({ operationId: activeUninstallId }).catch((error) => {
        logger.warn("Skill uninstall cancellation on unmount failed.", { error })
      })
    }
  }, [cancelNameScan, skillUninstallerBridge])

  const candidates = scanResult?.candidates ?? []
  const allSelected = candidates.length > 0 && candidates.every((candidate) => selectedPaths.has(candidate.path))
  const selectedCandidates = candidates.filter((candidate) => selectedPaths.has(candidate.path))

  const setCandidateSelected = (path: string, selected: boolean) => {
    setSelectedPaths((current) => {
      const next = new Set(current)
      if (selected) next.add(path)
      else next.delete(path)
      return next
    })
  }

  const cancelUninstall = async () => {
    if (!uninstalling || cancellingUninstall) return
    uninstallCancelRequestedRef.current = true
    setCancellingUninstall(true)
    const operationId = activeUninstallIdRef.current
    if (!operationId) {
      setCancellingUninstall(false)
      return
    }
    const finishTracking = startTrackedOperation({ component: "skill-uninstaller", eventKey: "skill-uninstaller.uninstall.cancel" })
    try {
      await skillUninstallerBridge.cancelUninstall({ operationId })
      finishTracking("success")
    } catch (error) {
      finishTracking("failure")
      logger.warn("Skill uninstall cancellation failed.", { error })
    }
  }

  const submitUninstall = async () => {
    if (selectedCandidates.length === 0 || uninstalling || !scanQuery) return
    const finishTracking = startTrackedOperation({ component: "skill-uninstaller", eventKey: "skill-uninstaller.target.uninstall" })
    setUninstalling(true)
    setCancellingUninstall(false)
    setUninstallProgress({ completed: 0, total: selectedCandidates.length })
    uninstallCancelRequestedRef.current = false
    setErrorMessage(null)
    setNoticeMessage(null)
    try {
      const result = await runSkillUninstallBatches({
        targets: selectedCandidates.map((candidate) => ({
          path: candidate.path,
          query: scanQuery,
        })),
        invoke: (request) => skillUninstallerBridge.uninstall(request),
        shouldCancel: () => uninstallCancelRequestedRef.current,
        onOperationChange: (operationId) => {
          activeUninstallIdRef.current = operationId
        },
        onProgress: (completed) => {
          setUninstallProgress({ completed, total: selectedCandidates.length })
        },
      })
      const resultByPath = new Map(result.results.map((item) => [item.path, item]))
      setScanResult((current) => current ? {
        ...current,
        candidates: current.candidates.filter((candidate) => resultByPath.get(candidate.path)?.status !== "trashed"),
      } : current)
      setFailureMessages(Object.fromEntries(result.results
        .filter((item) => item.status !== "trashed")
        .map((item) => [item.path, item.error ?? "未能移到废纸篓。"])))
      setSelectedPaths(result.cancelled
        ? new Set(selectedCandidates
            .filter((candidate) => !resultByPath.has(candidate.path))
            .map((candidate) => candidate.path))
        : new Set())
      setConfirmOpen(false)
      const incompleteCount = result.results.filter((item) => item.status !== "trashed").length
      const trashedCount = result.results.length - incompleteCount
      const resultWarnings = result.results.flatMap((item) => item.warning ? [item.warning] : [])
      const notices = [
        ...(result.cancelled ? [`已停止，未处理 ${selectedCandidates.length - result.results.length} 个。`] : []),
        ...(incompleteCount > 0 ? [`已移到废纸篓 ${trashedCount} 个，未完成 ${incompleteCount} 个。`] : []),
        ...new Set(resultWarnings),
      ]
      if (notices.length > 0) setNoticeMessage(notices.join(" "))
      if (onCompleted) {
        try {
          await onCompleted(result)
        } catch (error) {
          logger.warn("Skill uninstall completion refresh failed.", { error })
          setNoticeMessage(notices.length > 0
            ? [...new Set([...notices, "刷新失败。"])].join(" ")
            : "已移到废纸篓，刷新失败。")
        }
      }
      finishTracking(result.cancelled ? "cancelled" : incompleteCount > 0 ? "failure" : "success")
    } catch (error) {
      finishTracking("failure")
      logger.error("Skill uninstall failed.", { error })
      setErrorMessage(error instanceof Error ? error.message : "移到废纸篓失败。")
    } finally {
      activeUninstallIdRef.current = null
      uninstallCancelRequestedRef.current = false
      setCancellingUninstall(false)
      setUninstallProgress(null)
      setUninstalling(false)
    }
  }

  const chooseSearchRoot = async () => {
    const selectedPath = await repositoryBridge.chooseDirectory()
    if (selectedPath) {
      updateQuery((current) => ({ ...current, searchRootPath: selectedPath }))
      void scanNameOptions(selectedPath)
    }
  }

  return (
    <div className={mode === "modal" ? "flex h-full min-h-0 flex-col gap-4" : "flex flex-col gap-4"}>
      <div className="flex shrink-0 flex-col gap-3">
        <FieldSet>
          <Field>
            <FieldLabel htmlFor="skill-uninstaller-name">Skill 名称</FieldLabel>
            <SkillNameCombobox
              value={query.name}
              options={nameOptions.names}
              loading={nameOptions.loading}
              warning={nameOptions.warning}
              error={nameOptions.error}
              readOnly={queryReadOnly}
              disabled={uninstalling}
              onValueChange={(name) => updateQuery((current) => ({ ...current, name }))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="skill-uninstaller-search-root">搜索目录</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="skill-uninstaller-search-root"
                value={query.searchRootPath ?? ""}
                placeholder="全局 Skill 目录"
                readOnly={queryReadOnly}
                disabled={uninstalling}
                onChange={(event) => updateQuery((current) => ({
                  ...current,
                  searchRootPath: event.target.value || undefined,
                }))}
                onInput={() => {
                  cancelNameScan()
                  setNameOptions(EMPTY_SKILL_NAME_OPTIONS)
                }}
                onBlur={(event) => {
                  if (!queryReadOnly && !uninstalling) void scanNameOptions(event.currentTarget.value)
                }}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  variant="outline"
                  disabled={queryReadOnly || uninstalling}
                  onClick={() => void chooseSearchRoot()}
                >
                  选择
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </Field>
        </FieldSet>

        <div className="flex justify-end">
          <Button
            data-track="skill-uninstaller.target.scan"
            type="button"
            variant="outline"
            disabled={uninstalling}
            onClick={() => void (scanning ? cancelScan() : startScan())}
          >
            {scanning ? <Spinner aria-label="扫描中" data-icon="inline-start" /> : null}
            {scanning ? "取消扫描" : "扫描"}
          </Button>
        </div>
      </div>

      <Separator />

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {noticeMessage ? (
        <Alert>
          <AlertDescription>{noticeMessage}</AlertDescription>
        </Alert>
      ) : null}

      {scanResult && (!scanResult.complete || scanResult.warnings.length > 0) ? (
        <Alert>
          {!scanResult.complete ? <AlertTitle>扫描未完成</AlertTitle> : null}
          <AlertDescription>
            {scanResult.warnings.map((warning) => <p key={warning}>{warning}</p>)}
          </AlertDescription>
        </Alert>
      ) : null}

      {scanResult && candidates.length > 0 ? (
        <label className="flex min-h-10 shrink-0 items-center gap-3 text-sm">
          <Checkbox
            aria-label="全选"
            checked={allSelected}
            disabled={uninstalling}
            onCheckedChange={(checked) => {
              setSelectedPaths(checked === true
                ? new Set(candidates.map((candidate) => candidate.path))
                : new Set())
            }}
          />
          全选
        </label>
      ) : null}

      <ScrollArea className={mode === "modal" ? "min-h-0 flex-1" : "max-h-96"}>
        {scanResult && candidates.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">未找到匹配的 Skill。</p>
        ) : (
          <div className="divide-y">
            {candidates.map((candidate) => (
              <CandidateRow
                key={candidate.path}
                candidate={candidate}
                checked={selectedPaths.has(candidate.path)}
                disabled={uninstalling}
                failureMessage={failureMessages[candidate.path]}
                onCheckedChange={(checked) => setCandidateSelected(candidate.path, checked)}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      <div className="flex shrink-0 justify-end gap-2">
        {onCancel ? <Button type="button" variant="outline" disabled={uninstalling} onClick={onCancel}>取消</Button> : null}
        <Button
          type="button"
          variant="destructive"
          disabled={selectedPaths.size === 0 || uninstalling}
          onClick={() => setConfirmOpen(true)}
          data-track="skill-uninstaller.target.uninstall"
        >
          {uninstalling ? <Spinner aria-label="处理中" data-icon="inline-start" /> : null}
          {selectedPaths.size > 0 ? `移到废纸篓（${selectedPaths.size}）` : "移到废纸篓"}
        </Button>
      </div>

      <UninstallConfirmation
        candidates={selectedCandidates}
        open={confirmOpen}
        cancelling={cancellingUninstall}
        progress={uninstallProgress}
        uninstalling={uninstalling}
        onOpenChange={setConfirmOpen}
        onCancelUninstall={() => void cancelUninstall()}
        onConfirm={() => void submitUninstall()}
      />
      <span className="sr-only" aria-live="polite">{scanId ? "正在扫描" : ""}</span>
    </div>
  )
}

function CandidateRow({
  candidate,
  checked,
  disabled,
  failureMessage,
  onCheckedChange,
}: {
  readonly candidate: SkillUninstallCandidate
  readonly checked: boolean
  readonly disabled: boolean
  readonly failureMessage?: string
  readonly onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <Checkbox
        aria-label={`选择 ${candidate.path}`}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{candidate.name}</span>
          {candidate.editorIds.map((editorId) => (
            <Badge key={editorId} variant="secondary">{getEditorLabel(editorId)}</Badge>
          ))}
          {candidate.editorIds.length === 0 ? <Badge variant="secondary">其它位置</Badge> : null}
          <span className="text-xs text-muted-foreground">{candidate.source === "synapse" ? "Synapse" : "外部"}</span>
        </div>
        <p className="break-all font-mono text-xs text-muted-foreground">{candidate.path}</p>
        {failureMessage ? <p className="text-sm text-destructive">{failureMessage}</p> : null}
      </div>
    </div>
  )
}

function UninstallConfirmation({
  candidates,
  cancelling,
  open,
  progress,
  uninstalling,
  onCancelUninstall,
  onOpenChange,
  onConfirm,
}: {
  readonly candidates: SkillUninstallCandidate[]
  readonly cancelling: boolean
  readonly open: boolean
  readonly progress: { completed: number; total: number } | null
  readonly uninstalling: boolean
  readonly onCancelUninstall: () => void
  readonly onOpenChange: (open: boolean) => void
  readonly onConfirm: () => void
}) {
  const visibleCandidates = candidates.slice(0, 5)
  const remainingCount = candidates.length - visibleCandidates.length
  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => {
      if (!uninstalling) onOpenChange(nextOpen)
    }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>移到废纸篓？</AlertDialogTitle>
          <AlertDialogDescription aria-live="polite">
            {progress
              ? `已处理 ${progress.completed}/${progress.total} 个，可从系统废纸篓恢复。`
              : `已选 ${candidates.length} 个 Skill，可从系统废纸篓恢复。`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-1 text-sm">
          {visibleCandidates.map((candidate) => (
            <span key={candidate.path} className="truncate" title={candidate.path}>{candidate.path}</span>
          ))}
          {remainingCount > 0 ? <span className="text-muted-foreground">还有 {remainingCount} 个</span> : null}
        </div>
        <AlertDialogFooter>
          {uninstalling ? (
            <Button type="button" variant="outline" disabled={cancelling} onClick={onCancelUninstall}>
              {cancelling ? "正在停止" : "停止处理"}
            </Button>
          ) : <AlertDialogCancel>取消</AlertDialogCancel>}
          <AlertDialogAction
            variant="destructive"
            disabled={uninstalling}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {uninstalling ? <Spinner aria-label="处理中" data-icon="inline-start" /> : null}
            确认移到废纸篓
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function getSkillUninstallerBridge() {
  return requireBridgeDomain("skillUninstaller")
}
