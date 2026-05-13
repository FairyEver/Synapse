import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { useAppConfig } from "@/app-shell/config"
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
  SynapseAgentProviderCategory,
  SynapseCreateAgentProviderInput,
  SynapseUpdateAgentProviderInput,
} from "@/types/bridge"

const logger = createRendererLogger("settings.providers")

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
  readonly projectId?: string
  readonly projectName?: string
  readonly providers: SynapseAgentProvider[]
  readonly loading: boolean
  readonly error: string | null
  readonly onAdd: () => void
  readonly onEdit: (provider: SynapseAgentProvider) => void
  readonly onArchive: (provider: SynapseAgentProvider) => void
  readonly onSetActive: (provider: SynapseAgentProvider) => void
  readonly onRetry: () => void
}

function ProviderPanel() {
  const { config } = useAppConfig()
  const project = config.global.projects[0]
  const [providers, setProviders] = useState<SynapseAgentProvider[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingProvider, setEditingProvider] = useState<SynapseAgentProvider | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formValues, setFormValues] = useState<ProviderFormValues>(() => emptyProviderForm())

  const refresh = useCallback(async () => {
    if (!project?.id) {
      setProviders([])
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const nextProviders = await requireSynapseBridge().agent.listProviders(project.id)
      setProviders(nextProviders)
    } catch (rawError) {
      const message = rawError instanceof Error ? rawError.message : "读取 Provider 失败"
      logger.error("Provider list failed.", rawError)
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [project?.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openAddDialog = useCallback(() => {
    setEditingProvider(null)
    setFormValues(emptyProviderForm())
    setFormOpen(true)
  }, [])

  const openEditDialog = useCallback((provider: SynapseAgentProvider) => {
    setEditingProvider(provider)
    setFormValues(formFromProvider(provider))
    setFormOpen(true)
  }, [])

  const handleSubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    if (!project?.id) return
    setSaving(true)
    try {
      if (editingProvider) {
        await requireSynapseBridge().agent.updateProvider({
          projectId: project.id,
          providerId: editingProvider.id,
          patch: buildUpdateInput(formValues),
        })
      } else {
        await requireSynapseBridge().agent.createProvider({
          projectId: project.id,
          provider: buildCreateInput(formValues),
        })
      }
      setFormOpen(false)
      await refresh()
      toast("Provider 已保存")
    } catch (rawError) {
      const message = rawError instanceof Error ? rawError.message : "保存 Provider 失败"
      logger.error("Provider save failed.", rawError)
      toast(message)
    } finally {
      setSaving(false)
    }
  }, [editingProvider, formValues, project?.id, refresh])

  const handleArchive = useCallback(async (provider: SynapseAgentProvider) => {
    if (!project?.id) return
    try {
      await requireSynapseBridge().agent.archiveProvider({
        projectId: project.id,
        providerId: provider.id,
      })
      await refresh()
      toast("Provider 已归档")
    } catch (rawError) {
      const message = rawError instanceof Error ? rawError.message : "归档失败"
      logger.error("Provider archive failed.", rawError)
      toast(message)
    }
  }, [project?.id, refresh])

  const handleSetActive = useCallback(async (provider: SynapseAgentProvider) => {
    if (!project?.id) return
    try {
      await requireSynapseBridge().agent.setActiveProvider({
        projectId: project.id,
        providerId: provider.id,
      })
      await refresh()
      toast("已设为默认")
    } catch (rawError) {
      const message = rawError instanceof Error ? rawError.message : "切换失败"
      logger.error("Provider activate failed.", rawError)
      toast(message)
    }
  }, [project?.id, refresh])

  return (
    <>
      <ProviderPanelView
        projectId={project?.id}
        projectName={project?.name}
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
  projectId,
  projectName,
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
          {projectName ? <Badge variant="secondary">{projectName}</Badge> : null}
        </div>
        <Button type="button" size="sm" disabled={!projectId} onClick={onAdd}>
          <Plus data-icon="inline-start" />
          添加
        </Button>
      </CardHeader>
      <CardContent>
        {!projectId ? (
          <p className="text-sm text-muted-foreground">请先添加项目</p>
        ) : error ? (
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
                      {provider.active ? <Badge variant="secondary">默认</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell>{provider.model || "-"}</TableCell>
                  <TableCell>{provider.apiKeyField}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => onEdit(provider)}>
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
                      <Button type="button" variant="ghost" size="sm" onClick={() => onArchive(provider)}>
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

export { ProviderPanel, ProviderPanelView }
