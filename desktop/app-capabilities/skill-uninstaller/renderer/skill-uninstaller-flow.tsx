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
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import type {
  SkillUninstallBatchResult,
  SkillUninstallCandidate,
  SkillUninstallQuery,
} from "../shared/schema"

const logger = createRendererLogger("skill-uninstaller.flow")

export type SkillUninstallerFlowProps = {
  readonly mode: "page" | "modal"
  readonly initialQuery?: SkillUninstallQuery
  readonly queryReadOnly?: boolean
  readonly autoScan?: boolean
  readonly onCancel?: () => void
  readonly onCompleted?: (result: SkillUninstallBatchResult) => Promise<void> | void
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
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [uninstalling, setUninstalling] = useState(false)
  const [failureMessages, setFailureMessages] = useState<Record<string, string>>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const activeScanIdRef = useRef<string | null>(null)
  const skillUninstallerBridge = useMemo(getSkillUninstallerBridge, [])
  const repositoryBridge = useMemo(() => requireBridgeDomain("repository"), [])

  const normalizedQuery = useMemo<SkillUninstallQuery>(() => ({
    name: query.name.trim(),
    ...(query.searchRootPath?.trim() ? { searchRootPath: query.searchRootPath.trim() } : {}),
  }), [query])

  const cancelScan = useCallback(async () => {
    const activeScanId = activeScanIdRef.current
    if (!activeScanId) return
    activeScanIdRef.current = null
    setScanId(null)
    setScanning(false)
    try {
      await skillUninstallerBridge.cancelScan({ scanId: activeScanId })
    } catch (error) {
      logger.warn("Skill uninstall scan cancellation failed.", { error })
    }
  }, [skillUninstallerBridge])

  const startScan = useCallback(async () => {
    if (!normalizedQuery.name) return
    if (activeScanIdRef.current) await cancelScan()

    const nextScanId = crypto.randomUUID()
    activeScanIdRef.current = nextScanId
    setScanId(nextScanId)
    setScanning(true)
    setScanResult(null)
    setSelectedPaths(new Set())
    setFailureMessages({})
    setErrorMessage(null)

    try {
      const result = await skillUninstallerBridge.scan({ scanId: nextScanId, query: normalizedQuery })
      if (activeScanIdRef.current !== nextScanId) return
      setScanResult(result)
    } catch (error) {
      if (activeScanIdRef.current !== nextScanId) return
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

  useEffect(() => {
    if (autoScan && normalizedQuery.name) void startScan()
  }, [autoScan, normalizedQuery.name, startScan])

  useEffect(() => {
    return () => {
      const activeScanId = activeScanIdRef.current
      activeScanIdRef.current = null
      if (activeScanId) void skillUninstallerBridge.cancelScan({ scanId: activeScanId }).catch((error) => {
        logger.warn("Skill uninstall scan cancellation on unmount failed.", { error })
      })
    }
  }, [skillUninstallerBridge])

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

  const submitUninstall = async () => {
    if (selectedCandidates.length === 0 || uninstalling) return
    setUninstalling(true)
    setErrorMessage(null)
    try {
      const result = await skillUninstallerBridge.uninstall({
        targets: selectedCandidates.map((candidate) => ({
          path: candidate.path,
          query: normalizedQuery,
        })),
      })
      const resultByPath = new Map(result.results.map((item) => [item.path, item]))
      setScanResult((current) => current ? {
        ...current,
        candidates: current.candidates.filter((candidate) => resultByPath.get(candidate.path)?.status !== "trashed"),
      } : current)
      setFailureMessages(Object.fromEntries(result.results
        .filter((item) => item.status !== "trashed")
        .map((item) => [item.path, item.error ?? "未能移到废纸篓。"])))
      setSelectedPaths(new Set())
      setConfirmOpen(false)
      await onCompleted?.(result)
    } catch (error) {
      logger.error("Skill uninstall failed.", { error })
      setErrorMessage(error instanceof Error ? error.message : "移到废纸篓失败。")
    } finally {
      setUninstalling(false)
    }
  }

  const chooseSearchRoot = async () => {
    const path = await repositoryBridge.chooseDirectory()
    if (path) setQuery((current) => ({ ...current, searchRootPath: path }))
  }

  return (
    <div className={mode === "modal" ? "flex h-full min-h-0 flex-col gap-4" : "flex flex-col gap-4"}>
      <div className="flex shrink-0 flex-col gap-3">
        <FieldSet>
          <Field>
            <FieldLabel htmlFor="skill-uninstaller-name">Skill 名称</FieldLabel>
            <Input
              id="skill-uninstaller-name"
              value={query.name}
              readOnly={queryReadOnly}
              onChange={(event) => setQuery((current) => ({ ...current, name: event.target.value }))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="skill-uninstaller-search-root">搜索目录</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="skill-uninstaller-search-root"
                value={query.searchRootPath ?? ""}
                readOnly={queryReadOnly}
                onChange={(event) => setQuery((current) => ({
                  ...current,
                  searchRootPath: event.target.value || undefined,
                }))}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  variant="outline"
                  disabled={queryReadOnly}
                  onClick={() => void chooseSearchRoot()}
                >
                  选择
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </Field>
        </FieldSet>

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!scanning && !normalizedQuery.name}
            onClick={() => void (scanning ? cancelScan() : startScan())}
          >
            {scanning ? <Spinner aria-label="扫描中" data-icon="inline-start" /> : null}
            {scanning ? "取消扫描" : "扫描"}
          </Button>
          {scanResult && candidates.length > 0 ? (
            <label className="flex items-center gap-2 text-sm">
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
        </div>
      </div>

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
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
        {onCancel ? <Button type="button" variant="outline" onClick={onCancel}>取消</Button> : null}
        <Button
          type="button"
          variant="destructive"
          disabled={selectedPaths.size === 0 || uninstalling}
          onClick={() => setConfirmOpen(true)}
        >
          {uninstalling ? <Spinner aria-label="处理中" data-icon="inline-start" /> : null}
          {selectedPaths.size > 0 ? `移到废纸篓（${selectedPaths.size}）` : "移到废纸篓"}
        </Button>
      </div>

      <UninstallConfirmation
        candidates={selectedCandidates}
        open={confirmOpen}
        uninstalling={uninstalling}
        onOpenChange={setConfirmOpen}
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
          {candidate.editorIds.map((editorId) => <Badge key={editorId} variant="secondary">{editorId}</Badge>)}
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
  open,
  uninstalling,
  onOpenChange,
  onConfirm,
}: {
  readonly candidates: SkillUninstallCandidate[]
  readonly open: boolean
  readonly uninstalling: boolean
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
          <AlertDialogDescription>已选 {candidates.length} 个 Skill，可从系统废纸篓恢复。</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-1 text-sm">
          {visibleCandidates.map((candidate) => (
            <span key={candidate.path} className="truncate" title={candidate.path}>{candidate.path}</span>
          ))}
          {remainingCount > 0 ? <span className="text-muted-foreground">还有 {remainingCount} 个</span> : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={uninstalling}>取消</AlertDialogCancel>
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
