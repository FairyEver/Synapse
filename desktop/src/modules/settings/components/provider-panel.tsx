import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDownIcon, ClipboardCopy, DownloadIcon, Plus } from "lucide-react"
import { toast } from "sonner"
import { createRendererLogger } from "@/app-shell/logging"
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
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { FormDialog } from "@/components/form-dialog"
import { ModelTierLabel } from "@/components/model-tier-label"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { redactSensitiveValue } from "@/lib/agent-redaction"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import {
  MODEL_TIER_DISPLAY_LABELS,
  MODEL_TIER_ORIGINAL_LABELS,
} from "@/lib/provider-model"
import { CcSwitchImportDialog } from "./cc-switch-import-dialog"
import { ProviderDeleteDialog } from "./provider-delete-dialog"
import { ProviderPackageImportDialog } from "./provider-package-import-dialog"
import { ProviderPresetPickerDialog, type ProviderPresetOption } from "./provider-preset-picker-dialog"
import type { ModelTier } from "@/types/provider-model"
import type {
  SynapseAgentProvider,
  SynapseAgentProviderApiKeyField,
  SynapseAgentProviderPreset,
  SynapseAgentProviderCategory,
  SynapseCreateAgentProviderInput,
  SynapseProviderPackageImportPreview,
  SynapseUpdateAgentProviderInput,
} from "@/types/bridge"

const logger = createRendererLogger("settings.providers")
const PROVIDER_AUTO_REFRESH_INTERVAL_MS = 5_000

const PROVIDER_CATEGORIES: Array<{ value: SynapseAgentProviderCategory; label: string }> = [
  { value: "official", label: "官方" },
  { value: "cn_official", label: "国内官方" },
  { value: "cloud_provider", label: "云服务商" },
  { value: "aggregator", label: "聚合商" },
  { value: "third_party", label: "第三方" },
  { value: "custom", label: "自定义" },
]

const API_KEY_FIELDS: SynapseAgentProviderApiKeyField[] = [
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
]

const CUSTOM_PROVIDER_PRESET_ID = "custom"
const FORM_ENV_KEYS = new Set([
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
])

type ProviderFormValues = {
  id: string
  name: string
  note: string
  websiteUrl: string
  category: SynapseAgentProviderCategory
  baseUrl: string
  apiKeyField: SynapseAgentProviderApiKeyField
  apiKey: string
  active: boolean
  model: string
  haikuModel: string
  sonnetModel: string
  opusModel: string
  sortIndex: string
  configJson: string
}

type ProviderConfigParseResult = {
  readonly env: Record<string, string>
  readonly secretEnv?: Record<string, string>
  readonly settingsConfig: Record<string, unknown>
}

type ProviderConfigJson = {
  readonly [key: string]: unknown
  readonly env?: Record<string, unknown>
  readonly hooks?: Record<string, unknown>
  readonly permissions?: Record<string, unknown>
}

type ProviderPanelViewProps = {
  readonly providers: SynapseAgentProvider[]
  readonly loading: boolean
  readonly error: string | null
  readonly onAdd: () => void
  readonly onImport: () => void
  readonly onImportFile: () => void
  readonly onView: (provider: SynapseAgentProvider) => void
  readonly onExport: (provider: SynapseAgentProvider) => void
  readonly onEdit: (provider: SynapseAgentProvider) => void
  readonly onArchive: (provider: SynapseAgentProvider) => void
  readonly onDelete: (provider: SynapseAgentProvider) => void
  readonly onRetry: () => void
}

type PendingPresetSelection = {
  readonly value: string
  readonly preset: SynapseAgentProviderPreset | null
}

type ProviderRefreshOptions = {
  readonly showLoading?: boolean
}

type ProviderPanelProps = {
  readonly refreshKey?: number
}

function ProviderPanel({ refreshKey }: ProviderPanelProps) {
  const [providers, setProviders] = useState<SynapseAgentProvider[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingProvider, setEditingProvider] = useState<SynapseAgentProvider | null>(null)
  const [detailProvider, setDetailProvider] = useState<SynapseAgentProvider | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [ccSwitchImportOpen, setCcSwitchImportOpen] = useState(false)
  const [providerPresets, setProviderPresets] = useState<SynapseAgentProviderPreset[]>([])
  const [providerPresetsLoading, setProviderPresetsLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [packagePreview, setPackagePreview] = useState<SynapseProviderPackageImportPreview | null>(null)
  const [importingPackage, setImportingPackage] = useState(false)
  const [deletingProvider, setDeletingProvider] = useState<SynapseAgentProvider | null>(null)
  const [exportConfirm, setExportConfirm] = useState<SynapseAgentProvider | null>(null)
  const [archiveConfirm, setArchiveConfirm] = useState<{ provider: SynapseAgentProvider; workflowNodeCount: number } | null>(null)
  const [formValues, setFormValues] = useState<ProviderFormValues>(() => emptyProviderForm())
  const requestIdRef = useRef(0)
  const loadingRequestIdRef = useRef(0)
  const loadingRefreshPendingRef = useRef(false)
  const providerPresetsLoadedRef = useRef(false)

  const refresh = useCallback(async (options: ProviderRefreshOptions = {}) => {
    requestIdRef.current += 1
    const requestId = requestIdRef.current
    const showLoading = options.showLoading ?? true
    if (showLoading) {
      loadingRequestIdRef.current = requestId
      loadingRefreshPendingRef.current = true
      setLoading(true)
      setError(null)
    }
    try {
      const nextProviders = await requireSynapseBridge().agent.listProviders()
      if (requestId === requestIdRef.current) {
        setProviders(nextProviders)
        setError(null)
      }
    } catch (rawError) {
      logger.error("Provider list failed.", {
        boundary: "settings.providers.list",
        action: "listProviders",
        ...providerErrorDiagnostic(rawError),
      })
      if (requestId === requestIdRef.current && showLoading) {
        setError("读取 Provider 失败")
      }
    } finally {
      if (showLoading && loadingRequestIdRef.current === requestId) {
        loadingRefreshPendingRef.current = false
        setLoading(false)
      }
    }
  }, [])

  const loadProviderPresets = useCallback(async () => {
    if (providerPresetsLoadedRef.current || providerPresetsLoading) return
    setProviderPresetsLoading(true)
    try {
      const nextPresets = await requireSynapseBridge().agent.listProviderPresets()
      setProviderPresets(nextPresets)
      providerPresetsLoadedRef.current = true
    } catch (rawError) {
      logger.error("Provider presets list failed.", {
        boundary: "settings.providers.preset.list",
        action: "listProviderPresets",
        ...providerErrorDiagnostic(rawError),
      })
      toast("读取预设失败")
    } finally {
      setProviderPresetsLoading(false)
    }
  }, [providerPresetsLoading])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!refreshKey) return
    void refresh({ showLoading: false })
  }, [refresh, refreshKey])

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "hidden") return
      if (loadingRefreshPendingRef.current) return
      void refresh({ showLoading: false })
    }
    const timer = window.setInterval(refreshWhenVisible, PROVIDER_AUTO_REFRESH_INTERVAL_MS)
    window.addEventListener("focus", refreshWhenVisible)
    document.addEventListener("visibilitychange", refreshWhenVisible)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", refreshWhenVisible)
      document.removeEventListener("visibilitychange", refreshWhenVisible)
    }
  }, [refresh])

  const openAddDialog = useCallback(() => {
    setEditingProvider(null)
    setFormValues(emptyProviderForm())
    setFormOpen(true)
    void loadProviderPresets()
  }, [loadProviderPresets])

  const openCcSwitchImportDialog = useCallback(() => {
    setCcSwitchImportOpen(true)
  }, [])

  const handleImportFile = useCallback(async () => {
    try {
      const choice = await requireSynapseBridge().agent.chooseProviderPackageImportSource()
      if (!choice.sourcePath) return
      const preview = await requireSynapseBridge().agent.previewProviderPackageImport({
        sourcePath: choice.sourcePath,
      })
      setPackagePreview(preview)
    } catch (rawError) {
      logger.error("Provider package import preview failed.", {
        boundary: "settings.providers.package.import.preview",
        action: "previewProviderPackageImport",
        ...providerErrorDiagnostic(rawError),
      })
      toast(errorToastMessage(rawError, "无法识别该文件"))
    }
  }, [])

  const handleConfirmPackageImport = useCallback(async () => {
    if (!packagePreview) return
    setImportingPackage(true)
    try {
      await requireSynapseBridge().agent.importProviderPackage({
        sourcePath: packagePreview.sourcePath,
        contentSha256: packagePreview.contentSha256,
      })
      setPackagePreview(null)
      await refresh({ showLoading: false })
      toast("已导入供应商配置")
    } catch (rawError) {
      logger.error("Provider package import failed.", {
        boundary: "settings.providers.package.import",
        action: "importProviderPackage",
        ...providerErrorDiagnostic(rawError),
      })
      toast(errorToastMessage(rawError, "导入失败"))
    } finally {
      setImportingPackage(false)
    }
  }, [packagePreview, refresh])

  const handleExportPackage = useCallback((provider: SynapseAgentProvider) => {
    setExportConfirm(provider)
  }, [])

  const confirmExportPackage = useCallback(async () => {
    const provider = exportConfirm
    if (!provider) return
    try {
      const choice = await requireSynapseBridge().agent.chooseProviderPackageExportTarget({
        providerName: provider.name,
      })
      if (!choice.targetPath) return
      await requireSynapseBridge().agent.exportProviderPackage({
        providerId: provider.id,
        targetPath: choice.targetPath,
      })
      toast("已导出含密钥的供应商配置")
    } catch (rawError) {
      logger.error("Provider package export failed.", {
        boundary: "settings.providers.package.export",
        action: "exportProviderPackage",
        providerId: provider.id,
        ...providerErrorDiagnostic(rawError),
      })
      toast(errorToastMessage(rawError, "导出失败"))
    } finally {
      setExportConfirm(null)
    }
  }, [exportConfirm])

  const openEditDialog = useCallback((provider: SynapseAgentProvider) => {
    setEditingProvider(provider)
    setFormValues(formFromProvider(provider))
    setFormOpen(true)
  }, [])

  const handleSubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    const config = providerConfigJsonFromValues(formValues)
    if (!config) {
      toast("配置 JSON 格式错误")
      return
    }
    setSaving(true)
    try {
      if (editingProvider) {
        await requireSynapseBridge().agent.updateProvider({
          providerId: editingProvider.id,
          patch: buildUpdateInput(formValues, config),
        })
      } else {
        await requireSynapseBridge().agent.createProvider({
          provider: buildCreateInput(formValues, config, new Set(providers.map((item) => item.id))),
        })
      }
      setFormOpen(false)
      await refresh()
      toast("Provider 已保存")
    } catch (rawError) {
      const action = editingProvider ? "updateProvider" : "createProvider"
      logger.error("Provider save failed.", {
        boundary: "settings.providers.save",
        action,
        providerId: editingProvider?.id ?? optionalTrimmed(formValues.id),
        ...providerErrorDiagnostic(rawError),
      })
      toast("保存 Provider 失败")
    } finally {
      setSaving(false)
    }
  }, [editingProvider, formValues, providers, refresh])

  const handleArchive = useCallback(async (provider: SynapseAgentProvider) => {
    try {
      const scan = await requireSynapseBridge().agent.scanProviderReferences({ providerId: provider.id })
      const total = scan.workflowNodeCount
      if (total > 0) {
        setArchiveConfirm({ provider, workflowNodeCount: scan.workflowNodeCount })
        return
      }
      await requireSynapseBridge().agent.archiveProvider({ providerId: provider.id })
      await refresh()
      toast("Provider 已归档")
    } catch (rawError) {
      logger.error("Provider archive failed.", {
        boundary: "settings.providers.archive",
        action: "archiveProvider",
        providerId: provider.id,
        ...providerErrorDiagnostic(rawError),
      })
      toast("归档失败")
    }
  }, [refresh])

  const confirmArchive = useCallback(async () => {
    if (!archiveConfirm) return
    try {
      await requireSynapseBridge().agent.archiveProvider({ providerId: archiveConfirm.provider.id })
      await refresh()
      toast("Provider 已归档")
      setArchiveConfirm(null)
    } catch (rawError) {
      logger.error("Provider archive failed.", {
        boundary: "settings.providers.archive",
        action: "archiveProvider",
        providerId: archiveConfirm.provider.id,
        ...providerErrorDiagnostic(rawError),
      })
      toast("归档失败")
    }
  }, [archiveConfirm, refresh])

  return (
    <>
      <ProviderPanelView
        providers={providers}
        loading={loading}
        error={error}
        onAdd={openAddDialog}
        onImport={openCcSwitchImportDialog}
        onImportFile={handleImportFile}
        onView={setDetailProvider}
        onExport={handleExportPackage}
        onEdit={openEditDialog}
        onArchive={handleArchive}
        onDelete={setDeletingProvider}
        onRetry={refresh}
      />
      <ProviderFormDialog
        open={formOpen}
        mode={editingProvider ? "edit" : "create"}
        provider={editingProvider}
        providers={providers}
        presets={providerPresets}
        presetsLoading={providerPresetsLoading}
        values={formValues}
        saving={saving}
        onValuesChange={setFormValues}
        onOpenChange={setFormOpen}
        onSubmit={handleSubmit}
      />
      <CcSwitchImportDialog
        open={ccSwitchImportOpen}
        onOpenChange={setCcSwitchImportOpen}
        onImported={() => void refresh()}
      />
      <ProviderPackageImportDialog
        preview={packagePreview}
        importing={importingPackage}
        onOpenChange={(open) => {
          if (!open) setPackagePreview(null)
        }}
        onImport={() => void handleConfirmPackageImport()}
      />
      <ProviderDetailDialog
        provider={detailProvider}
        onOpenChange={(open) => {
          if (!open) setDetailProvider(null)
        }}
      />
      <ProviderDeleteDialog
        provider={deletingProvider}
        onOpenChange={(open) => { if (!open) setDeletingProvider(null) }}
        onDeleted={() => void refresh()}
      />
      <AlertDialog open={Boolean(exportConfirm)} onOpenChange={(open) => { if (!open) setExportConfirm(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>导出含密钥的供应商配置</AlertDialogTitle>
            <AlertDialogDescription>
              文件会包含 &ldquo;{exportConfirm?.name}&rdquo; 的 API Key 和 secret env。只保存到可信位置。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmExportPackage()}>导出含密钥文件</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={Boolean(archiveConfirm)} onOpenChange={(open) => { if (!open) setArchiveConfirm(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>归档供应商 &ldquo;{archiveConfirm?.provider.name}&rdquo;</AlertDialogTitle>
            <AlertDialogDescription>
              该供应商被 {archiveConfirm?.workflowNodeCount ?? 0} 个工作流节点引用。归档后这些内容仍可正常执行，但无法在选择列表中看到该供应商。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmArchive()}>确认归档</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ProviderPanelView({
  providers,
  loading,
  error,
  onAdd,
  onImport,
  onImportFile,
  onView,
  onExport,
  onEdit,
  onArchive,
  onDelete,
  onRetry,
}: ProviderPanelViewProps) {
  const visibleProviders = useMemo(
    () => providers.filter((provider) => !provider.archived),
    [providers],
  )

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <CardTitle className="text-base">Claude 供应商</CardTitle>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={onImportFile}>
            <DownloadIcon data-icon="inline-start" />
            导入文件
          </Button>
          <Button type="button" variant="outline" onClick={onImport}>
            <DownloadIcon data-icon="inline-start" />
            从 CCS 导入
          </Button>
          <Button type="button" onClick={onAdd}>
            <Plus data-icon="inline-start" />
            新建
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="flex items-center gap-2">
            <p className="text-sm text-destructive">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              重试
            </Button>
          </div>
        ) : (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-48">名称</TableHead>
                <TableHead>模型</TableHead>
                <TableHead className="w-64 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground">
                    正在加载
                  </TableCell>
                </TableRow>
              ) : visibleProviders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground">
                    暂无 Provider
                  </TableCell>
                </TableRow>
              ) : visibleProviders.map((provider) => (
                <TableRow key={provider.id}>
                  <TableCell className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <button
                        type="button"
                        className="min-w-0 truncate text-left font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                        onClick={() => onView(provider)}
                      >
                        {provider.name}
                      </button>
                    </div>
                  </TableCell>
                  <TableCell className="min-w-0 whitespace-normal">
                    <ProviderModelList provider={provider} />
                  </TableCell>
                  <TableCell className="w-64 whitespace-nowrap text-right">
                    <ProviderRowActions
                      provider={provider}
                      onExport={onExport}
                      onEdit={onEdit}
                      onArchive={onArchive}
                      onDelete={onDelete}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function ProviderDetailDialog({
  provider,
  onOpenChange,
}: {
  readonly provider: SynapseAgentProvider | null
  readonly onOpenChange: (open: boolean) => void
}) {
  const configJson = provider ? safeProviderConfigJson(provider) : ""

  return (
    <Dialog open={Boolean(provider)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{provider?.name ?? "Provider 配置"}</DialogTitle>
        </DialogHeader>

        {provider ? (
          <div className="flex flex-col gap-2">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <ProviderDetailItem label="ID" value={provider.id} />
              <ProviderDetailItem label="类型" value={providerCategoryLabel(provider.category)} />
              <ProviderDetailItem label="请求地址" value={provider.baseUrl} />
              <ProviderDetailItem label="Key 字段" value={provider.apiKeyField} />
              <ProviderDetailItem label="官网" value={provider.websiteUrl} />
              <ProviderDetailItem label="配置路径" value={provider.configPath} />
              <ProviderDetailItem label="备注" value={provider.note} />
            </div>
            <Textarea
              aria-label="Provider 配置 JSON"
              value={configJson}
              readOnly
              className="min-h-60 font-mono text-xs"
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ProviderDetailItem({
  label,
  value,
}: {
  readonly label: string
  readonly value?: string
}) {
  if (!value) return null

  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate">{value}</div>
    </div>
  )
}

function ProviderModelList({ provider }: { readonly provider: SynapseAgentProvider }) {
  const models = providerModelRows(provider)
  if (models.length === 0) {
    return <span className="text-muted-foreground">-</span>
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-1">
        {models.map((model) => (
          <div key={model.tier} className="flex min-w-0 items-center gap-2">
            <ModelTierLabel
              tier={model.tier}
              className="w-14 shrink-0 text-xs text-muted-foreground"
            />
            <span className="min-w-0 truncate">{model.value}</span>
            <CopyProviderModelIdButton
              providerId={provider.id}
              modelTier={model.tier}
            />
          </div>
        ))}
      </div>
    </TooltipProvider>
  )
}

function CopyProviderModelIdButton({
  providerId,
  modelTier,
}: {
  readonly providerId: string
  readonly modelTier: ModelTier
}) {
  const copyLabel = providerModelCopyLabel(modelTier)

  const handleCopy = () => {
    if (!navigator.clipboard?.writeText) {
      toast("复制失败")
      return
    }

    const value = providerModelUri(providerId, modelTier)
    void navigator.clipboard.writeText(value).then(() => {
      toast("模型 ID 已复制")
    }).catch((rawError: unknown) => {
      logger.error("Provider model id copy failed.", {
        action: "copyProviderModelId",
        boundary: "settings.providers.model-id-copy",
        providerId,
        modelTier,
        ...providerErrorDiagnostic(rawError),
      })
      toast("复制失败")
    })
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={copyLabel}
          className="size-6 shrink-0 text-muted-foreground"
          onClick={handleCopy}
        >
          <ClipboardCopy className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copyLabel}</TooltipContent>
    </Tooltip>
  )
}

function ProviderRowActions({
  provider,
  onExport,
  onEdit,
  onArchive,
  onDelete,
}: {
  readonly provider: SynapseAgentProvider
  readonly onExport: (provider: SynapseAgentProvider) => void
  readonly onEdit: (provider: SynapseAgentProvider) => void
  readonly onArchive: (provider: SynapseAgentProvider) => void
  readonly onDelete: (provider: SynapseAgentProvider) => void
}) {
  if (provider.readonly) return null

  return (
    <div className="flex justify-end gap-2">
      <ProviderTextAction onClick={() => onExport(provider)}>导出密钥包</ProviderTextAction>
      <ProviderTextAction onClick={() => onEdit(provider)}>编辑</ProviderTextAction>
      <ProviderTextAction onClick={() => onArchive(provider)}>归档</ProviderTextAction>
      <ProviderTextAction onClick={() => onDelete(provider)}>删除</ProviderTextAction>
    </div>
  )
}

function ProviderTextAction({
  children,
  onClick,
}: {
  readonly children: ReactNode
  readonly onClick: () => void
}) {
  return (
    <button
      type="button"
      className="shrink-0 whitespace-nowrap text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function providerModelRows(provider: SynapseAgentProvider): Array<{ value: string; tier: ModelTier }> {
  return [
    { value: provider.model, tier: "default" },
    { value: provider.opusModel, tier: "opus" },
    { value: provider.sonnetModel, tier: "sonnet" },
    { value: provider.haikuModel, tier: "haiku" },
  ].flatMap((item) => {
    const value = optionalTrimmed(item.value)
    return value ? [{ value, tier: item.tier as ModelTier }] : []
  })
}

function providerModelUri(providerId: string, modelTier: ModelTier): string {
  return `synapse-provider-model://${providerId}/${modelTier}`
}

function providerModelCopyLabel(tier: ModelTier): string {
  return `复制 ${MODEL_TIER_DISPLAY_LABELS[tier]} 模型 ID（${MODEL_TIER_ORIGINAL_LABELS[tier]}）`
}

function providerCategoryLabel(category: SynapseAgentProviderCategory): string {
  return PROVIDER_CATEGORIES.find((item) => item.value === category)?.label ?? category
}

function safeProviderConfigJson(provider: SynapseAgentProvider): string {
  const config = JSON.parse(formFromProvider(provider).configJson)
  return JSON.stringify(redactSensitiveValue(config), null, 2)
}

function ProviderFormDialog({
  open,
  mode,
  provider,
  providers,
  presets,
  presetsLoading,
  values,
  saving,
  onValuesChange,
  onOpenChange,
  onSubmit,
}: {
  readonly open: boolean
  readonly mode: "create" | "edit"
  readonly provider: SynapseAgentProvider | null
  readonly providers: SynapseAgentProvider[]
  readonly presets: SynapseAgentProviderPreset[]
  readonly presetsLoading: boolean
  readonly values: ProviderFormValues
  readonly saving: boolean
  readonly onValuesChange: (values: ProviderFormValues) => void
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: (event: FormEvent) => void
}) {
  const [selectedPresetValue, setSelectedPresetValue] = useState(CUSTOM_PROVIDER_PRESET_ID)
  const [pendingPresetSelection, setPendingPresetSelection] = useState<PendingPresetSelection | null>(null)
  const [presetPickerOpen, setPresetPickerOpen] = useState(false)
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) {
      setSelectedPresetValue(CUSTOM_PROVIDER_PRESET_ID)
      setPendingPresetSelection(null)
      setPresetPickerOpen(false)
      setTemplateValues({})
    }
  }, [open])

  const existingProviderIds = useMemo(
    () => new Set(providers.map((item) => item.id)),
    [providers],
  )

  const presetOptions = useMemo<ProviderPresetOption[]>(
    () => presets.map((preset) => ({
      value: providerPresetSelectValue(preset),
      preset,
    })),
    [presets],
  )

  const selectedPreset = useMemo(() => {
    if (selectedPresetValue === CUSTOM_PROVIDER_PRESET_ID) return null
    return presetOptions.find((option) => option.value === selectedPresetValue)?.preset ?? null
  }, [presetOptions, selectedPresetValue])

  const selectedPresetLabel = selectedPreset?.name ?? "自定义"

  const handlePresetSelect = (value: string) => {
    if (value === selectedPresetValue) return
    const preset = presetOptions.find((option) => option.value === value)?.preset ?? null
    setPendingPresetSelection({ value, preset })
  }

  const applyPresetSelection = () => {
    if (!pendingPresetSelection) return
    setSelectedPresetValue(pendingPresetSelection.value)
    if (!pendingPresetSelection.preset) {
      setTemplateValues({})
      onValuesChange(emptyProviderForm())
      setPendingPresetSelection(null)
      return
    }
    const defaults = templateDefaultsFromPreset(pendingPresetSelection.preset)
    setTemplateValues(defaults)
    onValuesChange(formFromPreset(pendingPresetSelection.preset, existingProviderIds, defaults, values))
    setPendingPresetSelection(null)
  }

  const cancelPresetSelection = () => {
    setPendingPresetSelection(null)
  }

  const updateTemplateValue = (key: string, value: string) => {
    if (!selectedPreset) return
    const nextValues = {
      ...templateValues,
      [key]: value,
    }
    setTemplateValues(nextValues)
    onValuesChange(formFromPreset(selectedPreset, existingProviderIds, nextValues, values))
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <FormDialog
          title={mode === "create" ? "新建 Claude 供应商" : "编辑 Claude 供应商"}
          contentClassName="sm:max-w-4xl"
          bodyClassName="flex flex-col gap-2"
          onSubmit={onSubmit}
          footer={(
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" disabled={saving || !values.name.trim()}>
                保存
              </Button>
            </>
          )}
        >
          <ProviderInlineEditor
            mode={mode}
            provider={provider}
            selectedPreset={selectedPreset}
            templateValues={templateValues}
            values={values}
            saving={saving}
            presetField={mode === "create" ? (
              <Field>
                <FieldLabel>供应商预设</FieldLabel>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                  disabled={presetsLoading}
                  onClick={() => setPresetPickerOpen(true)}
                >
                  <span className="truncate">{selectedPresetLabel}</span>
                  <ChevronDownIcon className="text-muted-foreground" />
                </Button>
                <ProviderPresetPickerDialog
                  open={presetPickerOpen}
                  options={presetOptions}
                  categories={PROVIDER_CATEGORIES}
                  selectedValue={selectedPresetValue}
                  customValue={CUSTOM_PROVIDER_PRESET_ID}
                  onOpenChange={setPresetPickerOpen}
                  onSelect={handlePresetSelect}
                />
              </Field>
            ) : null}
            onValuesChange={onValuesChange}
            onTemplateValueChange={updateTemplateValue}
          />
        </FormDialog>
      </Dialog>
      <AlertDialog open={Boolean(pendingPresetSelection)} onOpenChange={(nextOpen) => {
        if (!nextOpen) cancelPresetSelection()
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重置表单</AlertDialogTitle>
            <AlertDialogDescription>
              当前表单将被重置，并填入供应商默认值。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelPresetSelection}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={applyPresetSelection}>确认</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ProviderInlineEditor({
  mode,
  provider,
  selectedPreset,
  templateValues,
  values,
  saving,
  presetField,
  onValuesChange,
  onTemplateValueChange,
}: {
  readonly mode: "create" | "edit"
  readonly provider: SynapseAgentProvider | null
  readonly selectedPreset: SynapseAgentProviderPreset | null
  readonly templateValues: Record<string, string>
  readonly values: ProviderFormValues
  readonly saving: boolean
  readonly presetField?: ReactNode
  readonly onValuesChange: (values: ProviderFormValues) => void
  readonly onTemplateValueChange: (key: string, value: string) => void
}) {
  const disabled = Boolean(provider?.readonly || saving)
  const setValue = <K extends keyof ProviderFormValues>(key: K, value: ProviderFormValues[K]) => {
    if (key === "configJson") {
      onValuesChange(formFromConfigJson(values, String(value)))
      return
    }
    const nextValues = { ...values, [key]: value }
    onValuesChange(syncConfigJsonFromForm(nextValues, values.configJson, key))
  }

  return (
    <div className="flex flex-col gap-5">
      <FieldGroup>
        {mode === "create" && selectedPreset && selectedPreset.templateValues.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {selectedPreset.templateValues.map((item) => (
              <Field key={item.key}>
                <FieldLabel htmlFor={`provider-template-${item.key}`}>{item.label}</FieldLabel>
                <Input
                  id={`provider-template-${item.key}`}
                  type={item.sensitive ? "password" : "text"}
                  value={templateValues[item.key] ?? item.defaultValue ?? ""}
                  placeholder={item.placeholder}
                  onChange={(event) => onTemplateValueChange(item.key, event.target.value)}
                />
              </Field>
            ))}
          </div>
        ) : null}

        <div className={`grid gap-2 ${presetField ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
          {presetField}
          <Field>
            <FieldLabel htmlFor="provider-name">供应商名称</FieldLabel>
            <Input
              id="provider-name"
              value={values.name}
              placeholder="例如：Claude 官方"
              disabled={disabled}
              required
              onChange={(event) => setValue("name", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="provider-note">备注</FieldLabel>
            <Input
              id="provider-note"
              value={values.note}
              placeholder="例如：公司专用账号"
              disabled={disabled}
              onChange={(event) => setValue("note", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="provider-website-url">官网链接</FieldLabel>
            <Input
              id="provider-website-url"
              value={values.websiteUrl}
              placeholder="https://example.com"
              disabled={disabled}
              onChange={(event) => setValue("websiteUrl", event.target.value)}
            />
          </Field>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="provider-base-url">请求地址</FieldLabel>
            <Input
              id="provider-base-url"
              value={values.baseUrl}
              placeholder="https://your-api-endpoint.com"
              disabled={disabled}
              onChange={(event) => setValue("baseUrl", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="provider-api-key">API Key</FieldLabel>
            <Input
              id="provider-api-key"
              type="password"
              autoComplete="off"
              value={values.apiKey}
              placeholder={mode === "edit" ? "保持不变" : "只需要填这里，下方配置会自动填充"}
              disabled={disabled}
              onChange={(event) => setValue("apiKey", event.target.value)}
            />
          </Field>
        </div>

        <ProviderApiAndModelFields
          disabled={disabled}
          values={values}
          onValueChange={setValue}
        />

        <Field>
          <FieldLabel htmlFor="provider-config-json">配置 JSON</FieldLabel>
          <Textarea
            id="provider-config-json"
            aria-label="配置 JSON"
            value={values.configJson}
            rows={14}
            spellCheck={false}
            disabled={disabled}
            onChange={(event) => setValue("configJson", event.target.value)}
          />
        </Field>
      </FieldGroup>
    </div>
  )
}

function ProviderApiAndModelFields({
  disabled,
  values,
  onValueChange,
}: {
  readonly disabled: boolean
  readonly values: ProviderFormValues
  readonly onValueChange: <K extends keyof ProviderFormValues>(key: K, value: ProviderFormValues[K]) => void
}) {
  return (
    <>
      <div className="grid gap-2 md:grid-cols-2">
        <Field>
          <FieldLabel>API 格式</FieldLabel>
          <Select value="anthropic" disabled>
            <SelectTrigger id="provider-api-format" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="anthropic">
                  Anthropic Messages (原生)
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>认证字段</FieldLabel>
          <Select
            value={values.apiKeyField}
            disabled={disabled}
            onValueChange={(value) => onValueChange("apiKeyField", value as SynapseAgentProviderApiKeyField)}
          >
            <SelectTrigger id="provider-api-key-field" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {API_KEY_FIELDS.map((field) => (
                  <SelectItem key={field} value={field}>
                    {apiKeyFieldLabel(field)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">模型映射</p>
          <FieldDescription>
            如果供应商原生提供 Claude 系列模型，通常无需配置。仅在需要将请求映射到不同模型名称时填写。
          </FieldDescription>
        </div>
        <TooltipProvider>
          <div className="grid grid-cols-4 gap-2">
            <Field>
              <FieldLabel htmlFor="provider-model">
                <ModelTierLabel tier="default" />
              </FieldLabel>
              <Input
                id="provider-model"
                value={values.model}
                disabled={disabled}
                onChange={(event) => onValueChange("model", event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="provider-opus-model">
                <ModelTierLabel tier="opus" />
              </FieldLabel>
              <Input
                id="provider-opus-model"
                value={values.opusModel}
                disabled={disabled}
                onChange={(event) => onValueChange("opusModel", event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="provider-sonnet-model">
                <ModelTierLabel tier="sonnet" />
              </FieldLabel>
              <Input
                id="provider-sonnet-model"
                value={values.sonnetModel}
                disabled={disabled}
                onChange={(event) => onValueChange("sonnetModel", event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="provider-haiku-model">
                <ModelTierLabel tier="haiku" />
              </FieldLabel>
              <Input
                id="provider-haiku-model"
                value={values.haikuModel}
                disabled={disabled}
                onChange={(event) => onValueChange("haikuModel", event.target.value)}
              />
            </Field>
          </div>
        </TooltipProvider>
      </div>
    </>
  )
}

function apiKeyFieldLabel(field: SynapseAgentProviderApiKeyField): string {
  if (field === "ANTHROPIC_AUTH_TOKEN") {
    return "ANTHROPIC_AUTH_TOKEN（默认）"
  }
  return field
}

function emptyProviderForm(): ProviderFormValues {
  return {
    id: "",
    name: "",
    note: "",
    websiteUrl: "",
    category: "custom",
    baseUrl: "",
    apiKeyField: "ANTHROPIC_AUTH_TOKEN",
    apiKey: "",
    active: false,
    model: "",
    haikuModel: "",
    sonnetModel: "",
    opusModel: "",
    sortIndex: "",
    configJson: providerConfigJson({}),
  }
}

function formFromProvider(provider: SynapseAgentProvider): ProviderFormValues {
  const values = {
    id: provider.id,
    name: provider.name,
    note: provider.note ?? "",
    websiteUrl: provider.websiteUrl ?? "",
    category: provider.category,
    baseUrl: provider.baseUrl ?? "",
    apiKeyField: provider.apiKeyField,
    apiKey: "",
    active: Boolean(provider.active),
    model: provider.model ?? "",
    haikuModel: provider.haikuModel ?? "",
    sonnetModel: provider.sonnetModel ?? "",
    opusModel: provider.opusModel ?? "",
    sortIndex: provider.sortIndex === undefined ? "" : String(provider.sortIndex),
    configJson: providerConfigJson(provider.env ?? {}, provider.settingsConfig),
  }
  return syncConfigJsonFromForm(values, values.configJson)
}

function formFromPreset(
  preset: SynapseAgentProviderPreset,
  existingIds: ReadonlySet<string>,
  templateValues: Record<string, string>,
  previousValues: ProviderFormValues = emptyProviderForm(),
): ProviderFormValues {
  const values = {
    ...emptyProviderForm(),
    apiKey: previousValues.apiKey,
    active: previousValues.active,
    sortIndex: previousValues.sortIndex,
    id: providerIdFromPresetName(preset.name, existingIds),
    name: preset.name,
    websiteUrl: preset.websiteUrl ?? "",
    category: preset.category,
    baseUrl: applyTemplateValues(preset.baseUrl, templateValues) ?? "",
    apiKeyField: preset.apiKeyField,
    model: applyTemplateValues(preset.model, templateValues) ?? "",
    haikuModel: applyTemplateValues(preset.haikuModel, templateValues) ?? "",
    sonnetModel: applyTemplateValues(preset.sonnetModel, templateValues) ?? "",
    opusModel: applyTemplateValues(preset.opusModel, templateValues) ?? "",
  }
  return syncConfigJsonFromForm(values, previousValues.configJson)
}

function buildCreateInput(
  values: ProviderFormValues,
  config: ProviderConfigParseResult,
  existingIds: ReadonlySet<string>,
): SynapseCreateAgentProviderInput {
  const trimmedId = values.id.trim()
  return {
    id: trimmedId || providerIdFromPresetName(values.name.trim(), existingIds),
    name: values.name.trim(),
    note: optionalTrimmed(values.note),
    websiteUrl: optionalTrimmed(values.websiteUrl),
    category: values.category,
    baseUrl: optionalTrimmed(values.baseUrl),
    apiKeyField: values.apiKeyField,
    apiKey: optionalTrimmed(values.apiKey),
    active: values.active,
    model: optionalTrimmed(values.model),
    haikuModel: optionalTrimmed(values.haikuModel),
    sonnetModel: optionalTrimmed(values.sonnetModel),
    opusModel: optionalTrimmed(values.opusModel),
    env: config.env,
    secretEnv: config.secretEnv,
    settingsConfig: config.settingsConfig,
    sortIndex: optionalNumber(values.sortIndex),
  }
}

function buildUpdateInput(
  values: ProviderFormValues,
  config: ProviderConfigParseResult,
): SynapseUpdateAgentProviderInput {
  const apiKey = optionalTrimmed(values.apiKey)
  return {
    name: values.name.trim(),
    note: optionalTrimmed(values.note),
    websiteUrl: optionalTrimmed(values.websiteUrl),
    category: values.category,
    baseUrl: optionalTrimmed(values.baseUrl),
    apiKeyField: values.apiKeyField,
    active: values.active,
    model: optionalTrimmed(values.model),
    haikuModel: optionalTrimmed(values.haikuModel),
    sonnetModel: optionalTrimmed(values.sonnetModel),
    opusModel: optionalTrimmed(values.opusModel),
    env: config.env,
    secretEnv: config.secretEnv,
    settingsConfig: config.settingsConfig,
    sortIndex: optionalNumber(values.sortIndex),
    ...(apiKey ? { apiKey } : {}),
  }
}

function providerConfigJson(
  env: Record<string, string>,
  settingsConfig: Record<string, unknown> = {},
): string {
  const baseConfig = normalizedProviderConfig(settingsConfig)
  const baseEnv = isRecord(baseConfig.env) ? stringifyEnvRecord(baseConfig.env) : {}
  return JSON.stringify({
    ...baseConfig,
    env: {
      ...baseEnv,
      ...env,
    },
  }, null, 2)
}

function syncConfigJsonFromForm(
  values: ProviderFormValues,
  previousConfigJson: string,
  changedKey?: keyof ProviderFormValues,
): ProviderFormValues {
  if (changedKey && !isConfigBackedField(changedKey)) return values
  const parsed = parseProviderConfigObject(previousConfigJson)
  if (!parsed) return values
  const env = isRecord(parsed.env) ? { ...parsed.env } : {}
  syncEnvString(env, "ANTHROPIC_BASE_URL", values.baseUrl)
  syncEnvString(env, "ANTHROPIC_MODEL", values.model)
  syncEnvString(env, "ANTHROPIC_DEFAULT_HAIKU_MODEL", values.haikuModel)
  syncEnvString(env, "ANTHROPIC_DEFAULT_SONNET_MODEL", values.sonnetModel)
  syncEnvString(env, "ANTHROPIC_DEFAULT_OPUS_MODEL", values.opusModel)

  const otherApiKeyField = values.apiKeyField === "ANTHROPIC_AUTH_TOKEN"
    ? "ANTHROPIC_API_KEY"
    : "ANTHROPIC_AUTH_TOKEN"
  delete env[otherApiKeyField]
  const shouldKeepApiKeyField = Boolean(values.apiKey.trim())
    || Object.prototype.hasOwnProperty.call(env, values.apiKeyField)
    || Boolean(values.baseUrl.trim())
  if (shouldKeepApiKeyField) {
    env[values.apiKeyField] = values.apiKey
  }

  return {
    ...values,
    configJson: JSON.stringify({
      ...parsed,
      env,
    }, null, 2),
  }
}

function formFromConfigJson(values: ProviderFormValues, configJson: string): ProviderFormValues {
  const parsed = parseProviderConfigObject(configJson)
  if (!parsed) return { ...values, configJson }
  const env = isRecord(parsed.env) ? parsed.env : {}
  const apiKeyField = Object.prototype.hasOwnProperty.call(env, "ANTHROPIC_API_KEY")
    && !Object.prototype.hasOwnProperty.call(env, "ANTHROPIC_AUTH_TOKEN")
    ? "ANTHROPIC_API_KEY"
    : "ANTHROPIC_AUTH_TOKEN"
  return {
    ...values,
    configJson,
    baseUrl: envString(env.ANTHROPIC_BASE_URL),
    apiKeyField,
    apiKey: envString(env[apiKeyField]),
    model: envString(env.ANTHROPIC_MODEL),
    haikuModel: envString(env.ANTHROPIC_DEFAULT_HAIKU_MODEL),
    sonnetModel: envString(env.ANTHROPIC_DEFAULT_SONNET_MODEL),
    opusModel: envString(env.ANTHROPIC_DEFAULT_OPUS_MODEL),
  }
}

function providerConfigJsonFromValues(values: ProviderFormValues): ProviderConfigParseResult | null {
  let parsed: ProviderConfigJson
  try {
    parsed = JSON.parse(values.configJson || "{}") as ProviderConfigJson
  } catch {
    return null
  }
  const splitEnv = splitProviderConfigEnv(stripFormEnvKeys(stringifyEnvRecord(parsed.env)))
  return {
    env: splitEnv.publicEnv,
    secretEnv: Object.keys(splitEnv.secretEnv).length ? splitEnv.secretEnv : undefined,
    settingsConfig: settingsConfigFromParsed(parsed, splitEnv.publicEnv),
  }
}

function normalizedProviderConfig(settingsConfig: Record<string, unknown>): ProviderConfigJson {
  return {
    env: {},
    hooks: {},
    permissions: {
      allow: [],
      deny: [],
    },
    ...settingsConfig,
  }
}

function settingsConfigFromParsed(
  parsed: ProviderConfigJson,
  publicEnv: Record<string, string>,
): Record<string, unknown> {
  const settingsConfig: Record<string, unknown> = { ...parsed }
  if (Object.keys(publicEnv).length > 0) {
    settingsConfig.env = publicEnv
  } else {
    delete settingsConfig.env
  }
  return settingsConfig
}

function parseProviderConfigObject(configJson: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(configJson || "{}") as unknown
    return isRecord(parsed) ? { ...parsed } : {}
  } catch {
    return null
  }
}

function isConfigBackedField(key: keyof ProviderFormValues): boolean {
  return key === "baseUrl"
    || key === "apiKeyField"
    || key === "apiKey"
    || key === "model"
    || key === "haikuModel"
    || key === "sonnetModel"
    || key === "opusModel"
}

function syncEnvString(env: Record<string, unknown>, key: string, value: string): void {
  const trimmed = value.trim()
  if (trimmed) {
    env[key] = trimmed
  } else {
    delete env[key]
  }
}

function envString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : ""
}

function stripFormEnvKeys(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !FORM_ENV_KEYS.has(key)))
}

function splitProviderConfigEnv(env: Record<string, string>): {
  readonly publicEnv: Record<string, string>
  readonly secretEnv: Record<string, string>
} {
  const publicEnv: Record<string, string> = {}
  const secretEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (isSensitiveEnvName(key)) {
      secretEnv[key] = value
    } else {
      publicEnv[key] = value
    }
  }
  return { publicEnv, secretEnv }
}

function isSensitiveEnvName(key: string): boolean {
  return /(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY|ACCESS_KEY)/i.test(key)
}

function stringifyEnvRecord(value: Record<string, unknown> | undefined): Record<string, string> {
  if (!value) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
      .map(([key, item]) => [key, String(item)]),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function templateDefaultsFromPreset(preset: SynapseAgentProviderPreset): Record<string, string> {
  return Object.fromEntries(
    preset.templateValues.map((item) => [item.key, item.defaultValue ?? ""]),
  )
}

function providerPresetSelectValue(preset: SynapseAgentProviderPreset): string {
  return `preset:${preset.name}`
}

function providerIdFromPresetName(name: string, existingIds: ReadonlySet<string>): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "provider"
  if (!existingIds.has(base)) return base
  let suffix = 2
  while (existingIds.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

function applyTemplateValues(value: string | undefined, values: Record<string, string>): string | undefined {
  if (!value) return value
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, key: string) => values[key] ?? "")
}

function optionalTrimmed(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? ""
  return trimmed || undefined
}

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function providerErrorDiagnostic(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}

function errorToastMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return fallback
}

export { ProviderPanel, ProviderPanelView }
