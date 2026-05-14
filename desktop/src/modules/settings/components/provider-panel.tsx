import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Plus, Search } from "lucide-react"
import { toast } from "sonner"
import { createRendererLogger } from "@/app-shell/logging"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
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
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseAgentProvider,
  SynapseAgentProviderApiKeyField,
  SynapseAgentProviderPreset,
  SynapseAgentProviderCategory,
  SynapseCreateAgentProviderInput,
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
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
]

type ProviderFormValues = {
  id: string
  name: string
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
}

type ProviderPanelViewProps = {
  readonly providers: SynapseAgentProvider[]
  readonly loading: boolean
  readonly error: string | null
  readonly onAdd: () => void
  readonly onAddPreset: () => void
  readonly onEdit: (provider: SynapseAgentProvider) => void
  readonly onArchive: (provider: SynapseAgentProvider) => void
  readonly onSetActive: (provider: SynapseAgentProvider) => void
  readonly onRetry: () => void
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
  const [formOpen, setFormOpen] = useState(false)
  const [presetDialogOpen, setPresetDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formValues, setFormValues] = useState<ProviderFormValues>(() => emptyProviderForm())
  const requestIdRef = useRef(0)
  const loadingRequestIdRef = useRef(0)
  const loadingRefreshPendingRef = useRef(false)

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
  }, [])

  const openPresetDialog = useCallback(() => {
    setPresetDialogOpen(true)
  }, [])

  const openEditDialog = useCallback((provider: SynapseAgentProvider) => {
    setEditingProvider(provider)
    setFormValues(formFromProvider(provider))
    setFormOpen(true)
  }, [])

  const handleSubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      if (editingProvider) {
        await requireSynapseBridge().agent.updateProvider({
          providerId: editingProvider.id,
          patch: buildUpdateInput(formValues),
        })
      } else {
        await requireSynapseBridge().agent.createProvider({
          provider: buildCreateInput(formValues),
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
  }, [editingProvider, formValues, refresh])

  const handleCreateFromPreset = useCallback(async (input: {
    readonly presetName: string
    readonly apiKey?: string
    readonly templateValues: Record<string, string>
  }) => {
    setSaving(true)
    try {
      await requireSynapseBridge().agent.createProviderFromPreset(input)
      setPresetDialogOpen(false)
      await refresh()
      toast("Provider 已保存")
    } catch (rawError) {
      logger.error("Provider preset save failed.", {
        boundary: "settings.providers.preset.save",
        action: "createProviderFromPreset",
        providerId: input.presetName,
        ...providerErrorDiagnostic(rawError),
      })
      toast("保存 Provider 失败")
    } finally {
      setSaving(false)
    }
  }, [refresh])

  const handleArchive = useCallback(async (provider: SynapseAgentProvider) => {
    try {
      await requireSynapseBridge().agent.archiveProvider({
        providerId: provider.id,
      })
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

  const handleSetActive = useCallback(async (provider: SynapseAgentProvider) => {
    try {
      await requireSynapseBridge().agent.setActiveProvider({
        providerId: provider.id,
      })
      await refresh()
      toast("已设为默认")
    } catch (rawError) {
      logger.error("Provider activate failed.", {
        boundary: "settings.providers.activate",
        action: "setActiveProvider",
        providerId: provider.id,
        ...providerErrorDiagnostic(rawError),
      })
      toast("切换失败")
    }
  }, [refresh])

  return (
    <>
      <ProviderPanelView
        providers={providers}
        loading={loading}
        error={error}
        onAdd={openAddDialog}
        onAddPreset={openPresetDialog}
        onEdit={openEditDialog}
        onArchive={handleArchive}
        onSetActive={handleSetActive}
        onRetry={refresh}
      />
      <ProviderFormDialog
        open={formOpen}
        mode={editingProvider ? "edit" : "create"}
        values={formValues}
        saving={saving}
        onValuesChange={setFormValues}
        onOpenChange={setFormOpen}
        onSubmit={handleSubmit}
      />
      <ProviderPresetDialog
        open={presetDialogOpen}
        saving={saving}
        onOpenChange={setPresetDialogOpen}
        onSubmit={handleCreateFromPreset}
      />
    </>
  )
}

function ProviderPanelView({
  providers,
  loading,
  error,
  onAdd,
  onAddPreset,
  onEdit,
  onArchive,
  onSetActive,
  onRetry,
}: ProviderPanelViewProps) {
  const visibleProviders = useMemo(
    () => providers.filter((provider) => !provider.archived),
    [providers],
  )

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <CardTitle className="text-base">Provider</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onAddPreset}>
            从预设添加
          </Button>
          <Button type="button" size="sm" onClick={onAdd}>
            <Plus data-icon="inline-start" />
            添加
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="flex items-center gap-3">
            <p className="text-sm text-destructive">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              重试
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>模型</TableHead>
                <TableHead>Key 字段</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    正在加载
                  </TableCell>
                </TableRow>
              ) : visibleProviders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    暂无 Provider
                  </TableCell>
                </TableRow>
              ) : visibleProviders.map((provider) => (
                <TableRow key={provider.id}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{provider.name}</span>
                      {provider.readonly ? <Badge variant="secondary">本机</Badge> : null}
                      {provider.active ? <Badge variant="secondary">默认</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell>{provider.model || "-"}</TableCell>
                  <TableCell>{provider.apiKeyField}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={Boolean(provider.readonly)}
                        onClick={() => onEdit(provider)}
                      >
                        编辑
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={Boolean(provider.active)}
                        onClick={() => onSetActive(provider)}
                      >
                        设为默认
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={Boolean(provider.readonly)}
                        onClick={() => onArchive(provider)}
                      >
                        归档
                      </Button>
                    </div>
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

function ProviderPresetDialog({
  open,
  saving,
  onOpenChange,
  onSubmit,
}: {
  readonly open: boolean
  readonly saving: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: (input: {
    readonly presetName: string
    readonly apiKey?: string
    readonly templateValues: Record<string, string>
  }) => Promise<void>
}) {
  const [presets, setPresets] = useState<SynapseAgentProviderPreset[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<SynapseAgentProviderPreset | null>(null)
  const [apiKey, setApiKey] = useState("")
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    setLoading(true)
    requireSynapseBridge().agent.listProviderPresets()
      .then((nextPresets) => {
        setPresets(nextPresets)
      })
      .catch((rawError) => {
        logger.error("Provider presets list failed.", {
          boundary: "settings.providers.preset.list",
          action: "listProviderPresets",
          ...providerErrorDiagnostic(rawError),
        })
        toast("读取预设失败")
      })
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    if (!open) {
      setSelected(null)
      setApiKey("")
      setTemplateValues({})
      setQuery("")
    }
  }, [open])

  const visiblePresets = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return presets
    return presets.filter((preset) => preset.name.toLowerCase().includes(keyword))
  }, [presets, query])

  const templateComplete = selected
    ? selected.templateValues.every((item) => {
      const value = templateValues[item.key] ?? item.defaultValue ?? ""
      return value.trim().length > 0
    })
    : false

  const handleSubmit = () => {
    if (!selected || !templateComplete || saving) return
    void onSubmit({
      presetName: selected.name,
      apiKey: optionalTrimmed(apiKey),
      templateValues,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>从预设添加</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor="provider-preset-search">搜索</FieldLabel>
              <div className="flex items-center gap-2">
                <Search data-icon="inline-start" />
                <Input
                  id="provider-preset-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </Field>
            <div className="max-h-80 overflow-auto">
              <Table>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell className="text-muted-foreground">正在加载</TableCell>
                    </TableRow>
                  ) : visiblePresets.length === 0 ? (
                    <TableRow>
                      <TableCell className="text-muted-foreground">暂无预设</TableCell>
                    </TableRow>
                  ) : visiblePresets.map((preset) => (
                    <TableRow key={preset.name}>
                      <TableCell>
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="truncate font-medium">{preset.name}</span>
                          <span className="truncate text-xs text-muted-foreground">{preset.baseUrl ?? preset.model ?? "-"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant={selected?.name === preset.name ? "secondary" : "outline"}
                          size="sm"
                          onClick={() => {
                            setSelected(preset)
                            setTemplateValues(Object.fromEntries(
                              preset.templateValues.map((item) => [item.key, item.defaultValue ?? ""]),
                            ))
                          }}
                        >
                          {selected?.name === preset.name ? "已选择" : `选择 ${preset.name}`}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="provider-preset-api-key">API Key</FieldLabel>
              <Input
                id="provider-preset-api-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                disabled={!selected}
              />
            </Field>
            {selected?.templateValues.map((item) => (
              <Field key={item.key}>
                <FieldLabel htmlFor={`provider-preset-template-${item.key}`}>{item.label}</FieldLabel>
                <Input
                  id={`provider-preset-template-${item.key}`}
                  type={item.sensitive ? "password" : "text"}
                  value={templateValues[item.key] ?? item.defaultValue ?? ""}
                  placeholder={item.placeholder}
                  onChange={(event) => setTemplateValues({
                    ...templateValues,
                    [item.key]: event.target.value,
                  })}
                />
              </Field>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={!selected || !templateComplete || saving} onClick={handleSubmit}>
            添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProviderFormDialog({
  open,
  mode,
  values,
  saving,
  onValuesChange,
  onOpenChange,
  onSubmit,
}: {
  readonly open: boolean
  readonly mode: "create" | "edit"
  readonly values: ProviderFormValues
  readonly saving: boolean
  readonly onValuesChange: (values: ProviderFormValues) => void
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: (event: FormEvent) => void
}) {
  const setValue = <K extends keyof ProviderFormValues>(key: K, value: ProviderFormValues[K]) => {
    onValuesChange({ ...values, [key]: value })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" aria-describedby={undefined}>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "添加 Provider" : "编辑 Provider"}</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="provider-id">ID</FieldLabel>
                <Input
                  id="provider-id"
                  value={values.id}
                  disabled={mode === "edit"}
                  required
                  onChange={(event) => setValue("id", event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="provider-name">名称</FieldLabel>
                <Input
                  id="provider-name"
                  value={values.name}
                  required
                  onChange={(event) => setValue("name", event.target.value)}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>类型</FieldLabel>
                <Select
                  value={values.category}
                  onValueChange={(value) => setValue("category", value as SynapseAgentProviderCategory)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {PROVIDER_CATEGORIES.map((category) => (
                        <SelectItem key={category.value} value={category.value}>
                          {category.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Key 字段</FieldLabel>
                <Select
                  value={values.apiKeyField}
                  onValueChange={(value) => setValue("apiKeyField", value as SynapseAgentProviderApiKeyField)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {API_KEY_FIELDS.map((field) => (
                        <SelectItem key={field} value={field}>
                          {field}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="provider-base-url">Base URL</FieldLabel>
              <Input
                id="provider-base-url"
                value={values.baseUrl}
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
                placeholder={mode === "edit" ? "保持不变" : undefined}
                onChange={(event) => setValue("apiKey", event.target.value)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="provider-model">默认模型</FieldLabel>
                <Input
                  id="provider-model"
                  value={values.model}
                  onChange={(event) => setValue("model", event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="provider-sort-index">排序</FieldLabel>
                <Input
                  id="provider-sort-index"
                  type="number"
                  value={values.sortIndex}
                  onChange={(event) => setValue("sortIndex", event.target.value)}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="provider-haiku-model">Haiku</FieldLabel>
                <Input
                  id="provider-haiku-model"
                  value={values.haikuModel}
                  onChange={(event) => setValue("haikuModel", event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="provider-sonnet-model">Sonnet</FieldLabel>
                <Input
                  id="provider-sonnet-model"
                  value={values.sonnetModel}
                  onChange={(event) => setValue("sonnetModel", event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="provider-opus-model">Opus</FieldLabel>
                <Input
                  id="provider-opus-model"
                  value={values.opusModel}
                  onChange={(event) => setValue("opusModel", event.target.value)}
                />
              </Field>
            </div>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={saving || !values.id.trim() || !values.name.trim()}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function emptyProviderForm(): ProviderFormValues {
  return {
    id: "",
    name: "",
    category: "official",
    baseUrl: "",
    apiKeyField: "ANTHROPIC_API_KEY",
    apiKey: "",
    active: false,
    model: "",
    haikuModel: "",
    sonnetModel: "",
    opusModel: "",
    sortIndex: "",
  }
}

function formFromProvider(provider: SynapseAgentProvider): ProviderFormValues {
  return {
    id: provider.id,
    name: provider.name,
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
  }
}

function buildCreateInput(values: ProviderFormValues): SynapseCreateAgentProviderInput {
  return {
    id: values.id.trim(),
    name: values.name.trim(),
    category: values.category,
    baseUrl: optionalTrimmed(values.baseUrl),
    apiKeyField: values.apiKeyField,
    apiKey: optionalTrimmed(values.apiKey),
    active: values.active,
    model: optionalTrimmed(values.model),
    haikuModel: optionalTrimmed(values.haikuModel),
    sonnetModel: optionalTrimmed(values.sonnetModel),
    opusModel: optionalTrimmed(values.opusModel),
    sortIndex: optionalNumber(values.sortIndex),
  }
}

function buildUpdateInput(values: ProviderFormValues): SynapseUpdateAgentProviderInput {
  const apiKey = optionalTrimmed(values.apiKey)
  return {
    name: values.name.trim(),
    category: values.category,
    baseUrl: optionalTrimmed(values.baseUrl),
    apiKeyField: values.apiKeyField,
    active: values.active,
    model: optionalTrimmed(values.model),
    haikuModel: optionalTrimmed(values.haikuModel),
    sonnetModel: optionalTrimmed(values.sonnetModel),
    opusModel: optionalTrimmed(values.opusModel),
    sortIndex: optionalNumber(values.sortIndex),
    ...(apiKey ? { apiKey } : {}),
  }
}

function optionalTrimmed(value: string): string | undefined {
  const trimmed = value.trim()
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

export { ProviderPanel, ProviderPanelView }
