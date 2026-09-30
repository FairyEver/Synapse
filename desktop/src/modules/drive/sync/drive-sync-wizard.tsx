import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Check, FolderOpen, TriangleAlert } from "lucide-react"
import type {
  DriveItemDto,
  DriveSyncBindingDto,
  DriveSyncBindingPreviewDto,
} from "@synapse/shared"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DialogTitle } from "@/components/ui/dialog"
import { formatBytes } from "./drive-sync-copy"
import type { DriveSyncController } from "./use-drive-sync"

const PREVIEW_DEBOUNCE_MS = 500

export type DriveSyncWizardEntry =
  | { readonly mode: "item"; readonly item: DriveItemDto; readonly drivePathHint: string | null }
  | { readonly mode: "local"; readonly targetParentId: string | null; readonly drivePathHint: string | null }

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
  const [preview, setPreview] = useState<DriveSyncBindingPreviewDto | null>(null)
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [useDefaultExcludes, setUseDefaultExcludes] = useState(true)
  const [importGitignore, setImportGitignore] = useState(false)
  const [customRules, setCustomRules] = useState<readonly string[]>([])
  const [customDraft, setCustomDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<DriveSyncBindingDto | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const immediateRef = useRef(false)

  const fromItem = entry.mode === "item"
  const kind = fromItem ? entry.item.type : localKind
  const hasRangeStep = kind === "folder"
  const confirmStep = hasRangeStep ? 3 : 2
  const stepCount = hasRangeStep ? 3 : 2

  const remoteExists = fromItem
  const driveItemId = fromItem ? entry.item.id : `local:${localPath}`
  const cloudName = fromItem ? entry.item.name : basenameOf(localPath, kind)
  const cloudPathHint = fromItem
    ? entry.drivePathHint ?? entry.item.name
    : joinPathHint(entry.drivePathHint, cloudName)

  const configKey = JSON.stringify([
    localPath,
    kind,
    fromItem ? "item" : "local",
    customRules,
    useDefaultExcludes,
    importGitignore,
  ])
  const currentPreview = previewKey === configKey ? preview : null
  const canAdvance = currentPreview !== null && currentPreview.status !== "blocked"

  useEffect(() => {
    if (localPath.trim().length === 0) {
      setPreview(null)
      setPreviewKey(null)
      return
    }
    let disposed = false
    const check = () => {
      setChecking(true)
      void runPreview()
        .then((result) => {
          if (disposed) return
          setPreview(result)
          setPreviewKey(configKey)
        })
        .catch((cause: unknown) => {
          if (disposed) return
          setPreview(null)
          setPreviewKey(null)
          toast(cause instanceof Error ? cause.message : "检查失败")
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

  async function runPreview(): Promise<DriveSyncBindingPreviewDto> {
    const base = {
      driveItemId,
      driveItemName: cloudName,
      kind,
      drivePathHint: cloudPathHint,
      localPath,
      remoteExists,
      excludeRules: customRules,
      useDefaultExcludes: hasRangeStep ? useDefaultExcludes : false,
      importGitignore: hasRangeStep ? importGitignore : false,
    }
    if (!remoteExists) {
      return controller.preview({ ...base, directionHint: "local_to_remote" })
    }
    // 同步引擎要求「两边都已存在」由调用方显式声明：先按下载意图预览，被阻断且
    // 两边都有内容时再按建立绑定预览一次。判定只看结构化字段，不匹配文案。
    const downloadFirst = await controller.preview({ ...base, directionHint: "remote_to_local" })
    if (downloadFirst.status !== "blocked") return downloadFirst
    const bothSidesHaveContent = kind === "folder"
      ? downloadFirst.localKind === "folder" && downloadFirst.localEmpty === false
      : downloadFirst.localKind === "file"
    if (!bothSidesHaveContent) return downloadFirst
    return controller.preview({ ...base, directionHint: "bind_existing" })
  }

  const pick = async (pickKind: "file" | "folder") => {
    try {
      const chosen = await controller.chooseLocalPath({
        kind: pickKind,
        mode: fromItem ? "bind_existing" : "local_to_remote",
        defaultName: fromItem ? entry.item.name : undefined,
      })
      if (!chosen) return
      if (!fromItem) setLocalKind(pickKind)
      immediateRef.current = true
      setLocalPath(chosen)
      setCreateError(null)
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "无法选择本地位置")
    }
  }

  const create = async () => {
    if (!currentPreview?.direction) return
    setBusy(true)
    setCreateError(null)
    try {
      const binding = await controller.createBinding({
        driveItemId,
        driveItemName: cloudName,
        kind,
        drivePathHint: cloudPathHint,
        targetParentId: fromItem ? undefined : entry.targetParentId,
        localPath,
        direction: currentPreview.direction,
        excludeRules: customRules,
        useDefaultExcludes: hasRangeStep ? useDefaultExcludes : false,
        importGitignore: hasRangeStep ? importGitignore : false,
      })
      if (currentPreview.direction === "local_to_remote") {
        await onBindingCreated?.(binding)
      }
      await controller.refresh().catch(() => undefined)
      setCreated(binding)
    } catch (cause) {
      // 创建时才做完整一致性核对，失败原因要留在窗里，不关窗。
      setCreateError(cause instanceof Error ? cause.message : "同步没有开始")
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    const failed = created.status === "error"
    return (
      <WizardShell step={step} stepCount={stepCount} showSteps={false}>
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
          <div className="mt-2 flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>关闭</Button>
            {failed ? null : (
              <Button type="button" onClick={() => onViewBinding(created.id)}>查看同步详情</Button>
            )}
          </div>
        </div>
      </WizardShell>
    )
  }

  return (
    <WizardShell step={step} stepCount={stepCount}>
      {step === 1 ? (
        <StepLocalPath
          canChooseFile={!fromItem}
          checking={checking}
          cloudPathHint={cloudPathHint}
          fromItem={fromItem}
          kind={kind}
          localPath={localPath}
          onChangeLocalPath={(next) => {
            setLocalPath(next)
            setCreateError(null)
          }}
          onPick={pick}
          preview={currentPreview}
          onEscapeToUpload={async () => {
            setLocalKind("folder")
            setLocalPath("")
            setPreview(null)
            setPreviewKey(null)
            await pick("folder")
          }}
        />
      ) : null}

      {hasRangeStep && step === 2 ? (
        <StepScope
          customDraft={customDraft}
          customRules={customRules}
          importGitignore={importGitignore}
          onChangeCustomDraft={setCustomDraft}
          onChangeImportGitignore={(next) => {
            immediateRef.current = true
            setImportGitignore(next)
            setPreview(null)
            setPreviewKey(null)
          }}
          onChangeUseDefaultExcludes={(next) => {
            immediateRef.current = true
            setUseDefaultExcludes(next)
            setPreview(null)
            setPreviewKey(null)
          }}
          onAddCustomRule={() => {
            const value = customDraft.trim()
            if (!value || customRules.includes(value)) return
            immediateRef.current = true
            setCustomRules([...customRules, value])
            setCustomDraft("")
            setPreview(null)
            setPreviewKey(null)
          }}
          onRemoveCustomRule={(rule) => {
            immediateRef.current = true
            setCustomRules(customRules.filter((item) => item !== rule))
            setPreview(null)
            setPreviewKey(null)
          }}
          preview={currentPreview}
          useDefaultExcludes={useDefaultExcludes}
        />
      ) : null}

      {step === confirmStep ? (
        <StepConfirm
          cloudPathHint={cloudPathHint}
          createError={createError}
          localPath={localPath}
          preview={currentPreview}
        />
      ) : null}

      <div className="flex items-center gap-2 border-t px-5 py-3">
        {step > 1 ? (
          <Button type="button" variant="ghost" onClick={() => setStep(step - 1)} disabled={busy}>上一步</Button>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
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
        </div>
      </div>
    </WizardShell>
  )
}

function WizardShell({
  children,
  showSteps = true,
  step,
  stepCount,
}: {
  readonly children: React.ReactNode
  readonly showSteps?: boolean
  readonly step: number
  readonly stepCount: number
}) {
  const labels = stepCount === 3 ? ["选择位置", "同步范围", "确认"] : ["选择位置", "确认"]
  return (
    <>
      <div className="shrink-0 px-5 pt-4">
        <DialogTitle className="font-medium">新建同步</DialogTitle>
        {showSteps ? (
          <ol className="mt-3 flex flex-wrap items-center gap-2 text-sm" aria-label="进度">
            {labels.map((label, index) => {
              const position = index + 1
              const done = step > position
              const current = step === position
              return (
                <li
                  key={label}
                  className="flex items-center gap-2"
                  aria-current={current ? "step" : undefined}
                >
                  {index > 0 ? <span aria-hidden="true" className="text-muted-foreground">─────</span> : null}
                  <span className={current ? "font-medium text-foreground" : "text-muted-foreground"}>
                    <span aria-hidden="true" className="tabular-nums">{done ? "✔" : `(${position})`}</span> {label}
                  </span>
                </li>
              )
            })}
          </ol>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
    </>
  )
}

function StepLocalPath({
  canChooseFile,
  checking,
  cloudPathHint,
  fromItem,
  kind,
  localPath,
  onChangeLocalPath,
  onEscapeToUpload,
  onPick,
  preview,
}: {
  readonly canChooseFile: boolean
  readonly checking: boolean
  readonly cloudPathHint: string
  readonly fromItem: boolean
  readonly kind: "file" | "folder"
  readonly localPath: string
  readonly onChangeLocalPath: (next: string) => void
  readonly onEscapeToUpload: () => Promise<void>
  readonly onPick: (kind: "file" | "folder") => Promise<void>
  readonly preview: DriveSyncBindingPreviewDto | null
}) {
  const pickerKind = kind === "file" ? "file" : "folder"
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <span className="text-muted-foreground">{fromItem ? "云盘" : "云盘将新建"}</span>
        <span className="truncate">{cloudPathHint}</span>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="drive-sync-wizard-path">
          {fromItem ? "选择电脑上的位置" : "选择电脑上的内容"}
        </Label>
        <div className="flex gap-2">
          <Input
            id="drive-sync-wizard-path"
            value={localPath}
            placeholder={fromItem ? (kind === "file" ? "选择保存位置" : "选择本地文件夹") : "选择要同步的文件或文件夹"}
            onChange={(event) => onChangeLocalPath(event.target.value)}
          />
          {canChooseFile ? (
            <>
              <Button type="button" variant="outline" onClick={() => { void onPick("folder") }}>
                <FolderOpen data-icon="inline-start" />选择文件夹
              </Button>
              <Button type="button" variant="outline" onClick={() => { void onPick("file") }}>选择文件</Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={() => { void onPick(pickerKind) }}>
              <FolderOpen data-icon="inline-start" />{kind === "file" ? "选择位置" : "选择文件夹"}
            </Button>
          )}
        </div>
        {fromItem ? <p className="text-sm text-muted-foreground">云盘上的「{cloudPathHint.split("/").at(-1)}」将同步到这个位置。</p> : null}
      </div>

      <PreviewStatus preview={preview} checking={checking} kind={kind} onEscapeToUpload={onEscapeToUpload} onRepick={onPick} />
    </div>
  )
}

function PreviewStatus({
  checking,
  kind,
  onEscapeToUpload,
  onRepick,
  preview,
}: {
  readonly checking: boolean
  readonly kind: "file" | "folder"
  readonly onEscapeToUpload: () => Promise<void>
  readonly onRepick: (kind: "file" | "folder") => Promise<void>
  readonly preview: DriveSyncBindingPreviewDto | null
}) {
  if (checking) {
    return <div className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">正在检查…</div>
  }
  if (!preview) {
    return <div className="text-sm text-muted-foreground">选择之后会先检查两边内容，确认可以同步再继续。</div>
  }
  if (preview.status === "blocked") {
    const escape = blockedEscape(preview, kind)
    return (
      <div className="flex gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div>
          <div className="font-medium">不能同步</div>
          <p className="mt-1 text-muted-foreground">{preview.reason ?? "两边内容无法直接建立同步。"}</p>
          {escape ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => { void onRepick(escape.kind) }}>
                {escape.label}
              </Button>
              {escape.offerUpload ? (
                <Button type="button" variant="outline" size="sm" onClick={() => { void onEscapeToUpload() }}>
                  改为上传到云盘
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
      <div className="font-medium">{previewTitle(preview)}</div>
      <p className="mt-1 text-muted-foreground">{previewDetail(preview, kind)}</p>
    </div>
  )
}

/** 阻断时给出可以真的走通的一步，而不是只显示原因。 */
function blockedEscape(
  preview: DriveSyncBindingPreviewDto,
  kind: "file" | "folder",
): { kind: "file" | "folder"; label: string; offerUpload: boolean } | null {
  if (preview.localKind === "file" && kind === "folder") {
    return { kind: "folder", label: "选择文件夹", offerUpload: false }
  }
  if (preview.localKind === "folder" && kind === "file") {
    return { kind: "file", label: "选择文件", offerUpload: false }
  }
  if (preview.localKind === "missing") {
    return { kind, label: "重新选择", offerUpload: false }
  }
  return { kind: "folder", label: "改选一个空的电脑位置", offerUpload: true }
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
    return preview.direction === "local_to_remote"
      ? `这个${noun}里没有需要上传的内容。`
      : `云端没有需要下载的内容。`
  }
  return preview.direction === "local_to_remote"
    ? `这个${noun}里的 ${transfer.fileCount} 个文件，共 ${transfer.totalBytes}，将上传到云端。`
    : `云端有 ${transfer.fileCount} 个文件，共 ${transfer.totalBytes}，将下载到这个位置。`
}

function StepScope({
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
  cloudPathHint,
  createError,
  localPath,
  preview,
}: {
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

      {createError ? (
        <div className="flex gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <div className="font-medium">不能开始同步</div>
            <p className="mt-1 text-muted-foreground">{createError}</p>
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
