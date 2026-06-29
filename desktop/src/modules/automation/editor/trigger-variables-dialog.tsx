import { useMemo, useState } from "react"
import { Copy } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFrame,
  DialogFrameBody,
  DialogFrameHeader,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import type { AutomationTriggerVariableDescriptor } from "../../../../automation-trigger-packages/types.shared"

type TriggerVariablesDialogProps = {
  readonly triggerTitle: string
  readonly variables: readonly AutomationTriggerVariableDescriptor[]
}

type VariableGroupId = NonNullable<AutomationTriggerVariableDescriptor["group"]> | "other"
type GroupFilter = VariableGroupId | "all"
type CopyStatus = "success" | "error"

const GROUP_ORDER: readonly VariableGroupId[] = ["trigger", "config", "event", "other"]
const GROUP_LABELS: Record<VariableGroupId, string> = {
  trigger: "触发信息",
  config: "触发器配置",
  event: "事件内容",
  other: "其它",
}

function groupFor(variable: AutomationTriggerVariableDescriptor): VariableGroupId {
  return variable.group ?? "other"
}

function templateFor(key: string): string {
  return `{{${key}}}`
}

function dynamicTemplateFor(key: string, suffix: string): string {
  const path = suffix.trim().replace(/^\.+/u, "")
  return path ? templateFor(`${key}.${path}`) : templateFor(`${key}.<path>`)
}

function matchesSearch(variable: AutomationTriggerVariableDescriptor, search: string): boolean {
  if (!search) return true
  const target = [
    variable.key,
    variable.label,
    variable.description ?? "",
    variable.example ?? "",
  ].join(" ").toLowerCase()
  return target.includes(search)
}

export function TriggerVariablesDialog({
  triggerTitle,
  variables,
}: TriggerVariablesDialogProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all")
  const [dynamicPaths, setDynamicPaths] = useState<Record<string, string>>({})
  const [copyState, setCopyState] = useState<{ readonly template: string; readonly status: CopyStatus } | null>(null)

  const groups = useMemo(() => {
    return GROUP_ORDER
      .map((id) => ({
        id,
        label: GROUP_LABELS[id],
        variables: variables.filter((variable) => groupFor(variable) === id),
      }))
      .filter((group) => group.variables.length > 0)
  }, [variables])

  const filteredGroups = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    return groups
      .filter((group) => groupFilter === "all" || group.id === groupFilter)
      .map((group) => ({
        ...group,
        variables: group.variables.filter((variable) => matchesSearch(variable, normalizedSearch)),
      }))
      .filter((group) => group.variables.length > 0)
  }, [groups, groupFilter, search])

  if (variables.length === 0) return null

  async function copyTemplate(template: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable")
      await navigator.clipboard.writeText(template)
      setCopyState({ template, status: "success" })
    } catch {
      setCopyState({ template, status: "error" })
    }
  }

  function statusLabel(template: string): string | null {
    if (copyState?.template !== template) return null
    return copyState.status === "success" ? "已复制" : "复制失败"
  }

  return (
    <Dialog data-track="automation-trigger-variables-dialog" open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          变量
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined} className="max-h-[calc(100vh-4rem)] overflow-hidden p-0 sm:max-w-4xl" showCloseButton={false}>
        <DialogFrame className="max-h-[calc(100vh-4rem)]">
          <DialogFrameHeader title={`${triggerTitle} 变量`} />
          <DialogFrameBody className="px-5 py-4">
            <div className="grid min-h-0 gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
              <div className="flex min-h-0 flex-col gap-2">
                <Button
                  type="button"
                  variant={groupFilter === "all" ? "secondary" : "ghost"}
                  className="justify-between"
                  onClick={() => setGroupFilter("all")}
                >
                  全部
                  <Badge variant="secondary">{variables.length}</Badge>
                </Button>
                {groups.map((group) => (
              <Button
                key={group.id}
                type="button"
                variant={groupFilter === group.id ? "secondary" : "ghost"}
                className="justify-between"
                onClick={() => setGroupFilter(group.id)}
              >
                {group.label}
                <Badge variant="secondary">{group.variables.length}</Badge>
              </Button>
                ))}
              </div>

              <div className="flex min-h-0 min-w-0 flex-col gap-3">
                <Input
                  aria-label="搜索变量"
                  placeholder="搜索变量"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <ScrollArea className="min-h-0 flex-1 rounded-lg border border-border">
                  <div className="flex max-h-[60vh] min-w-0 flex-col gap-4 p-3">
                    {filteredGroups.length > 0 ? filteredGroups.map((group, groupIndex) => (
                      <section key={group.id} className="min-w-0">
                        {groupIndex > 0 ? <Separator className="mb-3" /> : null}
                        <div className="mb-2 flex items-center gap-2">
                          <h3 className="text-sm font-medium">{group.label}</h3>
                        </div>
                        <div className="grid min-w-0 divide-y divide-border">
                          {group.variables.map((variable) => (
                            variable.dynamic ? (
                              <DynamicVariableRow
                                key={variable.key}
                                variable={variable}
                                path={dynamicPaths[variable.key] ?? ""}
                                statusLabel={statusLabel}
                                onPathChange={(path) => {
                                  setDynamicPaths((current) => ({ ...current, [variable.key]: path }))
                                }}
                                onCopy={copyTemplate}
                              />
                            ) : (
                              <StaticVariableRow
                                key={variable.key}
                                variable={variable}
                                statusLabel={statusLabel(templateFor(variable.key))}
                                onCopy={() => void copyTemplate(templateFor(variable.key))}
                              />
                            )
                          ))}
                        </div>
                      </section>
                    )) : (
                      <p className="py-8 text-center text-sm text-muted-foreground">没有匹配变量</p>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          </DialogFrameBody>
        </DialogFrame>
      </DialogContent>
    </Dialog>
  )
}

function StaticVariableRow({
  variable,
  statusLabel,
  onCopy,
}: {
  readonly variable: AutomationTriggerVariableDescriptor
  readonly statusLabel: string | null
  readonly onCopy: () => void
}) {
  return (
    <button
      type="button"
      aria-label={`复制 ${templateFor(variable.key)}`}
      className="flex min-w-0 items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onCopy}
    >
      <VariableText variable={variable} template={templateFor(variable.key)} />
      <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
        <CopyStatusLabel statusLabel={statusLabel} />
        <Copy aria-hidden="true" className="size-4" />
        <span className="sr-only">复制</span>
      </span>
    </button>
  )
}

function DynamicVariableRow({
  variable,
  path,
  statusLabel,
  onPathChange,
  onCopy,
}: {
  readonly variable: AutomationTriggerVariableDescriptor
  readonly path: string
  readonly statusLabel: (template: string) => string | null
  readonly onPathChange: (path: string) => void
  readonly onCopy: (template: string) => void
}) {
  const template = dynamicTemplateFor(variable.key, path)
  const canCopy = path.trim().length > 0

  return (
    <div className="grid min-w-0 gap-2 px-3 py-2">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <VariableText variable={variable} template={template} dynamic />
        <CopyStatusLabel statusLabel={statusLabel(template)} />
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <Input
          aria-label={`${variable.label} 路径`}
          placeholder="字段路径"
          value={path}
          onChange={(event) => onPathChange(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canCopy}
          onClick={() => onCopy(template)}
        >
          <Copy data-icon="inline-start" />
          复制
        </Button>
      </div>
    </div>
  )
}

function VariableText({
  variable,
  template,
  dynamic = false,
}: {
  readonly variable: AutomationTriggerVariableDescriptor
  readonly template: string
  readonly dynamic?: boolean
}) {
  return (
    <span className="grid min-w-0 gap-1">
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{variable.label}</span>
        {dynamic ? <Badge variant="outline">动态路径</Badge> : null}
      </span>
      <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">{template}</span>
      {variable.example ? (
        <span className="min-w-0 break-all text-xs text-muted-foreground">{variable.example}</span>
      ) : null}
    </span>
  )
}

function CopyStatusLabel({
  statusLabel,
}: {
  readonly statusLabel: string | null
}) {
  if (!statusLabel) return null
  return <span className="shrink-0 text-xs text-muted-foreground">{statusLabel}</span>
}
