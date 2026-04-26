import { useMemo, useState } from "react"
import { Download, Pencil, Plus, Trash2 } from "lucide-react"
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
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  convertCCSwitchProvider,
  createProviderDraft,
  normalizeProviderName,
  removeProviderRefsFromProjects,
} from "@/lib/provider-model"
import type { SynapseProjectConfig } from "@/types/config"
import type { SynapseProviderEntry, SynapseProviderModel } from "@/types/provider"

const logger = createRendererLogger("settings.providers")

const AGENT_TYPE_OPTIONS = [
  { value: "claudecode", label: "Claude Code" },
  { value: "codex", label: "Codex" },
] as const

const LOCAL_PROVIDER_PRESETS: SynapseProviderEntry[] = [
  createProviderDraft({
    name: "minimax",
    baseUrl: "https://api.minimax.io/anthropic",
    model: "MiniMax-M2",
    agentTypes: ["claudecode"],
  }).provider,
  createProviderDraft({
    name: "aihubmix",
    baseUrl: "https://aihubmix.com/v1",
    model: "claude-sonnet-4-5-20250929",
    agentTypes: ["claudecode"],
  }).provider,
]

type ProviderFormState = {
  name: string
  apiKey: string
  baseUrl: string
  model: string
  modelsText: string
  thinking: string
  agentTypes: string[]
  codexBaseUrl: string
  codexModel: string
  codexWireApi: string
}

type CCSwitchPreviewItem = {
  rowName: string
  appType: string
  provider: SynapseProviderEntry | null
  error: string | null
  duplicate: boolean
}

type ProviderSettingsPanelProps = {
  providers: SynapseProviderEntry[]
  projects: SynapseProjectConfig[]
  onSave: (providers: SynapseProviderEntry[], projects: SynapseProjectConfig[]) => Promise<boolean>
}

function createEmptyFormState(): ProviderFormState {
  return {
    name: "",
    apiKey: "",
    baseUrl: "",
    model: "",
    modelsText: "",
    thinking: "default",
    agentTypes: ["claudecode"],
    codexBaseUrl: "",
    codexModel: "",
    codexWireApi: "responses",
  }
}

function providerToFormState(provider: SynapseProviderEntry): ProviderFormState {
  return {
    name: provider.name,
    apiKey: "",
    baseUrl: provider.baseUrl ?? "",
    model: provider.model ?? "",
    modelsText: provider.models?.map((item) => item.alias ? `${item.model} | ${item.alias}` : item.model).join("\n") ?? "",
    thinking: provider.thinking ?? "default",
    agentTypes: provider.agentTypes?.length ? provider.agentTypes : ["claudecode"],
    codexBaseUrl: provider.endpoints?.codex ?? "",
    codexModel: provider.agentModels?.codex ?? "",
    codexWireApi: provider.codex?.wireApi ?? "responses",
  }
}

function parseModelList(value: string): SynapseProviderModel[] | undefined {
  const models = value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((line) => {
      const [model, alias] = line.split("|").map((item) => item.trim())

      return {
        model: model ?? "",
        ...(alias ? { alias } : undefined),
      }
    })
    .filter((item) => item.model.length > 0)

  return models.length > 0 ? models : undefined
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

function parseCCSwitchRows(input: string): unknown[] {
  const trimmed = input.trim()
  if (!trimmed) {
    return []
  }

  const parsed = JSON.parse(trimmed) as unknown
  return Array.isArray(parsed) ? parsed : [parsed]
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string") {
      return value
    }
  }

  return null
}

function createCCSwitchPreview(
  input: string,
  providers: readonly SynapseProviderEntry[],
): CCSwitchPreviewItem[] {
  const existingNames = new Set(providers.map((provider) => normalizeProviderName(provider.name)))

  return parseCCSwitchRows(input).map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return {
        rowName: "unknown",
        appType: "unknown",
        provider: null,
        error: "格式错误",
        duplicate: false,
      }
    }

    const record = row as Record<string, unknown>
    const rowName = readString(record, "name") ?? "unknown"
    const appType = readString(record, "app_type", "appType") ?? "unknown"
    const settingsConfigValue = record.settings_config ?? record.settingsConfig
    const settingsConfig = typeof settingsConfigValue === "string"
      ? settingsConfigValue
      : JSON.stringify(settingsConfigValue ?? {})

    try {
      const draft = convertCCSwitchProvider({
        name: rowName,
        appType,
        settingsConfig,
        isCurrent: Boolean(record.is_current ?? record.isCurrent),
      })
      const duplicate = existingNames.has(normalizeProviderName(draft.provider.name))

      return {
        rowName,
        appType,
        provider: draft.provider,
        error: null,
        duplicate,
      }
    } catch (error) {
      return {
        rowName,
        appType,
        provider: null,
        error: error instanceof Error ? error.message : "解析失败",
        duplicate: false,
      }
    }
  })
}

function providerStatus(provider: SynapseProviderEntry): string {
  return provider.secretRef ? "已保存密钥引用" : "未设置密钥"
}

function ProviderSettingsPanel({ providers, projects, onSave }: ProviderSettingsPanelProps) {
  const [formOpen, setFormOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<SynapseProviderEntry | null>(null)
  const [formState, setFormState] = useState<ProviderFormState>(createEmptyFormState)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SynapseProviderEntry | null>(null)
  const [ccSwitchOpen, setCCSwitchOpen] = useState(false)
  const [ccSwitchInput, setCCSwitchInput] = useState("")
  const [ccSwitchError, setCCSwitchError] = useState<string | null>(null)

  const ccSwitchResult = useMemo(() => {
    try {
      return {
        preview: createCCSwitchPreview(ccSwitchInput, providers),
        error: null,
      }
    } catch (error) {
      return {
        preview: [],
        error: error instanceof Error ? error.message : "JSON 解析失败",
      }
    }
  }, [ccSwitchInput, providers])

  const ccSwitchPreview = ccSwitchResult.preview
  const displayedCCSwitchError = ccSwitchError ?? ccSwitchResult.error
  const importablePreview = ccSwitchPreview.filter((item) => item.provider && !item.duplicate && !item.error)

  const openCreateForm = (preset?: SynapseProviderEntry) => {
    setEditingProvider(null)
    setFormState(preset ? providerToFormState(preset) : createEmptyFormState())
    setFormError(null)
    setFormOpen(true)
  }

  const openEditForm = (provider: SynapseProviderEntry) => {
    setEditingProvider(provider)
    setFormState(providerToFormState(provider))
    setFormError(null)
    setFormOpen(true)
  }

  const updateForm = (patch: Partial<ProviderFormState>) => {
    setFormState((current) => ({
      ...current,
      ...patch,
    }))
    setFormError(null)
  }

  const toggleAgentType = (value: string, checked: boolean) => {
    updateForm({
      agentTypes: checked
        ? Array.from(new Set([...formState.agentTypes, value]))
        : formState.agentTypes.filter((item) => item !== value),
    })
  }

  const saveProvider = async () => {
    const providerName = normalizeProviderName(formState.name)

    if (!providerName) {
      setFormError("名称不能为空。")
      return
    }

    if (!formState.agentTypes.length) {
      setFormError("至少选择一个 Agent。")
      return
    }

    const duplicate = providers.some(
      (provider) => provider.name === providerName && provider.id !== editingProvider?.id,
    )
    if (duplicate) {
      setFormError("名称已存在。")
      return
    }

    const endpoints = formState.codexBaseUrl.trim()
      ? { codex: formState.codexBaseUrl.trim() }
      : undefined
    const agentModels = formState.codexModel.trim()
      ? { codex: formState.codexModel.trim() }
      : undefined
    const codex = formState.agentTypes.includes("codex")
      ? { wireApi: formState.codexWireApi.trim() || "responses" }
      : undefined

    const draft = createProviderDraft({
      name: formState.name,
      apiKey: formState.apiKey,
      baseUrl: formState.baseUrl,
      model: formState.model,
      models: parseModelList(formState.modelsText),
      thinking: formState.thinking === "default" ? undefined : formState.thinking,
      agentTypes: formState.agentTypes,
      endpoints,
      agentModels,
      codex,
    })
    const nextProvider: SynapseProviderEntry = {
      ...draft.provider,
      ...(editingProvider && !formState.apiKey.trim() && editingProvider.secretRef
        ? { secretRef: editingProvider.secretRef }
        : undefined),
    }
    const nextProviders = editingProvider
      ? providers.map((provider) => provider.id === editingProvider.id ? nextProvider : provider)
      : [...providers, nextProvider]

    setIsSaving(true)
    try {
      const saved = await onSave(nextProviders, projects)
      if (saved) {
        logger.info("Provider saved.", { providerName: nextProvider.name })
        setFormOpen(false)
      }
    } catch (error) {
      logger.error("Failed to save provider.", { error, providerName })
      setFormError(error instanceof Error ? error.message : "保存失败。")
    } finally {
      setIsSaving(false)
    }
  }

  const deleteProvider = async () => {
    if (!deleteTarget) {
      return
    }

    const nextProviders = providers.filter((provider) => provider.id !== deleteTarget.id)
    const nextProjects = removeProviderRefsFromProjects(projects, deleteTarget.name)
    const saved = await onSave(nextProviders, nextProjects)

    if (saved) {
      logger.info("Provider removed.", { providerName: deleteTarget.name })
      setDeleteTarget(null)
    }
  }

  const importFromCCSwitch = async () => {
    if (!importablePreview.length) {
      setCCSwitchError("没有可导入的 Provider。")
      return
    }

    const importedProviders = importablePreview
      .map((item) => item.provider)
      .filter((provider): provider is SynapseProviderEntry => provider !== null)
    const saved = await onSave([...providers, ...importedProviders], projects)

    if (saved) {
      logger.info("CC-Switch providers imported.", { providerCount: importedProviders.length })
      setCCSwitchInput("")
      setCCSwitchOpen(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs defaultValue="providers" className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="providers">服务商</TabsTrigger>
            <TabsTrigger value="presets">预设</TabsTrigger>
          </TabsList>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setCCSwitchOpen(true)}>
              <Download />
              导入 CC-Switch
            </Button>
            <Button onClick={() => openCreateForm()}>
              <Plus />
              添加服务商
            </Button>
          </div>
        </div>

        <TabsContent value="providers" className="mt-0">
          {providers.length ? (
            <ProviderTable
              providers={providers}
              onEdit={openEditForm}
              onDelete={setDeleteTarget}
            />
          ) : (
            <Empty className="min-h-56 bg-background">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Plus />
                </EmptyMedia>
                <EmptyTitle>暂无服务商</EmptyTitle>
                <EmptyDescription>添加全局 Provider 后，项目可复用。</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => openCreateForm()}>
                  <Plus />
                  添加服务商
                </Button>
              </EmptyContent>
            </Empty>
          )}
        </TabsContent>
        <TabsContent value="presets" className="mt-0">
          <div className="overflow-hidden rounded-xl bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>模型</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead className="w-24 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {LOCAL_PROVIDER_PRESETS.map((preset) => (
                  <TableRow key={preset.id}>
                    <TableCell className="font-medium">{preset.name}</TableCell>
                    <TableCell>{preset.model ?? "-"}</TableCell>
                    <TableCell>
                      <AgentBadges agentTypes={preset.agentTypes} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openCreateForm(preset)}
                      >
                        预填
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <ProviderFormDialog
        formOpen={formOpen}
        formState={formState}
        formError={formError}
        isSaving={isSaving}
        isEditing={editingProvider !== null}
        onOpenChange={setFormOpen}
        onUpdate={updateForm}
        onToggleAgentType={toggleAgentType}
        onSave={() => void saveProvider()}
      />

      <CCSwitchImportDialog
        open={ccSwitchOpen}
        input={ccSwitchInput}
        error={displayedCCSwitchError}
        preview={ccSwitchPreview}
        importableCount={importablePreview.length}
        onOpenChange={setCCSwitchOpen}
        onInputChange={(nextInput) => {
          setCCSwitchInput(nextInput)
          setCCSwitchError(null)
        }}
        onImport={() => void importFromCCSwitch()}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除服务商</AlertDialogTitle>
            <AlertDialogDescription>
              项目中的同名引用会同步移除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteProvider()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

type ProviderTableProps = {
  providers: SynapseProviderEntry[]
  onEdit: (provider: SynapseProviderEntry) => void
  onDelete: (provider: SynapseProviderEntry) => void
}

function ProviderTable({ providers, onEdit, onDelete }: ProviderTableProps) {
  return (
    <div className="overflow-hidden rounded-xl bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>Base URL</TableHead>
            <TableHead>模型</TableHead>
            <TableHead>Agent</TableHead>
            <TableHead>密钥</TableHead>
            <TableHead className="w-28 text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {providers.map((provider) => (
            <TableRow key={provider.id}>
              <TableCell className="font-medium">{provider.name}</TableCell>
              <TableCell className="max-w-56 truncate">{provider.baseUrl ?? "-"}</TableCell>
              <TableCell>{provider.model ?? "-"}</TableCell>
              <TableCell>
                <AgentBadges agentTypes={provider.agentTypes} />
              </TableCell>
              <TableCell>{providerStatus(provider)}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onEdit(provider)}
                  >
                    <Pencil />
                    <span className="sr-only">编辑</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onDelete(provider)}
                  >
                    <Trash2 />
                    <span className="sr-only">删除</span>
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function AgentBadges({ agentTypes }: { agentTypes?: string[] }) {
  const values = agentTypes?.length ? agentTypes : ["all"]

  return (
    <div className="flex flex-wrap gap-1">
      {values.map((value) => (
        <Badge key={value} variant="secondary">
          {value}
        </Badge>
      ))}
    </div>
  )
}

type ProviderFormDialogProps = {
  formOpen: boolean
  formState: ProviderFormState
  formError: string | null
  isSaving: boolean
  isEditing: boolean
  onOpenChange: (open: boolean) => void
  onUpdate: (patch: Partial<ProviderFormState>) => void
  onToggleAgentType: (value: string, checked: boolean) => void
  onSave: () => void
}

function ProviderFormDialog({
  formOpen,
  formState,
  formError,
  isSaving,
  isEditing,
  onOpenChange,
  onUpdate,
  onToggleAgentType,
  onSave,
}: ProviderFormDialogProps) {
  return (
    <Dialog open={formOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? "编辑服务商" : "添加服务商"}</DialogTitle>
          {isEditing ? (
            <DialogDescription>留空 API Key 会保留现有密钥引用。</DialogDescription>
          ) : null}
        </DialogHeader>
        <FieldGroup className="gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="provider-name">名称</FieldLabel>
              <Input
                id="provider-name"
                value={formState.name}
                disabled={isSaving || isEditing}
                onChange={(event) => onUpdate({ name: event.target.value })}
                placeholder="minimax"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="provider-api-key">API Key</FieldLabel>
              <Input
                id="provider-api-key"
                type="password"
                value={formState.apiKey}
                disabled={isSaving}
                onChange={(event) => onUpdate({ apiKey: event.target.value })}
                placeholder="sk-..."
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="provider-base-url">Base URL</FieldLabel>
              <Input
                id="provider-base-url"
                value={formState.baseUrl}
                disabled={isSaving}
                onChange={(event) => onUpdate({ baseUrl: event.target.value })}
                placeholder="https://api.example.com"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="provider-model">默认模型</FieldLabel>
              <Input
                id="provider-model"
                value={formState.model}
                disabled={isSaving}
                onChange={(event) => onUpdate({ model: event.target.value })}
                placeholder="claude-sonnet-4-5"
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="provider-models">模型列表</FieldLabel>
            <Textarea
              id="provider-models"
              value={formState.modelsText}
              disabled={isSaving}
              onChange={(event) => onUpdate({ modelsText: event.target.value })}
              placeholder={`model-a\nmodel-b`}
              rows={3}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="provider-thinking">Thinking</FieldLabel>
              <NativeSelect
                id="provider-thinking"
                value={formState.thinking}
                disabled={isSaving}
                onChange={(event) => onUpdate({ thinking: event.target.value })}
              >
                <NativeSelectOption value="default">默认</NativeSelectOption>
                <NativeSelectOption value="enabled">开启</NativeSelectOption>
                <NativeSelectOption value="disabled">关闭</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel>Agent</FieldLabel>
              <div className="flex flex-wrap gap-3">
                {AGENT_TYPE_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={formState.agentTypes.includes(option.value)}
                      disabled={isSaving}
                      onCheckedChange={(checked) => onToggleAgentType(option.value, checked === true)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </Field>
          </div>

          {formState.agentTypes.includes("codex") ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="provider-codex-base-url">Codex URL</FieldLabel>
                <Input
                  id="provider-codex-base-url"
                  value={formState.codexBaseUrl}
                  disabled={isSaving}
                  onChange={(event) => onUpdate({ codexBaseUrl: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="provider-codex-model">Codex 模型</FieldLabel>
                <Input
                  id="provider-codex-model"
                  value={formState.codexModel}
                  disabled={isSaving}
                  onChange={(event) => onUpdate({ codexModel: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="provider-codex-wire-api">Wire API</FieldLabel>
                <NativeSelect
                  id="provider-codex-wire-api"
                  value={formState.codexWireApi}
                  disabled={isSaving}
                  onChange={(event) => onUpdate({ codexWireApi: event.target.value })}
                >
                  <NativeSelectOption value="responses">responses</NativeSelectOption>
                  <NativeSelectOption value="chat">chat</NativeSelectOption>
                </NativeSelect>
              </Field>
            </div>
          ) : null}

          <FieldError>{formError}</FieldError>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            取消
          </Button>
          <Button onClick={onSave} disabled={isSaving}>
            {isSaving ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type CCSwitchImportDialogProps = {
  open: boolean
  input: string
  error: string | null
  preview: CCSwitchPreviewItem[]
  importableCount: number
  onOpenChange: (open: boolean) => void
  onInputChange: (input: string) => void
  onImport: () => void
}

function CCSwitchImportDialog({
  open,
  input,
  error,
  preview,
  importableCount,
  onOpenChange,
  onInputChange,
  onImport,
}: CCSwitchImportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>导入 CC-Switch</DialogTitle>
          <DialogDescription>粘贴 providers 表导出的 JSON。</DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="cc-switch-json">JSON</FieldLabel>
            <Textarea
              id="cc-switch-json"
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              placeholder='[{"app_type":"claude","name":"minimax","settings_config":"{...}"}]'
              rows={8}
            />
          </Field>
          <FieldError>{error}</FieldError>
        </FieldGroup>

        {preview.length ? (
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.map((item, index) => (
                  <TableRow key={`${item.rowName}-${index}`}>
                    <TableCell>{item.provider?.name ?? item.rowName}</TableCell>
                    <TableCell>{item.appType}</TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "text-sm",
                          item.error ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {item.error ?? (item.duplicate ? "已存在" : "可导入")}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onImport} disabled={importableCount === 0}>
            导入 {importableCount}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { ProviderSettingsPanel }
