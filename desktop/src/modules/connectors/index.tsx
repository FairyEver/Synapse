import { AlertCircle, CheckCircle2, Clock, FolderKanban, Plug, Plus, QrCode, RefreshCw, Server, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useAppConfig } from "@/app-shell/config"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldError, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { SynapseProjectConfig, SynapseProjectPlatformConnection } from "@/types/config"
import {
  CC_CONNECT_AGENT_OPTIONS,
  DEFAULT_AGENT_TYPE,
  createCcConnectProjectDraft,
  createProjectPlatformConnectionFromConnector,
  createQrProjectPlatformDraft,
  sanitizeCcProjectName,
  summarizeCcConnectProjects,
  updateCcConnectProjectSettings,
  type ConnectorProjectSummary,
} from "./project-model"

type ProjectDraft = {
  name: string
  workDir: string
  agentType: string
}

type ConnectorsProjectViewProps = {
  projects: SynapseProjectConfig[]
  isReady: boolean
  error: string | null
  onCreateProject: (draft: ProjectDraft) => Promise<void>
  onUpdateProject: (projectId: string, project: SynapseProjectConfig) => Promise<void>
  onDeleteProject: (projectId: string) => Promise<void>
  onChooseDirectory?: () => Promise<string | null>
}

function ConnectorsModule() {
  const { config, error, isReady, updateConfig } = useAppConfig()

  const handleCreateProject = async (draft: ProjectDraft) => {
    const nextProject = createCcConnectProjectDraft({
      id: crypto.randomUUID(),
      name: draft.name,
      workDir: draft.workDir,
      agentType: draft.agentType,
    })

    await updateConfig({
      global: {
        projects: [...config.global.projects, nextProject],
        defaultProjectId: config.global.defaultProjectId ?? nextProject.id,
      },
    })
  }

  const handleUpdateProject = async (projectId: string, nextProject: SynapseProjectConfig) => {
    await updateConfig({
      global: {
        projects: config.global.projects.map((project) =>
          project.id === projectId ? nextProject : project
        ),
      },
    })
  }

  const handleDeleteProject = async (projectId: string) => {
    const nextProjects = config.global.projects.filter((project) => project.id !== projectId)
    await updateConfig({
      global: {
        projects: nextProjects,
        defaultProjectId: config.global.defaultProjectId === projectId
          ? nextProjects[0]?.id ?? null
          : config.global.defaultProjectId,
      },
    })
  }

  const handleChooseDirectory = async () => {
    return window.synapse?.repository.chooseDirectory() ?? null
  }

  return (
    <ConnectorsProjectView
      projects={config.global.projects}
      isReady={isReady}
      error={error}
      onCreateProject={handleCreateProject}
      onUpdateProject={handleUpdateProject}
      onDeleteProject={handleDeleteProject}
      onChooseDirectory={handleChooseDirectory}
    />
  )
}

function ConnectorsProjectView({
  projects,
  isReady,
  error,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onChooseDirectory,
}: ConnectorsProjectViewProps) {
  const projectSummaries = useMemo(() => summarizeCcConnectProjects(projects), [projects])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projectSummaries[0]?.id ?? null)
  const selectedProject = projectSummaries.find((project) => project.id === selectedProjectId)
    ?? projectSummaries[0]
    ?? null
  const platformCount = projectSummaries.reduce((total, project) => total + project.platformCount, 0)
  const agentCount = new Set(projectSummaries.map((project) => project.agentType).filter(Boolean)).size

  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto bg-muted/30 p-4" data-module="connectors">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">连接</h1>
          <p className="text-sm text-muted-foreground">项目和平台连接。</p>
        </div>
        <ProjectCreateDialog
          projects={projects}
          onCreateProject={onCreateProject}
          onCreated={(projectName) => {
            const created = projects.find((project) => project.name === projectName)
            if (created) {
              setSelectedProjectId(created.id)
            }
          }}
          onChooseDirectory={onChooseDirectory}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <OverviewCard label="项目" value={isReady ? String(projectSummaries.length) : "-"} />
        <OverviewCard label="平台" value={isReady ? String(platformCount) : "-"} />
        <OverviewCard label="Agent" value={isReady ? String(agentCount) : "-"} />
      </div>

      {error ? (
        <Card>
          <CardHeader>
            <CardTitle>加载失败</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : projectSummaries.length === 0 ? (
        <Card className="min-h-96">
          <CardHeader>
            <CardTitle>项目列表</CardTitle>
            <CardDescription>暂无项目</CardDescription>
          </CardHeader>
          <CardContent>
            <Empty className="min-h-64">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FolderKanban />
                </EmptyMedia>
                <EmptyTitle>暂无项目</EmptyTitle>
                <EmptyDescription>新建项目后配置平台连接。</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <ProjectCreateDialog
                  projects={projects}
                  onCreateProject={onCreateProject}
                  onChooseDirectory={onChooseDirectory}
                />
              </EmptyContent>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]">
          <Card className="min-h-96">
            <CardHeader>
              <CardTitle>项目列表</CardTitle>
              <CardDescription>{projectSummaries.length} 个项目</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {projectSummaries.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  isSelected={project.id === selectedProject?.id}
                  onSelect={() => setSelectedProjectId(project.id)}
                />
              ))}
            </CardContent>
          </Card>

          <ProjectDetailPanel
            project={selectedProject}
            sourceProject={projects.find((project) => project.id === selectedProject?.id) ?? null}
            onUpdateProject={onUpdateProject}
            onDeleteProject={onDeleteProject}
            onDeleted={() => setSelectedProjectId(null)}
          />
        </div>
      )}
    </section>
  )
}

function OverviewCard({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
    </Card>
  )
}

function ProjectCard({
  project,
  isSelected,
  onSelect,
}: {
  project: ConnectorProjectSummary
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className="rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      onClick={onSelect}
    >
      <Card className={isSelected ? "border-ring" : undefined} size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="size-4 text-muted-foreground" />
            <span className="min-w-0 truncate">{project.name}</span>
          </CardTitle>
          <CardDescription className="break-all">{project.workDir}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {project.agentType ? <Badge variant="outline">{project.agentType}</Badge> : null}
          <Badge variant="outline">{project.platformCount} 平台</Badge>
          <Badge variant="outline">会话待接入</Badge>
        </CardContent>
      </Card>
    </button>
  )
}

function ProjectDetailPanel({
  project,
  sourceProject,
  onUpdateProject,
  onDeleteProject,
  onDeleted,
}: {
  project: ConnectorProjectSummary | null
  sourceProject: SynapseProjectConfig | null
  onUpdateProject: (projectId: string, project: SynapseProjectConfig) => Promise<void>
  onDeleteProject: (projectId: string) => Promise<void>
  onDeleted: () => void
}) {
  const [settingsDraft, setSettingsDraft] = useState(() => createSettingsDraft(project))
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    setSettingsDraft(createSettingsDraft(project))
    setSettingsError(null)
  }, [project?.id])

  if (!project) {
    return null
  }

  const syncSettingsDraft = () => {
    setSettingsDraft(createSettingsDraft(project))
    setSettingsError(null)
  }

  const handleSaveSettings = async () => {
    if (!sourceProject) {
      return
    }

    if (!settingsDraft.workDir.trim()) {
      setSettingsError("工作目录不能为空。")
      return
    }

    setIsSaving(true)
    setSettingsError(null)

    try {
      await onUpdateProject(project.id, updateCcConnectProjectSettings(sourceProject, settingsDraft))
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "保存失败。")
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteProject = async () => {
    await onDeleteProject(project.id)
    onDeleted()
  }

  const handleAddPlatformConnection = async (connection: SynapseProjectPlatformConnection) => {
    if (!sourceProject) {
      return
    }

    await onUpdateProject(project.id, {
      ...sourceProject,
      platformConnections: [...(sourceProject.platformConnections ?? []), connection],
    })
  }

  return (
    <Card className="min-h-96">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="size-4" />
          项目详情
        </CardTitle>
        <CardDescription>{project.name}</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">概览</TabsTrigger>
            <TabsTrigger value="platforms">平台</TabsTrigger>
            <TabsTrigger value="providers">服务商</TabsTrigger>
            <TabsTrigger value="heartbeat">Heartbeat</TabsTrigger>
            <TabsTrigger value="settings">设置</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <div className="grid gap-4 md:grid-cols-2">
              <DetailItem label="Agent" value={project.agentType ?? "未设置"} />
              <DetailItem label="平台" value={`${project.platformCount} 个`} />
              <DetailItem label="工作目录" value={project.workDir} />
              <DetailItem label="会话" value="待接入" />
            </div>
            {sourceProject ? (
              <div className="mt-4">
                <PlatformConnectionDialog
                  project={sourceProject}
                  onAddPlatformConnection={handleAddPlatformConnection}
                />
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="platforms" className="mt-4">
            {sourceProject ? (
              <div className="mb-4">
                <PlatformConnectionDialog
                  project={sourceProject}
                  onAddPlatformConnection={handleAddPlatformConnection}
                />
              </div>
            ) : null}
            {project.platforms.length === 0 ? (
              <Empty className="min-h-48">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Plug />
                  </EmptyMedia>
                  <EmptyTitle>暂无平台</EmptyTitle>
                  <EmptyDescription>添加平台后显示连接状态。</EmptyDescription>
                </EmptyHeader>
                <EmptyContent />
              </Empty>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {project.platforms.map((platform) => (
                  <div key={platform.id} className="rounded-lg border border-border p-3">
                    <div className="space-y-1">
                      <p className="font-medium">{platform.name}</p>
                      <p className="text-sm text-muted-foreground">{platform.type}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant="outline">{platform.status}</Badge>
                      <Badge variant="outline">{platform.enabled ? "启用" : "停用"}</Badge>
                      {platform.allowFrom ? <Badge variant="outline">{platform.allowFrom}</Badge> : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="providers" className="mt-4">
            {project.providerRefs.length === 0 ? (
              <Empty className="min-h-48">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Server />
                  </EmptyMedia>
                  <EmptyTitle>未绑定服务商</EmptyTitle>
                </EmptyHeader>
                <EmptyContent />
              </Empty>
            ) : (
              <div className="flex flex-wrap gap-2">
                {project.providerRefs.map((provider) => (
                  <Badge key={provider} variant="outline">{provider}</Badge>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="heartbeat" className="mt-4">
            <DetailItem label="状态" value={project.heartbeatEnabled ? "已启用" : "未启用"} />
          </TabsContent>

          <TabsContent value="settings" className="mt-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <Label htmlFor="project-detail-agent">Agent 类型</Label>
                <NativeSelect
                  id="project-detail-agent"
                  className="w-full"
                  value={settingsDraft.agentType}
                  onChange={(event) => {
                    setSettingsDraft((current) => ({ ...current, agentType: event.target.value }))
                  }}
                  disabled={isSaving}
                >
                  {CC_CONNECT_AGENT_OPTIONS.map((agent) => (
                    <NativeSelectOption key={agent.value} value={agent.value}>
                      {agent.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <Label htmlFor="project-detail-permission">权限模式</Label>
                <NativeSelect
                  id="project-detail-permission"
                  className="w-full"
                  value={settingsDraft.permissionMode}
                  onChange={(event) => {
                    setSettingsDraft((current) => ({ ...current, permissionMode: event.target.value }))
                  }}
                  disabled={isSaving}
                >
                  <NativeSelectOption value="default">default</NativeSelectOption>
                  <NativeSelectOption value="acceptEdits">acceptEdits</NativeSelectOption>
                  <NativeSelectOption value="plan">plan</NativeSelectOption>
                  <NativeSelectOption value="bypassPermissions">bypassPermissions</NativeSelectOption>
                  <NativeSelectOption value="dontAsk">dontAsk</NativeSelectOption>
                </NativeSelect>
              </Field>
              <Field className="md:col-span-2">
                <Label htmlFor="project-detail-workdir">工作目录</Label>
                <Input
                  id="project-detail-workdir"
                  value={settingsDraft.workDir}
                  onChange={(event) => {
                    setSettingsDraft((current) => ({ ...current, workDir: event.target.value }))
                  }}
                  disabled={isSaving}
                />
              </Field>
              <Field>
                <Label htmlFor="project-detail-language">语言</Label>
                <Input
                  id="project-detail-language"
                  value={settingsDraft.language}
                  onChange={(event) => {
                    setSettingsDraft((current) => ({ ...current, language: event.target.value }))
                  }}
                  placeholder="zh"
                  disabled={isSaving}
                />
              </Field>
              <Field>
                <Label htmlFor="project-detail-admin">管理来源</Label>
                <Input
                  id="project-detail-admin"
                  value={settingsDraft.adminFrom}
                  onChange={(event) => {
                    setSettingsDraft((current) => ({ ...current, adminFrom: event.target.value }))
                  }}
                  placeholder="user1,user2"
                  disabled={isSaving}
                />
              </Field>
              <Field className="md:col-span-2">
                <Label htmlFor="project-detail-disabled-commands">禁用命令</Label>
                <Input
                  id="project-detail-disabled-commands"
                  value={settingsDraft.disabledCommands}
                  onChange={(event) => {
                    setSettingsDraft((current) => ({ ...current, disabledCommands: event.target.value }))
                  }}
                  placeholder="restart,upgrade"
                  disabled={isSaving}
                />
              </Field>
              <FieldError className="md:col-span-2">{settingsError}</FieldError>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => void handleSaveSettings()} disabled={isSaving}>
                {isSaving ? "保存中..." : "保存"}
              </Button>
              <Button variant="outline" onClick={syncSettingsDraft} disabled={isSaving}>
                重置
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={isSaving}>
                    <Trash2 />
                    删除项目
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>删除项目</AlertDialogTitle>
                    <AlertDialogDescription>
                      删除后会从本地配置中移除该项目。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void handleDeleteProject()}>
                      删除
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

type PlatformWizardKind = "telegram" | "feishu" | "lark" | "weixin"
type QrPlatformKind = Exclude<PlatformWizardKind, "telegram">

const PLATFORM_WIZARD_OPTIONS: Array<{
  value: PlatformWizardKind
  label: string
  method: "manual" | "qr"
}> = [
  { value: "telegram", label: "Telegram", method: "manual" },
  { value: "feishu", label: "Feishu", method: "qr" },
  { value: "lark", label: "Lark", method: "qr" },
  { value: "weixin", label: "Weixin", method: "qr" },
]

function PlatformConnectionDialog({
  project,
  onAddPlatformConnection,
}: {
  project: SynapseProjectConfig
  onAddPlatformConnection: (connection: SynapseProjectPlatformConnection) => Promise<void>
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [platform, setPlatform] = useState<PlatformWizardKind>("telegram")

  const selected = PLATFORM_WIZARD_OPTIONS.find((option) => option.value === platform)
    ?? PLATFORM_WIZARD_OPTIONS[0]
  const qrPlatform: QrPlatformKind = selected.value === "telegram" ? "feishu" : selected.value

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus />
          添加平台
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>添加平台</DialogTitle>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <Field>
            <Label htmlFor="platform-kind">平台</Label>
            <NativeSelect
              id="platform-kind"
              className="w-full"
              value={platform}
              onChange={(event) => setPlatform(event.target.value as PlatformWizardKind)}
            >
              {PLATFORM_WIZARD_OPTIONS.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {selected.method === "manual" ? (
            <TelegramManualPlatformForm
              project={project}
              onAddPlatformConnection={onAddPlatformConnection}
              onClose={() => setIsOpen(false)}
            />
          ) : (
            <QrPlatformDraftForm
              key={qrPlatform}
              platform={qrPlatform}
              onAddPlatformConnection={onAddPlatformConnection}
              onClose={() => setIsOpen(false)}
            />
          )}
        </FieldGroup>
      </DialogContent>
    </Dialog>
  )
}

function TelegramManualPlatformForm({
  project,
  onAddPlatformConnection,
  onClose,
}: {
  project: SynapseProjectConfig
  onAddPlatformConnection: (connection: SynapseProjectPlatformConnection) => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState({
    token: "",
    allowFrom: "*",
    groupReplyAll: false,
    shareSessionInChannel: false,
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!draft.token.trim()) {
      setFormError("Token 不能为空。")
      return
    }

    if (!window.synapse?.connectors) {
      setFormError("连接服务不可用。")
      return
    }

    setIsSubmitting(true)
    setFormError(null)

    try {
      const connectorDraft = await window.synapse.connectors.createDraft({
        type: "telegram",
        name: `${project.name}-telegram`,
        enabled: true,
        options: {
          token: draft.token.trim(),
          allow_from: draft.allowFrom.trim() || "*",
          group_reply_all: draft.groupReplyAll,
          share_session_in_channel: draft.shareSessionInChannel,
        },
      })

      if (connectorDraft.issues.length > 0) {
        setFormError(connectorDraft.issues[0]?.message ?? "保存失败。")
        return
      }

      await onAddPlatformConnection(
        createProjectPlatformConnectionFromConnector(
          connectorDraft.connector,
          new Date().toISOString(),
        ),
      )
      setDraft({
        token: "",
        allowFrom: "*",
        groupReplyAll: false,
        shareSessionInChannel: false,
      })
      onClose()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "保存失败。")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <Field>
        <Label htmlFor="telegram-token">Token</Label>
        <Input
          id="telegram-token"
          type="password"
          value={draft.token}
          onChange={(event) => {
            setDraft((current) => ({ ...current, token: event.target.value }))
          }}
          disabled={isSubmitting}
        />
      </Field>
      <Field>
        <Label htmlFor="telegram-allow-from">允许用户</Label>
        <Input
          id="telegram-allow-from"
          value={draft.allowFrom}
          onChange={(event) => {
            setDraft((current) => ({ ...current, allowFrom: event.target.value }))
          }}
          disabled={isSubmitting}
        />
      </Field>
      <div className="grid gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={draft.groupReplyAll}
            onCheckedChange={(checked) => {
              setDraft((current) => ({ ...current, groupReplyAll: checked === true }))
            }}
            disabled={isSubmitting}
          />
          群聊全部回复
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={draft.shareSessionInChannel}
            onCheckedChange={(checked) => {
              setDraft((current) => ({ ...current, shareSessionInChannel: checked === true }))
            }}
            disabled={isSubmitting}
          />
          频道共享会话
        </label>
      </div>
      <FieldError>{formError}</FieldError>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
          取消
        </Button>
        <Button onClick={() => void handleSubmit()} disabled={isSubmitting}>
          {isSubmitting ? "保存中..." : "保存"}
        </Button>
      </DialogFooter>
    </>
  )
}

type QrDraftStatus = "idle" | "waiting" | "expired" | "error" | "success"

function QrPlatformDraftForm({
  platform,
  onAddPlatformConnection,
  onClose,
}: {
  platform: "feishu" | "lark" | "weixin"
  onAddPlatformConnection: (connection: SynapseProjectPlatformConnection) => Promise<void>
  onClose: () => void
}) {
  const [status, setStatus] = useState<QrDraftStatus>("idle")
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSaveDraft = async () => {
    setIsSubmitting(true)
    setFormError(null)

    try {
      await onAddPlatformConnection(createQrProjectPlatformDraft({
        id: `connector:${platform}:qr-${crypto.randomUUID()}`,
        type: platform,
        now: new Date().toISOString(),
      }))
      setStatus("success")
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "保存失败。")
      setStatus("error")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center gap-3">
          {status === "success" ? (
            <CheckCircle2 className="size-5 text-muted-foreground" />
          ) : status === "error" || status === "expired" ? (
            <AlertCircle className="size-5 text-muted-foreground" />
          ) : status === "waiting" ? (
            <Clock className="size-5 text-muted-foreground" />
          ) : (
            <QrCode className="size-5 text-muted-foreground" />
          )}
          <div>
            <p className="font-medium">{getQrStatusLabel(status)}</p>
            <p className="text-sm text-muted-foreground">{platform}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {status === "idle" ? (
            <Button type="button" onClick={() => setStatus("waiting")} disabled={isSubmitting}>
              开始设置
            </Button>
          ) : null}
          {status === "waiting" ? (
            <>
              <Button type="button" onClick={() => void handleSaveDraft()} disabled={isSubmitting}>
                {isSubmitting ? "保存中..." : "保存草稿"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setStatus("expired")} disabled={isSubmitting}>
                标记过期
              </Button>
              <Button type="button" variant="outline" onClick={() => setStatus("error")} disabled={isSubmitting}>
                标记错误
              </Button>
            </>
          ) : null}
          {status === "expired" || status === "error" ? (
            <Button type="button" variant="outline" onClick={() => setStatus("waiting")} disabled={isSubmitting}>
              <RefreshCw />
              重试
            </Button>
          ) : null}
          {status === "success" ? (
            <Button type="button" onClick={onClose}>
              完成
            </Button>
          ) : null}
        </div>
      </div>
      <FieldError>{formError}</FieldError>
      {status !== "success" ? (
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            取消
          </Button>
        </DialogFooter>
      ) : null}
    </>
  )
}

function getQrStatusLabel(status: QrDraftStatus): string {
  const labels: Record<QrDraftStatus, string> = {
    idle: "未开始",
    waiting: "等待扫码",
    expired: "二维码已过期",
    error: "设置失败",
    success: "草稿已保存",
  }

  return labels[status]
}

function createSettingsDraft(project: ConnectorProjectSummary | null) {
  return {
    agentType: project?.agentType ?? DEFAULT_AGENT_TYPE,
    workDir: project?.workDir ?? "",
    permissionMode: project?.permissionMode ?? "default",
    language: project?.language ?? "",
    adminFrom: project?.adminFrom ?? "",
    disabledCommands: project?.disabledCommands.join(",") ?? "",
  }
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{label}</p>
      <p className="break-all text-sm text-muted-foreground">{value}</p>
    </div>
  )
}

function ProjectCreateDialog({
  projects,
  onCreateProject,
  onCreated,
  onChooseDirectory,
}: {
  projects: SynapseProjectConfig[]
  onCreateProject: (draft: ProjectDraft) => Promise<void>
  onCreated?: (projectName: string) => void
  onChooseDirectory?: () => Promise<string | null>
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [draft, setDraft] = useState<ProjectDraft>({
    name: "",
    workDir: "",
    agentType: DEFAULT_AGENT_TYPE,
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const reset = () => {
    setDraft({ name: "", workDir: "", agentType: DEFAULT_AGENT_TYPE })
    setFormError(null)
  }

  const handleOpenChange = (open: boolean) => {
    if (isSubmitting) {
      return
    }
    setIsOpen(open)
    if (!open) {
      reset()
    }
  }

  const handleChooseDirectory = async () => {
    if (!onChooseDirectory) {
      return
    }

    const selectedPath = await onChooseDirectory()
    if (!selectedPath) {
      return
    }

    setDraft((current) => ({
      ...current,
      workDir: selectedPath,
    }))
    setFormError(null)
  }

  const handleSubmit = async () => {
    const name = sanitizeCcProjectName(draft.name.trim())
    const workDir = draft.workDir.trim()

    if (!name || !workDir) {
      setFormError("项目名称和工作目录不能为空。")
      return
    }

    if (projects.some((project) => project.name === name)) {
      setFormError("项目名称已存在。")
      return
    }

    if (projects.some((project) => project.path === workDir || project.workDir === workDir)) {
      setFormError("工作目录已存在。")
      return
    }

    setIsSubmitting(true)
    setFormError(null)

    try {
      await onCreateProject({
        name,
        workDir,
        agentType: draft.agentType,
      })
      onCreated?.(name)
      handleOpenChange(false)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "保存失败。")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus />
          新建项目
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <Field>
            <Label htmlFor="cc-project-name">项目名称</Label>
            <Input
              id="cc-project-name"
              value={draft.name}
              onChange={(event) => {
                setDraft((current) => ({
                  ...current,
                  name: sanitizeCcProjectName(event.target.value),
                }))
              }}
              placeholder="my-project"
              disabled={isSubmitting}
            />
          </Field>
          <Field>
            <Label htmlFor="cc-project-workdir">工作目录</Label>
            <div className="flex gap-2">
              <Input
                id="cc-project-workdir"
                value={draft.workDir}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, workDir: event.target.value }))
                }}
                placeholder="/path/to/project"
                disabled={isSubmitting}
              />
              {onChooseDirectory ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleChooseDirectory()}
                  disabled={isSubmitting}
                >
                  浏览
                </Button>
              ) : null}
            </div>
          </Field>
          <Field>
            <Label htmlFor="cc-project-agent">Agent 类型</Label>
            <NativeSelect
              id="cc-project-agent"
              className="w-full"
              value={draft.agentType}
              onChange={(event) => {
                setDraft((current) => ({ ...current, agentType: event.target.value }))
              }}
              disabled={isSubmitting}
            >
              {CC_CONNECT_AGENT_OPTIONS.map((agent) => (
                <NativeSelectOption key={agent.value} value={agent.value}>
                  {agent.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <FieldError>{formError}</FieldError>
        </FieldGroup>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            取消
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={isSubmitting}>
            {isSubmitting ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { ConnectorsModule, ConnectorsProjectView }
