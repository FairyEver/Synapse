import { useCallback, useEffect, useMemo, useState } from "react"
import { LockKeyhole } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldContent, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  pickInitialProviderModelSelection,
  ProviderModelPicker,
} from "@/components/provider-model-picker"
import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { resolveProviderModelDisplay } from "@/lib/provider-model"
import type { SynapseAgentPersona } from "@/types/agent-persona"
import type { SynapseAgentProvider } from "@/types/bridge"
import type { ProviderModelSelection } from "@/types/provider-model"

const ORDINARY_PERSONA_VALUE = "__ordinary__"
const logger = createRendererLogger("agent")

type AgentSessionCreateInput = {
  readonly name: string
  readonly personaId: string | null
  readonly selection: ProviderModelSelection
}

type AgentSessionCreateDialogProps = {
  readonly open: boolean
  readonly initialName: string
  readonly personas: readonly SynapseAgentPersona[]
  readonly defaultSelection?: ProviderModelSelection
  readonly onOpenChange: (open: boolean) => void
  readonly onCreate: (input: AgentSessionCreateInput) => Promise<boolean>
}

function AgentSessionCreateDialog({
  open,
  initialName,
  personas,
  defaultSelection,
  onOpenChange,
  onCreate,
}: AgentSessionCreateDialogProps) {
  const [name, setName] = useState(initialName)
  const [personaId, setPersonaId] = useState<string | null>(null)
  const [manualSelection, setManualSelection] = useState<ProviderModelSelection | null>(defaultSelection ?? null)
  const [providers, setProviders] = useState<readonly SynapseAgentProvider[] | null>(null)
  const [providersLoading, setProvidersLoading] = useState(false)
  const [providersError, setProvidersError] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadProviders = useCallback(async () => {
    setProvidersLoading(true)
    setProvidersError(false)
    try {
      const nextProviders = await requireSynapseBridge().agent.listAllProviders()
      setProviders(nextProviders)
      setManualSelection((current) =>
        pickInitialProviderModelSelection(nextProviders, current ?? defaultSelection) ?? null)
    } catch (rawError) {
      logger.warn("Agent session model list failed.", {
        boundary: "renderer.agent.session-create-model-list",
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessageLength(rawError),
      })
      setProviders(null)
      setProvidersError(true)
    } finally {
      setProvidersLoading(false)
    }
  }, [defaultSelection])

  useEffect(() => {
    if (!open) return
    setName(initialName)
    setPersonaId(null)
    setManualSelection(defaultSelection ?? null)
    setSaving(false)
    void loadProviders()
  }, [defaultSelection, initialName, loadProviders, open])

  useEffect(() => {
    if (!personaId || personas.some((persona) => persona.id === personaId)) return
    setPersonaId(null)
  }, [personaId, personas])

  const selectedPersona = personas.find((persona) => persona.id === personaId)
  const effectiveSelection = selectedPersona?.providerModel ?? manualSelection
  const effectiveModelDisplay = effectiveSelection
    ? resolveProviderModelDisplay(effectiveSelection, providers)
    : null
  const boundModelUnavailable = Boolean(
    selectedPersona?.providerModel
    && !providersLoading
    && !providersError
    && effectiveModelDisplay
    && effectiveModelDisplay.status !== "available",
  )
  const canCreate = Boolean(
    name.trim()
    && effectiveSelection
    && !providersLoading
    && !providersError
    && !boundModelUnavailable
    && !saving,
  )
  const builtinPersonas = useMemo(
    () => personas.filter((persona) => persona.source === "builtin"),
    [personas],
  )
  const userPersonas = useMemo(
    () => personas.filter((persona) => persona.source === "user"),
    [personas],
  )

  const handleCreate = async () => {
    if (!canCreate || !effectiveSelection) return
    setSaving(true)
    try {
      const created = await onCreate({
        name: name.trim(),
        personaId,
        selection: effectiveSelection,
      })
      if (created) onOpenChange(false)
    } catch (rawError) {
      logger.warn("Agent session creation failed.", {
        boundary: "renderer.agent.session-create",
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessageLength(rawError),
      })
    } finally {
      setSaving(false)
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (saving && !nextOpen) return
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100vh-3rem)] sm:max-w-xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>新建对话</DialogTitle>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="agent-session-name">名称</FieldLabel>
              <FieldContent>
                <Input
                  id="agent-session-name"
                  aria-label="会话名称"
                  value={name}
                  disabled={saving}
                  autoFocus
                  onChange={(event) => setName(event.target.value)}
                />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel htmlFor="agent-session-persona">智能体</FieldLabel>
              <FieldContent>
                <Select
                  value={personaId ?? ORDINARY_PERSONA_VALUE}
                  disabled={saving}
                  onValueChange={(value) => setPersonaId(value === ORDINARY_PERSONA_VALUE ? null : value)}
                >
                  <SelectTrigger id="agent-session-persona" className="w-full">
                    <SelectValue>{selectedPersona?.name ?? "普通"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start" className="w-(--radix-select-trigger-width)">
                    <SelectGroup>
                      <SelectItem value={ORDINARY_PERSONA_VALUE}>普通</SelectItem>
                    </SelectGroup>
                    <PersonaSelectGroup label="系统内置" personas={builtinPersonas} providers={providers} />
                    <PersonaSelectGroup label="我的" personas={userPersonas} providers={providers} />
                  </SelectContent>
                </Select>
                {selectedPersona ? (
                  <p className="truncate text-xs text-muted-foreground">{selectedPersona.description}</p>
                ) : null}
              </FieldContent>
            </Field>
          </div>
          <Field>
            <FieldLabel>模型</FieldLabel>
            <FieldContent>
              <div hidden={Boolean(selectedPersona?.providerModel)}>
                <ProviderModelPicker
                  providers={providers ?? []}
                  value={manualSelection}
                  loading={providersLoading}
                  error={providersError ? "读取 Provider 失败" : null}
                  disabled={saving}
                  onRetry={() => void loadProviders()}
                  onValueChange={setManualSelection}
                  className="max-h-[min(20rem,calc(100vh-16rem))]"
                />
              </div>
              {selectedPersona?.providerModel ? (
                <div className="flex h-8 min-w-0 items-center gap-2 rounded-lg border px-2.5 text-sm">
                  <LockKeyhole className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {effectiveModelDisplay?.label ?? selectedPersona.providerModel.providerId}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">智能体绑定</span>
                </div>
              ) : null}
              {selectedPersona?.providerModel && providersError ? (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-destructive">读取 Provider 失败</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => void loadProviders()}>
                    重试
                  </Button>
                </div>
              ) : selectedPersona?.providerModel && boundModelUnavailable ? (
                <p className="text-xs text-destructive">模型不可用</p>
              ) : selectedPersona?.providerModel && providersLoading ? (
                <p className="text-xs text-muted-foreground">正在加载模型</p>
              ) : null}
            </FieldContent>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={!canCreate} onClick={() => void handleCreate()}>
            {saving ? "正在创建" : "创建对话"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PersonaSelectGroup({
  label,
  personas,
  providers,
}: {
  readonly label: string
  readonly personas: readonly SynapseAgentPersona[]
  readonly providers: readonly SynapseAgentProvider[] | null
}) {
  if (personas.length === 0) return null
  return (
    <SelectGroup>
      <SelectLabel>{label}</SelectLabel>
      {personas.map((persona) => {
        const model = persona.providerModel
          ? resolveProviderModelDisplay(persona.providerModel, providers)
          : null
        return (
          <SelectItem
            key={persona.id}
            value={persona.id}
            disabled={Boolean(model && model.status !== "available")}
            className="py-1.5"
          >
            <span className="flex min-w-0 flex-col items-start gap-0">
              <span className="max-w-80 truncate">{persona.name}</span>
              <span className="max-w-80 truncate text-xs text-muted-foreground">
                {persona.description}
              </span>
              <span className="max-w-80 truncate text-xs text-muted-foreground">
                {model?.label ?? "未绑定"}
              </span>
            </span>
          </SelectItem>
        )
      })}
    </SelectGroup>
  )
}

export { AgentSessionCreateDialog }
export type { AgentSessionCreateDialogProps, AgentSessionCreateInput }

function errorMessageLength(error: unknown): number {
  return (error instanceof Error ? error.message : String(error)).length
}
