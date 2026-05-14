import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDownIcon, Plus } from "lucide-react"
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
import { ProviderPresetPickerDialog, type ProviderPresetOption } from "./provider-preset-picker-dialog"
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

const CUSTOM_PROVIDER_PRESET_ID = "custom"

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
  readonly onEdit: (provider: SynapseAgentProvider) => void
  readonly onArchive: (provider: SynapseAgentProvider) => void
  readonly onSetActive: (provider: SynapseAgentProvider) => void
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
  const [formOpen, setFormOpen] = useState(false)
  const [providerPresets, setProviderPresets] = useState<SynapseAgentProviderPreset[]>([])
  const [providerPresetsLoading, setProviderPresetsLoading] = useState(false)
  const [saving, setSaving] = useState(false)
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

  const openAddDialog = useCallback(() => {
    setEditingProvider(null)
    setFormValues(emptyProviderForm())
    setFormOpen(true)
    void loadProviderPresets()
  }, [loadProviderPresets])

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
        onEdit={openEditDialog}
        onArchive={handleArchive}
        onSetActive={handleSetActive}
        onRetry={refresh}
      />
      <ProviderFormDialog
        open={formOpen}
        mode={editingProvider ? "edit" : "create"}
        providers={providers}
        presets={providerPresets}
        presetsLoading={providerPresetsLoading}
        values={formValues}
        saving={saving}
        onValuesChange={setFormValues}
        onOpenChange={setFormOpen}
        onSubmit={handleSubmit}
      />
    </>
  )
}

function ProviderPanelView({
  providers,
  loading,
  error,
  onAdd,
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
        <Button type="button" size="sm" onClick={onAdd}>
          <Plus data-icon="inline-start" />
          添加
        </Button>
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

function ProviderFormDialog({
  open,
  mode,
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
    () => new Set(providers.map((provider) => provider.id)),
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

  const setValue = <K extends keyof ProviderFormValues>(key: K, value: ProviderFormValues[K]) => {
    onValuesChange({ ...values, [key]: value })
  }

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
    onValuesChange(formFromPreset(pendingPresetSelection.preset, existingProviderIds, defaults))
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
        <DialogContent className="sm:max-w-xl" aria-describedby={undefined}>
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>{mode === "create" ? "添加 Provider" : "编辑 Provider"}</DialogTitle>
            </DialogHeader>
            <FieldGroup>
              {mode === "create" ? (
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
            {mode === "create" && selectedPreset && selectedPreset.templateValues.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {selectedPreset.templateValues.map((item) => (
                  <Field key={item.key}>
                    <FieldLabel htmlFor={`provider-template-${item.key}`}>{item.label}</FieldLabel>
                    <Input
                      id={`provider-template-${item.key}`}
                      type={item.sensitive ? "password" : "text"}
                      value={templateValues[item.key] ?? item.defaultValue ?? ""}
                      placeholder={item.placeholder}
                      onChange={(event) => updateTemplateValue(item.key, event.target.value)}
                    />
                  </Field>
                ))}
              </div>
            ) : null}
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

function formFromPreset(
  preset: SynapseAgentProviderPreset,
  existingIds: ReadonlySet<string>,
  templateValues: Record<string, string>,
  previousValues: ProviderFormValues = emptyProviderForm(),
): ProviderFormValues {
  return {
    ...emptyProviderForm(),
    apiKey: previousValues.apiKey,
    active: previousValues.active,
    sortIndex: previousValues.sortIndex,
    id: providerIdFromPresetName(preset.name, existingIds),
    name: preset.name,
    category: preset.category,
    baseUrl: applyTemplateValues(preset.baseUrl, templateValues) ?? "",
    apiKeyField: preset.apiKeyField,
    model: applyTemplateValues(preset.model, templateValues) ?? "",
    haikuModel: applyTemplateValues(preset.haikuModel, templateValues) ?? "",
    sonnetModel: applyTemplateValues(preset.sonnetModel, templateValues) ?? "",
    opusModel: applyTemplateValues(preset.opusModel, templateValues) ?? "",
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
