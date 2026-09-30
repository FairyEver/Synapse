import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Check, TriangleAlert } from "lucide-react"
import type {
  DriveItemDto,
  DriveSyncBindingDto,
  DriveSyncBindingPreviewDto,
} from "@synapse/shared"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  DialogFrameBody,
  DialogFrameFooter,
  DialogFrameHeader,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { startTrackedOperation } from "@/lib/ui-tracking"
import { formatBytes } from "./drive-sync-copy"
import type { DriveSyncController } from "./use-drive-sync"

const PREVIEW_DEBOUNCE_MS = 500

export type DriveSyncWizardEntry =
  | { readonly mode: "item"; readonly item: DriveItemDto; readonly drivePathHint: string | null }
  | { readonly mode: "local"; readonly targetParentId: string | null; readonly drivePathHint: string | null }

/** 选择本地位置的方式。这三个值描述的是用户想做什么，不是内部的方向。 */
type LocalPickMode = "remote_to_local" | "bind_existing" | "local_to_remote"

interface LocalPicker {
  readonly key: string
  readonly label: string
  readonly kind: "file" | "folder"
  readonly mode: LocalPickMode
}

/** 这次结论是在哪一段预览上得到的，用来决定被阻断时下一步该建议做什么。 */
type PreviewStage = "upload" | "download" | "bind"

interface PreviewResult {
  readonly preview: DriveSyncBindingPreviewDto
  readonly stage: PreviewStage
}

export function DriveSyncWizard({
  controller,
  entry,
  onBindingCreated,
  onClose,
  onViewBinding,
}: {
  readonly controller: DriveSyncController
  readonly entry: DriveSyncWizardEntry
  /** 本地传到云端时云盘上会新建条目，创建成功后要让云盘列表跟上。 */
  readonly onBindingCreated?: (binding: DriveSyncBindingDto) => void | Promise<void>
  readonly onClose: () => void
  readonly onViewBinding: (bindingId: string) => void
}) {
  const [step, setStep] = useState(1)
  const [localPath, setLocalPath] = useState("")
  const [localKind, setLocalKind] = useState<"file" | "folder">("folder")
  const [result, setResult] = useState<PreviewResult | null>(null)
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [useDefaultExcludes, setUseDefaultExcludes] = useState(true)
  const [importGitignore, setImportGitignore] = useState(false)
  const [customRules, setCustomRules] = useState<readonly string[]>([])
  const [customDraft, setCustomDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<DriveSyncBindingDto | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  /** 被阻断后改走「把本地内容上传成新的云盘条目」。 */
  const [uploadInstead, setUploadInstead] = useState(false)
  const [pickNonce, setPickNonce] = useState(0)
  const immediateRef = useRef(false)

  const itemEntry = entry.mode === "item" ? entry : null
  const usingItem = itemEntry !== null && !uploadInstead ? itemEntry : null
  const fromItem = usingItem !== null
  const kind = fromItem ? usingItem.item.type : localKind
  const hasRangeStep = kind === "folder"
  const confirmStep = hasRangeStep ? 3 : 2
  const stepCount = hasRangeStep ? 3 : 2

  const remoteExists = fromItem
  const driveItemId = fromItem ? usingItem.item.id : `local:${localPath}`
  const cloudName = fromItem ? usingItem.item.name : basenameOf(localPath, kind)
  const targetParentId = fromItem
    ? undefined
    : entry.mode === "local" ? entry.targetParentId : entry.item.parentId
  const cloudPathHint = fromItem
    ? entry.mode === "item" ? entry.drivePathHint ?? entry.item.name : ""
    : joinPathHint(
      entry.mode === "item" ? parentPathHint(entry.drivePathHint, entry.item.name) : entry.drivePathHint,
      cloudName,
    )

  const configKey = JSON.stringify([
    localPath,
    kind,
    usingItem ? "item" : "local",
    pickNonce,
    customRules,
    useDefaultExcludes,
    importGitignore,
  ])
  const currentResult = result && previewKey === configKey ? result : null
  const currentPreview = currentResult?.preview ?? null
  const canAdvance = currentPreview !== null && currentPreview.status !== "blocked"

  useEffect(() => {
    if (localPath.trim().length === 0) {
      setResult(null)
      setPreviewKey(null)
      setChecking(false)
      setPreviewError(null)
      return
    }
    let disposed = false
    const check = () => {
      setChecking(true)
      setPreviewError(null)
      void runPreview()
        .then((next) => {
          if (disposed) return
          setResult(next)
          setPreviewKey(configKey)
        })
        .catch((cause: unknown) => {
          if (disposed) return
          setResult(null)
          setPreviewKey(null)
          setPreviewError(cause instanceof Error ? cause.message : "检查失败")
        })
        .finally(() => {
          if (!disposed) setChecking(false)
        })
    }
    // 通过系统对话框选好路径、或改了排除范围之后立刻检查；只有手输路径才等停止输入。
    if (immediateRef.current) {
      immediateRef.current = false
      check()
      return () => { disposed = true }
    }
    const timer = setTimeout(check, PREVIEW_DEBOUNCE_MS)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
    // runPreview 依赖的就是 configKey 里的全部输入。
  }, [configKey])

  async function runPreview(): Promise<PreviewResult> {
    const base = {
      driveItemId,
      driveItemName: cloudName,
      kind,
      drivePathHint: cloudPathHint,
      localPath,
      remoteExists,
      excludeRules: hasRangeStep ? customRules : [],
      useDefaultExcludes: hasRangeStep ? useDefaultExcludes : false,
      importGitignore: hasRangeStep ? importGitignore : false,
    }
    if (!remoteExists) {
      return { preview: await controller.preview({ ...base, directionHint: "local_to_remote" }), stage: "upload" }
    }
    // 同步引擎要求「两边都已存在」由调用方显式声明：先按下载意图预览，被阻断且
    // 两边都有内容时再按建立绑定预览一次。判定只看结构化字段，不匹配文案。
    const downloadFirst = await controller.preview({ ...base, directionHint: "remote_to_local" })
    if (downloadFirst.status !== "blocked") return { preview: downloadFirst, stage: "download" }
    const bothSidesHaveContent = kind === "folder"
      ? downloadFirst.localKind === "folder" && downloadFirst.localEmpty === false
      : downloadFirst.localKind === "file"
    if (!bothSidesHaveContent) return { preview: downloadFirst, stage: "download" }
    return { preview: await controller.preview({ ...base, directionHint: "bind_existing" }), stage: "bind" }
  }

  const pick = async (picker: LocalPicker) => {
    try {
      const chosen = await controller.chooseLocalPath({
        kind: picker.kind,
        mode: picker.mode,
        defaultName: fromItem ? usingItem.item.name : undefined,
      })
      if (!chosen) return
      if (!fromItem) setLocalKind(picker.kind)
      immediateRef.current = true
      // 同一个路径重新选一次也要重新校验，否则用户处理完本地问题后看不到新结论。
      setPickNonce((value) => value + 1)
      setLocalPath(chosen)
      setCreateError(null)
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "无法选择本地位置")
    }
  }

  const pickers: readonly LocalPicker[] = fromItem
    ? kind === "file"
      ? [
          { key: "save", label: "保存到…", kind: "file", mode: "remote_to_local" },
          { key: "existing", label: "选择已有文件", kind: "file", mode: "bind_existing" },
        ]
      : [
          { key: "save", label: "选择文件夹", kind: "folder", mode: "remote_to_local" },
          { key: "existing", label: "使用已有文件夹", kind: "folder", mode: "bind_existing" },
        ]
    : [
        { key: "folder", label: "选择文件夹", kind: "folder", mode: "local_to_remote" },
        { key: "file", label: "选择文件", kind: "file", mode: "local_to_remote" },
      ]

  const create = async () => {
    if (!currentPreview?.direction) return
    const finishTracking = startTrackedOperation({ component: "drive", eventKey: "drive.sync.binding.create" })
    setBusy(true)
    setCreateError(null)
    try {
      const binding = await controller.createBinding({
        driveItemId,
        driveItemName: cloudName,
        kind,
        drivePathHint: cloudPathHint,
        targetParentId,
        localPath,
        direction: currentPreview.direction,
        excludeRules: hasRangeStep ? customRules : [],
        useDefaultExcludes: hasRangeStep ? useDefaultExcludes : false,
        importGitignore: hasRangeStep ? importGitignore : false,
      })
      if (currentPreview.direction === "local_to_remote" && binding.status !== "error") {
        await onBindingCreated?.(binding)
      }
      await controller.refresh().catch(() => undefined)
      setCreated(binding)
      finishTracking(binding.status === "error" ? "failure" : "success")
    } catch (cause) {
      // 创建时才做完整一致性核对，失败原因要留在窗里，不关窗。
      setCreateError(cause instanceof Error ? cause.message : "同步没有开始")
      finishTracking("failure")
    } finally {
      setBusy(false)
    }
  }

  const steps = stepCount === 3 ? ["选择位置", "同步范围", "确认"] : ["选择位置", "确认"]

  if (created) {
    const failed = created.status === "error"
    return (
      <>
        <DialogFrameHeader bordered title="新建同步" />
        <DialogFrameBody className="overflow-auto px-5 py-4">
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            {failed ? (
              <span className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <TriangleAlert />
              </span>
            ) : (
              <span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check />
              </span>
            )}
            <div className="font-medium">{failed ? "同步没有开始" : "已开始同步"}</div>
            <p className="max-w-md text-sm text-muted-foreground">
              {failed
                ? created.lastError?.trim() || "云盘上留下了这条同步，需要处理后才能继续。"
                : `「${created.driveItemName}」正在与 ${created.localPath} 同步。`}
            </p>
          </div>
        </DialogFrameBody>
        <DialogFrameFooter>
          <Button type="button" variant="outline" onClick={onClose}>关闭</Button>
          {failed ? null : (
            <Button type="button" onClick={() => onViewBinding(created.id)}>查看同步详情</Button>
          )}
        </DialogFrameFooter>
      </>
    )
  }

  return (
    <>
      <DialogFrameHeader bordered title="新建同步">
        <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="进度">
          {steps.map((label, index) => {
            const position = index + 1
            const done = step > position
            const current = step === position
            return (
              <li key={label} className="flex items-center gap-2" aria-current={current ? "step" : undefined}>
                {index > 0 ? <span aria-hidden="true" className="text-muted-foreground">─────</span> : null}
                <span className={current ? "font-medium text-foreground" : "text-muted-foreground"}>
                  <span aria-hidden="true" className="tabular-nums">{done ? "✔" : `(${position})`}</span> {label}
                </span>
              </li>
            )
          })}
        </ol>
      </DialogFrameHeader>
      <DialogFrameBody className="overflow-auto px-5 py-4">
        {step === 1 ? (
          <StepLocalPath
            checking={checking}
            cloudPathHint={cloudPathHint}
            fromItem={fromItem}
            kind={kind}
            localPath={localPath}
            onChangeLocalPath={(next) => {
              setLocalPath(next)
              setCreateError(null)
            }}
            onEscapeToUpload={itemEntry === null ? null : () => {
              setUploadInstead(true)
              setLocalKind(kind)
              setLocalPath("")
              setResult(null)
              setPreviewKey(null)
            }}
            onPick={pick}
            pickers={pickers}
            previewError={previewError}
            result={currentResult}
          />
        ) : null}

        {hasRangeStep && step === 2 ? (
          <StepScope
            blockReason={previewError ?? (currentPreview?.status === "blocked" ? currentPreview.reason : null)}
            customDraft={customDraft}
            customRules={customRules}
            importGitignore={importGitignore}
            onChangeCustomDraft={setCustomDraft}
            onChangeImportGitignore={(next) => {
              immediateRef.current = true
              setImportGitignore(next)
              setResult(null)
              setPreviewKey(null)
            }}
            onChangeUseDefaultExcludes={(next) => {
              immediateRef.current = true
              setUseDefaultExcludes(next)
              setResult(null)
              setPreviewKey(null)
            }}
            onAddCustomRule={() => {
              const value = customDraft.trim()
              if (!value || customRules.includes(value)) return
              immediateRef.current = true
              setCustomRules([...customRules, value])
              setCustomDraft("")
              setResult(null)
              setPreviewKey(null)
            }}
            onRemoveCustomRule={(rule) => {
              immediateRef.current = true
              setCustomRules(customRules.filter((item) => item !== rule))
              setResult(null)
              setPreviewKey(null)
            }}
            preview={currentPreview}
            useDefaultExcludes={useDefaultExcludes}
          />
        ) : null}

        {step === confirmStep ? (
          <StepConfirm
            blockReason={previewError ?? (currentPreview?.status === "blocked" ? currentPreview.reason : null)}
            cloudPathHint={cloudPathHint}
            createError={createError}
            localPath={localPath}
            preview={currentPreview}
          />
        ) : null}
      </DialogFrameBody>
      <DialogFrameFooter>
        {step > 1 ? (
          <Button type="button" variant="ghost" onClick={() => setStep(step - 1)} disabled={busy}>上一步</Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>取消</Button>
        {step < confirmStep ? (
          <Button type="button" disabled={!canAdvance || checking || busy} onClick={() => setStep(step + 1)}>
            下一步
          </Button>
        ) : (
          <Button type="button" disabled={!canAdvance || busy || checking} onClick={() => { void create() }}>
            开始同步
          </Button>
        )}
      </DialogFrameFooter>
    </>
  )
}

function StepLocalPath({
  checking,
  cloudPathHint,
  fromItem,
  kind,
  localPath,
  onChangeLocalPath,
  onEscapeToUpload,
  onPick,
  pickers,
  previewError,
  result,
}: {
  readonly checking: boolean
  readonly cloudPathHint: string
  readonly fromItem: boolean
  readonly kind: "file" | "folder"
  readonly localPath: string
  readonly onChangeLocalPath: (next: string) => void
  readonly onEscapeToUpload: (() => void) | null
  readonly onPick: (picker: LocalPicker) => Promise<void>
  readonly pickers: readonly LocalPicker[]
  readonly previewError: string | null
  readonly result: PreviewResult | null
}) {
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <span className="text-muted-foreground">{fromItem ? "云盘" : "云盘将新建"}</span>
        <span className="truncate">{cloudPathHint}</span>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="drive-sync-wizard-path">
          {fromItem ? "选择电脑上的位置" : "选择电脑上的内容"}
        </Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="drive-sync-wizard-path"
            className="min-w-56 flex-1"
            value={localPath}
            placeholder={placeholderFor(kind, pickers)}
            onChange={(event) => onChangeLocalPath(event.target.value)}
          />
          {pickers.map((picker) => (
            <Button key={picker.key} type="button" variant="outline" onClick={() => { void onPick(picker) }}>
              {picker.label}
            </Button>
          ))}
        </div>
        {fromItem ? (
          <p className="text-sm text-muted-foreground">云盘上的「{cloudPathHint.split("/").at(-1)}」将同步到这个位置。</p>
        ) : null}
      </div>

      <PreviewStatus
        checking={checking}
        kind={kind}
        onEscapeToUpload={onEscapeToUpload}
        onPick={onPick}
        previewError={previewError}
        result={result}
      />
    </div>
  )
}

function PreviewStatus({
  checking,
  kind,
  onEscapeToUpload,
  onPick,
  previewError,
  result,
}: {
  readonly checking: boolean
  readonly kind: "file" | "folder"
  readonly onEscapeToUpload: (() => void) | null
  readonly onPick: (picker: LocalPicker) => Promise<void>
  readonly previewError: string | null
  readonly result: PreviewResult | null
}) {
  if (checking) {
    return <div className="rounded-lg border px-3 py-2 text-sm text-muted-foreground" role="status">正在检查…</div>
  }
  if (previewError) {
    return (
      <div className="flex gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm" role="status">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div>
          <div className="font-medium">检查没有完成</div>
          <p className="mt-1 text-muted-foreground">{previewError}</p>
          <p className="mt-1 text-muted-foreground">重新选择位置可以再检查一次。</p>
        </div>
      </div>
    )
  }
  if (!result) {
    return <div className="text-sm text-muted-foreground">选择之后会先检查两边内容，确认可以同步后继续。</div>
  }
  const preview = result.preview
  if (preview.status === "blocked") {
    const escape = blockedEscape(preview, result.stage, kind)
    return (
      <div className="flex gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm" role="status">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div>
          <div className="font-medium">不能同步</div>
          <p className="mt-1 text-muted-foreground">{preview.reason ?? "两边内容无法直接建立同步。"}</p>
          {escape ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => { void onPick(escape) }}>{escape.label}</Button>
              {result.stage === "bind" && onEscapeToUpload ? (
                <Button type="button" variant="outline" onClick={onEscapeToUpload}>改为上传到云盘</Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm" role="status">
      <div className="font-medium">{previewTitle(preview)}</div>
      <p className="mt-1 text-muted-foreground">{previewDetail(preview, kind)}</p>
    </div>
  )
}

/**
 * 被阻断时给一条真的走得通的下一步。
 * 出路由「这次结论出在哪一段预览上」决定，不猜原因：拿不准就不给按钮，
 * 免得用户在一个闭环里来回点。
 */
function blockedEscape(
  preview: DriveSyncBindingPreviewDto,
  stage: PreviewStage,
  kind: "file" | "folder",
): LocalPicker | null {
  if (kind === "folder" && preview.localKind === "file") {
    return { key: "retry", label: "重新选择文件夹", kind: "folder", mode: stage === "bind" ? "bind_existing" : "remote_to_local" }
  }
  if (kind === "file" && preview.localKind === "folder") {
    return { key: "retry", label: "重新选择文件", kind: "file", mode: stage === "bind" ? "bind_existing" : "remote_to_local" }
  }
  // 本地位置还不存在、或是特殊文件却仍被阻断：原因不在本地位置，换位置解决不了。
  if (preview.localKind === "missing" || preview.localKind === "other") return null
  // 空的本地文件夹仍被阻断，同理。
  if (preview.localKind === "folder" && preview.localEmpty === true && stage === "download") return null
  if (stage === "download") {
    return {
      key: "existing",
      label: kind === "file" ? "选择已有的同名文件" : "使用已有的文件夹",
      kind,
      mode: "bind_existing",
    }
  }
  if (stage === "bind") {
    return {
      key: "save",
      label: kind === "file" ? "保存到新位置" : "选择一个空的文件夹",
      kind,
      mode: "remote_to_local",
    }
  }
  return null
}

function previewTitle(preview: DriveSyncBindingPreviewDto): string {
  if (preview.direction === "bind_existing") return "两边都有内容"
  return "可以同步"
}

function previewDetail(preview: DriveSyncBindingPreviewDto, kind: "file" | "folder"): string {
  if (preview.direction === "bind_existing") {
    return "建立同步后会先核对两边内容是否完全一致；不一致时不会开始同步，也不会改动任何文件。"
  }
  const transfer = preview.initialTransfer
  const noun = kind === "folder" ? "文件夹" : "文件"
  if (!transfer || transfer.fileCount === 0) {
    return preview.direction === "local_to_remote" ? `这个${noun}里没有需要上传的内容。` : "云端没有需要下载的内容。"
  }
  const size = formatBytes(Number(transfer.totalBytes))
  return preview.direction === "local_to_remote"
    ? `这个${noun}里的 ${transfer.fileCount} 个文件，共 ${size}，将上传到云端。`
    : `云端有 ${transfer.fileCount} 个文件，共 ${size}，将下载到这个位置。`
}

function placeholderFor(kind: "file" | "folder", pickers: readonly LocalPicker[]): string {
  if (kind === "file" && pickers.some((picker) => picker.mode === "remote_to_local")) return "选择保存位置"
  return kind === "file" ? "选择本地文件" : "选择本地文件夹"
}

function StepScope({
  blockReason,
  customDraft,
  customRules,
  importGitignore,
  onChangeCustomDraft,
  onChangeImportGitignore,
  onChangeUseDefaultExcludes,
  onAddCustomRule,
  onRemoveCustomRule,
  preview,
  useDefaultExcludes,
}: {
  readonly blockReason: string | null
  readonly customDraft: string
  readonly customRules: readonly string[]
  readonly importGitignore: boolean
  readonly onChangeCustomDraft: (next: string) => void
  readonly onChangeImportGitignore: (next: boolean) => void
  readonly onChangeUseDefaultExcludes: (next: boolean) => void
  readonly onAddCustomRule: () => void
  readonly onRemoveCustomRule: (rule: string) => void
  readonly preview: DriveSyncBindingPreviewDto | null
  readonly useDefaultExcludes: boolean
}) {
  const recommended = preview?.defaultExcludeRules ?? []
  const detected = preview?.detectedGitignoreRules ?? []
  const forced = preview?.forcedExcludeRules ?? []
  return (
    <div className="grid gap-4">
      <div>
        <div className="font-medium">这些内容不参与同步</div>
        <p className="mt-1 text-sm text-muted-foreground">不参与同步的内容不会被上传、下载，在一边删除也不会影响另一边。</p>
      </div>

      {blockReason ? (
        <div className="rounded-lg border border-destructive/40 px-3 py-2 text-sm" role="status">
          <div className="font-medium">这些设置让同步无法开始</div>
          <p className="mt-1 text-muted-foreground">{blockReason}</p>
        </div>
      ) : null}

      <div className="grid gap-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox checked={useDefaultExcludes} onCheckedChange={(checked) => onChangeUseDefaultExcludes(checked === true)} />
          使用推荐排除
        </label>
        {useDefaultExcludes && recommended.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pl-6">
            {recommended.map((rule) => (
              <span key={rule} className="rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">{rule}</span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label>自定义</Label>
        {customRules.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {customRules.map((rule) => (
              <span key={rule} className="flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-xs">
                {rule}
                <Button type="button" variant="ghost" size="icon-xs" aria-label={`移除规则 ${rule}`} onClick={() => onRemoveCustomRule(rule)}>×</Button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex gap-2">
          <Input
            value={customDraft}
            placeholder="例如 *.psd 或 素材/大文件"
            onChange={(event) => onChangeCustomDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return
              event.preventDefault()
              onAddCustomRule()
            }}
          />
          <Button type="button" variant="outline" disabled={customDraft.trim().length === 0} onClick={onAddCustomRule}>添加</Button>
        </div>
      </div>

      {detected.length > 0 ? (
        <div className="grid gap-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={importGitignore} onCheckedChange={(checked) => onChangeImportGitignore(checked === true)} />
            导入这个文件夹里的 .gitignore 规则
          </label>
          {importGitignore ? (
            <div className="flex flex-wrap gap-1.5 pl-6">
              {detected.map((rule) => (
                <span key={rule} className="rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">{rule}</span>
              ))}
            </div>
          ) : null}
          <p className="pl-6 text-xs text-muted-foreground">一次性导入，之后改动 .gitignore 不再影响同步。</p>
        </div>
      ) : null}

      <Collapsible>
        <CollapsibleTrigger className="text-sm text-muted-foreground">始终排除的内容</CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {forced.map((rule) => (
              <span key={rule} className="rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">{rule}</span>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

function StepConfirm({
  blockReason,
  cloudPathHint,
  createError,
  localPath,
  preview,
}: {
  readonly blockReason: string | null
  readonly cloudPathHint: string
  readonly createError: string | null
  readonly localPath: string
  readonly preview: DriveSyncBindingPreviewDto | null
}) {
  const transfer = preview?.initialTransfer ?? null
  const direction = preview?.direction ?? null
  const verb = direction === "local_to_remote" ? "上传" : "下载"
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <div className="font-medium">同步关系</div>
        <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg border p-3 text-sm">
          <span className="text-muted-foreground">云盘</span>
          <span className="truncate">{cloudPathHint}</span>
          <span className="text-muted-foreground">电脑</span>
          <span className="truncate">{localPath}</span>
        </div>
      </div>

      <div className="grid gap-2">
        <div className="font-medium">开始后会发生什么</div>
        {direction === "bind_existing" ? (
          <div className="rounded-lg border p-3 text-sm">
            <div className="font-medium">会先核对两边内容是否完全一致</div>
            <p className="mt-1 text-muted-foreground">一致才开始同步，不会传输文件；不一致则不会开始，也不会改动任何文件。</p>
          </div>
        ) : transfer ? (
          <div className="rounded-lg border p-3">
            <div className="text-sm font-medium">
              首次将{verb} {transfer.fileCount} 个文件、{transfer.folderCount} 个文件夹，共 {formatBytes(Number(transfer.totalBytes))}
            </div>
            <ul className="mt-2 max-h-40 overflow-auto">
              {transfer.entries.slice(0, 8).map((entry) => (
                <li key={entry.relativePath} className="flex gap-3 text-xs text-muted-foreground">
                  <span className="min-w-0 flex-1 truncate">{entry.relativePath}</span>
                  <span className="tabular-nums">{entry.size ? formatBytes(Number(entry.size)) : ""}</span>
                </li>
              ))}
            </ul>
            {transfer.truncated ? (
              <p className="mt-2 text-xs text-muted-foreground">
                列表只显示前 {transfer.entries.length} 项，共 {transfer.totalEntries} 项。
              </p>
            ) : null}
          </div>
        ) : (
          <div className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">没有需要传输的文件。</div>
        )}
      </div>

      <p className="text-sm text-muted-foreground">同步只在 Synapse 运行时进行，退出后会在下次启动时继续。</p>

      {blockReason || createError ? (
        <div className="flex gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm" role="status">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <div className="font-medium">不能开始同步</div>
            <p className="mt-1 text-muted-foreground">{createError ?? blockReason}</p>
            <p className="mt-1 text-muted-foreground">如果想以其中一侧为准，可以返回上一步改选一个空的电脑位置。</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function basenameOf(localPath: string, kind: "file" | "folder"): string {
  const name = localPath.split(/[\\/]/u).filter(Boolean).at(-1)
  if (name) return name
  return kind === "folder" ? "同步文件夹" : "同步文件"
}

function joinPathHint(parentPath: string | null | undefined, name: string): string {
  const parent = parentPath?.trim()
  if (!parent || parent === "根目录" || parent === "/") return `/${name}`
  return `${parent.replace(/\/+$/u, "")}/${name}`
}

/** 从条目自身的路径线索里去掉它自己的名字，得到它所在的目录。 */
function parentPathHint(pathHint: string | null, name: string): string | null {
  const hint = pathHint?.trim()
  if (!hint) return null
  const suffix = `/${name}`
  return hint.endsWith(suffix) ? hint.slice(0, -suffix.length) || "/" : null
}
