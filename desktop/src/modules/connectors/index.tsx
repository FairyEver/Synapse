import { AlertCircle, CheckCircle2, Clock, FolderKanban, Link2, Plug, Plus, QrCode, RefreshCw, Server, Trash2, Zap } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { useEffect, useMemo, useRef, useState } from "react"
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
  DialogDescription,
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
import type { SynapseProjectConfig } from "@/types/config"
import type {
  SynapseConnectorDescriptor,
  SynapseConnectorOptionDefinition,
  SynapseConnectorQrPlatform,
  SynapseConnectorQrSession,
} from "@/types/connector"
import type { SynapseProviderEntry } from "@/types/provider"
import {
  createProviderDraft,
  normalizeProviderName,
} from "@/lib/provider-model"
import {
  CC_CONNECT_AGENT_OPTIONS,
  DEFAULT_AGENT_TYPE,
  addInlineProviderToProject,
  bindGlobalProviderToProject,
  createCcConnectProjectDraft,
  listLinkableGlobalProviders,
  removeProviderFromProject,
  resolveProjectProvidersForSession,
  sanitizeCcProjectName,
  setActiveProviderForProject,
  summarizeCcConnectProjects,
  unbindGlobalProviderFromProject,
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
  globalProviders: SynapseProviderEntry[]
  isReady: boolean
  error: string | null
  onCreateProject: (draft: ProjectDraft) => Promise<void>
  onUpdateProject: (projectId: string, project: SynapseProjectConfig) => Promise<void>
  onDeleteProject: (projectId: string) => Promise<void>
  onRefreshConfig: () => Promise<void>
  onChooseDirectory?: () => Promise<string | null>
}

function ConnectorsModule() {
  const { config, error, isReady, refreshConfig, updateConfig } = useAppConfig()

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
      globalProviders={config.global.providers}
      isReady={isReady}
      error={error}
      onCreateProject={handleCreateProject}
      onUpdateProject={handleUpdateProject}
      onDeleteProject={handleDeleteProject}
      onRefreshConfig={async () => {
        await refreshConfig()
      }}
      onChooseDirectory={handleChooseDirectory}
    />
  )
}

function ConnectorsProjectView({
  projects,
  globalProviders,
  isReady,
  error,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onRefreshConfig,
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
            globalProviders={globalProviders}
            onUpdateProject={onUpdateProject}
            onDeleteProject={onDeleteProject}
            onRefreshConfig={onRefreshConfig}
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
  globalProviders,
  onUpdateProject,
  onDeleteProject,
  onRefreshConfig,
  onDeleted,
}: {
  project: ConnectorProjectSummary | null
  sourceProject: SynapseProjectConfig | null
  globalProviders: SynapseProviderEntry[]
  onUpdateProject: (projectId: string, project: SynapseProjectConfig) => Promise<void>
  onDeleteProject: (projectId: string) => Promise<void>
  onRefreshConfig: () => Promise<void>
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

  const handleBindGlobalProvider = async (providerName: string) => {
    if (!sourceProject) {
      return
    }

    await onUpdateProject(project.id, bindGlobalProviderToProject(sourceProject, providerName))
  }

  const handleUnbindGlobalProvider = async (providerName: string) => {
    if (!sourceProject) {
      return
    }

    await onUpdateProject(project.id, unbindGlobalProviderFromProject(sourceProject, providerName))
  }

  const handleAddInlineProvider = async (provider: SynapseProviderEntry) => {
    if (!sourceProject) {
      return
    }

    await onUpdateProject(project.id, addInlineProviderToProject(sourceProject, provider))
  }

  const handleRemoveProvider = async (providerName: string) => {
    if (!sourceProject) {
      return
    }

    await onUpdateProject(project.id, removeProviderFromProject(sourceProject, providerName))
  }

  const handleSetActiveProvider = async (providerName: string | null) => {
    if (!sourceProject) {
      return
    }

    await onUpdateProject(project.id, setActiveProviderForProject(sourceProject, providerName))
  }

  const resolvedProviders = sourceProject
    ? resolveProjectProvidersForSession(sourceProject, globalProviders)
    : []
  const linkableProviders = sourceProject
    ? listLinkableGlobalProviders(sourceProject, globalProviders)
    : []
  const inlineProviderNames = new Set((sourceProject?.providers ?? []).map((provider) => normalizeProviderName(provider.name)))

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
                  onRefreshConfig={onRefreshConfig}
                />
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="platforms" className="mt-4">
            {sourceProject ? (
              <div className="mb-4">
                <PlatformConnectionDialog
                  project={sourceProject}
                  onRefreshConfig={onRefreshConfig}
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
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                {sourceProject ? (
                  <ProviderBindDialog
                    providers={linkableProviders}
                    onBind={handleBindGlobalProvider}
                  />
                ) : null}
                {sourceProject ? (
                  <ProjectProviderDialog
                    project={sourceProject}
                    onAddProvider={handleAddInlineProvider}
                  />
                ) : null}
              </div>
              {resolvedProviders.length === 0 ? (
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
                <div className="grid gap-3 md:grid-cols-2">
                  {resolvedProviders.map((provider) => {
                    const isInline = inlineProviderNames.has(normalizeProviderName(provider.name))
                    const isActive = normalizeProviderName(sourceProject?.activeProvider ?? "") === normalizeProviderName(provider.name)

                    return (
                      <div key={provider.id} className="rounded-lg border border-border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium">{provider.name}</p>
                              {isActive ? <Badge variant="secondary">当前</Badge> : null}
                              <Badge variant="outline">{isInline ? "项目" : "全局"}</Badge>
                            </div>
                            <p className="truncate text-sm text-muted-foreground">
                              {provider.model ?? "未设置模型"}
                            </p>
                            {provider.baseUrl ? (
                              <p className="truncate text-xs text-muted-foreground">{provider.baseUrl}</p>
                            ) : null}
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {!isActive ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleSetActiveProvider(provider.name)}
                            >
                              <Zap />
                              激活
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleSetActiveProvider(null)}
                            >
                              清除激活
                            </Button>
                          )}
                          {!isActive && isInline ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void handleRemoveProvider(provider.name)}
                            >
                              <Trash2 />
                              删除
                            </Button>
                          ) : null}
                          {!isActive && !isInline ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void handleUnbindGlobalProvider(provider.name)}
                            >
                              <Link2 />
                              解绑
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
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

function ProviderBindDialog({
  providers,
  onBind,
}: {
  providers: SynapseProviderEntry[]
  onBind: (providerName: string) => Promise<void>
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState(providers[0]?.name ?? "")
  const [isSaving, setIsSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!providers.some((provider) => provider.name === selectedProvider)) {
      setSelectedProvider(providers[0]?.name ?? "")
    }
  }, [providers, selectedProvider])

  const handleBind = async () => {
    if (!selectedProvider) {
      setFormError("没有可绑定的全局服务商。")
      return
    }

    setIsSaving(true)
    setFormError(null)

    try {
      await onBind(selectedProvider)
      setIsOpen(false)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "绑定失败。")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={providers.length === 0}>
          <Link2 />
          绑定全局
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>绑定全局服务商</DialogTitle>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <Field>
            <Label htmlFor="bind-global-provider">服务商</Label>
            <NativeSelect
              id="bind-global-provider"
              className="w-full"
              value={selectedProvider}
              disabled={isSaving}
              onChange={(event) => {
                setSelectedProvider(event.target.value)
                setFormError(null)
              }}
            >
              {providers.map((provider) => (
                <NativeSelectOption key={provider.id} value={provider.name}>
                  {provider.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <FieldError>{formError}</FieldError>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)} disabled={isSaving}>
            取消
          </Button>
          <Button onClick={() => void handleBind()} disabled={isSaving || !selectedProvider}>
            {isSaving ? "绑定中..." : "绑定"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProjectProviderDialog({
  project,
  onAddProvider,
}: {
  project: SynapseProjectConfig
  onAddProvider: (provider: SynapseProviderEntry) => Promise<void>
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [draft, setDraft] = useState({
    name: "",
    apiKey: "",
    baseUrl: "",
    model: "",
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const resetDraft = () => {
    setDraft({
      name: "",
      apiKey: "",
      baseUrl: "",
      model: "",
    })
    setFormError(null)
  }

  const handleOpenChange = (open: boolean) => {
    if (isSaving) {
      return
    }
    setIsOpen(open)
    if (!open) {
      resetDraft()
    }
  }

  const updateDraft = (patch: Partial<typeof draft>) => {
    setDraft((current) => ({
      ...current,
      ...patch,
    }))
    setFormError(null)
  }

  const handleAdd = async () => {
    if (!draft.name.trim()) {
      setFormError("名称不能为空。")
      return
    }

    const providerDraft = createProviderDraft({
      name: draft.name,
      scope: "project",
      projectId: project.id,
      apiKey: draft.apiKey,
      baseUrl: draft.baseUrl,
      model: draft.model,
      agentTypes: [project.agentType ?? DEFAULT_AGENT_TYPE],
    })

    setIsSaving(true)
    setFormError(null)

    try {
      await onAddProvider(providerDraft.provider)
      setIsOpen(false)
      resetDraft()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "添加失败。")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus />
          添加项目服务商
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>添加项目服务商</DialogTitle>
          <DialogDescription>API Key 只保存为密钥引用。</DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <Label htmlFor="project-provider-name">名称</Label>
              <Input
                id="project-provider-name"
                value={draft.name}
                disabled={isSaving}
                onChange={(event) => updateDraft({ name: event.target.value })}
                placeholder="relay"
              />
            </Field>
            <Field>
              <Label htmlFor="project-provider-api-key">API Key</Label>
              <Input
                id="project-provider-api-key"
                type="password"
                value={draft.apiKey}
                disabled={isSaving}
                onChange={(event) => updateDraft({ apiKey: event.target.value })}
                placeholder="sk-..."
              />
            </Field>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <Label htmlFor="project-provider-base-url">Base URL</Label>
              <Input
                id="project-provider-base-url"
                value={draft.baseUrl}
                disabled={isSaving}
                onChange={(event) => updateDraft({ baseUrl: event.target.value })}
                placeholder="https://api.example.com"
              />
            </Field>
            <Field>
              <Label htmlFor="project-provider-model">模型</Label>
              <Input
                id="project-provider-model"
                value={draft.model}
                disabled={isSaving}
                onChange={(event) => updateDraft({ model: event.target.value })}
              />
            </Field>
          </div>
          <FieldError>{formError}</FieldError>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isSaving}>
            取消
          </Button>
          <Button onClick={() => void handleAdd()} disabled={isSaving}>
            {isSaving ? "添加中..." : "添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const QR_PLATFORM_TYPES = new Set(["feishu", "lark", "weixin"])
const MANUAL_PLATFORM_ORDER = ["telegram", "discord", "slack", "dingtalk", "wecom", "qq", "qqbot", "line", "weibo"]
const PLATFORM_LABELS: Record<string, string> = {
  dingtalk: "DingTalk",
  discord: "Discord",
  feishu: "Feishu",
  lark: "Lark",
  line: "LINE",
  qq: "QQ",
  qqbot: "QQ Bot",
  slack: "Slack",
  telegram: "Telegram",
  wecom: "WeCom",
  weibo: "Weibo",
  weixin: "Weixin",
}

const OPTION_LABELS: Record<string, string> = {
  access_token: "Access Token",
  account_id: "账号 ID",
  agent_id: "Agent ID",
  allow_from: "允许用户",
  app_id: "App ID",
  app_secret: "App Secret",
  app_token: "App Token",
  bot_token: "Bot Token",
  callback_aes_key: "Callback AES Key",
  callback_path: "Callback Path",
  callback_token: "Callback Token",
  channel_secret: "Channel Secret",
  channel_token: "Channel Token",
  client_id: "Client ID",
  client_secret: "Client Secret",
  corp_id: "Corp ID",
  corp_secret: "Corp Secret",
  guild_id: "Guild ID",
  group_reply_all: "群聊全部回复",
  port: "端口",
  sandbox: "沙盒模式",
  share_session_in_channel: "频道共享会话",
  thread_isolation: "线程隔离",
  token: "Token",
  ws_url: "WebSocket URL",
}

const OPTION_PLACEHOLDERS: Record<string, string> = {
  allow_from: "*",
  app_token: "xapp-...",
  bot_token: "xoxb-...",
  callback_path: "/callback",
  port: "8080",
  token: "token",
  ws_url: "ws://127.0.0.1:3001",
}

function PlatformConnectionDialog({
  project,
  onRefreshConfig,
}: {
  project: SynapseProjectConfig
  onRefreshConfig: () => Promise<void>
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [descriptors, setDescriptors] = useState<SynapseConnectorDescriptor[]>([])
  const [descriptorError, setDescriptorError] = useState<string | null>(null)
  const [platform, setPlatform] = useState("telegram")

  useEffect(() => {
    if (!isOpen || descriptors.length > 0) {
      return
    }

    if (!window.synapse?.connectors) {
      setDescriptorError("连接服务不可用。")
      return
    }

    let cancelled = false
    window.synapse.connectors.listDescriptors()
      .then((items) => {
        if (cancelled) {
          return
        }
        setDescriptors(items)
        setDescriptorError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }
        setDescriptorError(error instanceof Error ? error.message : "读取平台失败。")
      })

    return () => {
      cancelled = true
    }
  }, [descriptors.length, isOpen])

  const descriptorMap = useMemo(
    () => new Map(descriptors.map((descriptor) => [descriptor.type, descriptor])),
    [descriptors],
  )
  const platformOptions = useMemo(() => {
    const manualOptions = MANUAL_PLATFORM_ORDER
      .map((type) => ({
        value: type,
        label: descriptorMap.get(type)?.label ?? PLATFORM_LABELS[type] ?? type,
        method: "manual" as const,
      }))

    return [
      ...manualOptions,
      { value: "feishu", label: descriptorMap.get("feishu")?.label ?? PLATFORM_LABELS.feishu, method: "qr" as const },
      { value: "lark", label: descriptorMap.get("lark")?.label ?? PLATFORM_LABELS.lark, method: "qr" as const },
      { value: "weixin", label: descriptorMap.get("weixin")?.label ?? PLATFORM_LABELS.weixin, method: "qr" as const },
    ]
  }, [descriptorMap])

  const selected = platformOptions.find((option) => option.value === platform) ?? platformOptions[0]
  const selectedDescriptor = descriptorMap.get(selected.value)

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
              onChange={(event) => setPlatform(event.target.value)}
            >
              {platformOptions.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <FieldError>{descriptorError}</FieldError>
          {selected.method === "manual" ? (
            selectedDescriptor ? (
              <ManualPlatformForm
                key={selectedDescriptor.type}
                descriptor={selectedDescriptor}
                project={project}
                onRefreshConfig={onRefreshConfig}
                onClose={() => setIsOpen(false)}
              />
            ) : null
          ) : (
            <QrPlatformOnboardingForm
              key={selected.value}
              platform={selected.value as SynapseConnectorQrPlatform}
              project={project}
              onRefreshConfig={onRefreshConfig}
              onClose={() => setIsOpen(false)}
            />
          )}
        </FieldGroup>
      </DialogContent>
    </Dialog>
  )
}

function ManualPlatformForm({
  descriptor,
  project,
  onRefreshConfig,
  onClose,
}: {
  descriptor: SynapseConnectorDescriptor
  project: SynapseProjectConfig
  onRefreshConfig: () => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Record<string, string | boolean | number>>(() =>
    createManualPlatformDraft(descriptor),
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    setDraft(createManualPlatformDraft(descriptor))
    setFormError(null)
  }, [descriptor])

  const handleSubmit = async () => {
    const missing = descriptor.options.find((option) => option.required && !hasManualOptionValue(draft[option.name]))
    if (missing) {
      setFormError(`${getOptionLabel(missing)}不能为空。`)
      return
    }

    if (!window.synapse?.connectors) {
      setFormError("连接服务不可用。")
      return
    }

    setIsSubmitting(true)
    setFormError(null)

    try {
      await window.synapse.connectors.saveManualPlatform({
        projectId: project.id,
        type: descriptor.type,
        name: `${project.name}-${descriptor.type}`,
        enabled: true,
        options: cleanManualPlatformDraft(draft),
      })
      await onRefreshConfig()
      setDraft(createManualPlatformDraft(descriptor))
      onClose()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "保存失败。")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      {descriptor.options.map((option) => (
        <ConnectorOptionField
          key={option.name}
          option={option}
          value={draft[option.name]}
          disabled={isSubmitting}
          onChange={(value) => {
            setDraft((current) => ({ ...current, [option.name]: value }))
            setFormError(null)
          }}
        />
      ))}
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

type QrFlowPhase = "idle" | "generating" | "waiting" | "scanned" | "saving" | "connected" | "expired" | "denied" | "error"

function QrPlatformOnboardingForm({
  platform,
  project,
  onRefreshConfig,
  onClose,
}: {
  platform: SynapseConnectorQrPlatform
  project: SynapseProjectConfig
  onRefreshConfig: () => Promise<void>
  onClose: () => void
}) {
  const [phase, setPhase] = useState<QrFlowPhase>("idle")
  const [session, setSession] = useState<SynapseConnectorQrSession | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const pollTimerRef = useRef<number | null>(null)
  const pollingRef = useRef(false)

  const clearPollTimer = () => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }

  const applySessionStatus = async (nextSession: SynapseConnectorQrSession) => {
    setSession(nextSession)

    switch (nextSession.status) {
      case "waiting":
        setPhase("waiting")
        return
      case "scanned":
        setPhase("scanned")
        return
      case "success":
        setPhase("saving")
        if (!window.synapse?.connectors) {
          throw new Error("连接服务不可用。")
        }
        await window.synapse.connectors.saveQr({
          sessionId: nextSession.sessionId,
          projectId: project.id,
        })
        await onRefreshConfig()
        setPhase("connected")
        return
      case "expired":
        setPhase("expired")
        setFormError(nextSession.error)
        return
      case "denied":
        setPhase("denied")
        setFormError(nextSession.error)
        return
      case "failed":
        setPhase("error")
        setFormError(nextSession.error ?? "设置失败。")
        return
      case "cancelled":
        return
    }
  }

  const pollQr = async () => {
    if (!session || pollingRef.current || phase === "saving" || phase === "connected") {
      return
    }

    if (!window.synapse?.connectors) {
      setFormError("连接服务不可用。")
      setPhase("error")
      return
    }

    pollingRef.current = true
    try {
      const nextSession = await window.synapse.connectors.pollQr({ sessionId: session.sessionId })
      await applySessionStatus(nextSession)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "轮询失败。")
      setPhase("error")
    } finally {
      pollingRef.current = false
    }
  }

  useEffect(() => {
    if ((phase !== "waiting" && phase !== "scanned") || !session) {
      return
    }

    clearPollTimer()
    const intervalMs = Math.max(session.intervalSeconds, 1) * 1000
    pollTimerRef.current = window.setTimeout(() => {
      void pollQr()
    }, intervalMs)

    return clearPollTimer
  }, [phase, session?.intervalSeconds, session?.sessionId])

  useEffect(() => clearPollTimer, [])

  const handleStart = async () => {
    if (!QR_PLATFORM_TYPES.has(platform)) {
      setFormError("平台不支持扫码。")
      setPhase("error")
      return
    }

    setIsSubmitting(true)
    setFormError(null)
    setPhase("generating")

    try {
      if (!window.synapse?.connectors) {
        throw new Error("连接服务不可用。")
      }
      const nextSession = await window.synapse.connectors.beginQr({ platform })
      await applySessionStatus(nextSession)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "保存失败。")
      setPhase("error")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = () => {
    clearPollTimer()
    if (session) {
      void window.synapse?.connectors.cancelQr({ sessionId: session.sessionId }).catch((error: unknown) => {
        setFormError(error instanceof Error ? error.message : "取消失败。")
      })
    }
    onClose()
  }

  const handleRetry = () => {
    clearPollTimer()
    setSession(null)
    setFormError(null)
    setPhase("idle")
  }

  return (
    <>
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center gap-3">
          {phase === "connected" ? (
            <CheckCircle2 className="size-5 text-muted-foreground" />
          ) : phase === "error" || phase === "expired" || phase === "denied" ? (
            <AlertCircle className="size-5 text-muted-foreground" />
          ) : phase === "waiting" || phase === "scanned" || phase === "saving" ? (
            <Clock className="size-5 text-muted-foreground" />
          ) : (
            <QrCode className="size-5 text-muted-foreground" />
          )}
          <div>
            <p className="font-medium">{getQrStatusLabel(phase)}</p>
            <p className="text-sm text-muted-foreground">{platform}</p>
          </div>
        </div>
        {session?.qrContent && (phase === "waiting" || phase === "scanned" || phase === "saving") ? (
          <div className="mt-4 flex justify-center">
            <QrCodePreview qrContent={session.qrContent} />
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {phase === "idle" ? (
            <Button type="button" onClick={() => void handleStart()} disabled={isSubmitting}>
              开始设置
            </Button>
          ) : null}
          {phase === "generating" ? (
            <Button type="button" disabled>
              生成中...
            </Button>
          ) : null}
          {phase === "expired" || phase === "error" || phase === "denied" ? (
            <Button type="button" variant="outline" onClick={handleRetry} disabled={isSubmitting}>
              <RefreshCw />
              重试
            </Button>
          ) : null}
          {phase === "connected" ? (
            <Button type="button" onClick={onClose}>
              完成
            </Button>
          ) : null}
        </div>
      </div>
      <FieldError>{formError}</FieldError>
      {phase !== "connected" ? (
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={isSubmitting}>
            取消
          </Button>
        </DialogFooter>
      ) : null}
    </>
  )
}

function QrCodePreview({ qrContent }: { qrContent: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <QRCodeSVG value={qrContent} size={192} level="M" title="连接二维码" />
    </div>
  )
}

function getQrStatusLabel(status: QrFlowPhase): string {
  const labels: Record<QrFlowPhase, string> = {
    idle: "未开始",
    generating: "生成中",
    waiting: "等待扫码",
    scanned: "已扫码，等待确认",
    saving: "保存中",
    connected: "已连接",
    expired: "已过期",
    denied: "已拒绝",
    error: "设置失败",
  }

  return labels[status]
}

function createManualPlatformDraft(descriptor: SynapseConnectorDescriptor): Record<string, string | boolean | number> {
  return descriptor.options.reduce<Record<string, string | boolean | number>>((draft, option) => {
    if (option.defaultValue !== undefined) {
      draft[option.name] = option.defaultValue
    } else if (option.kind === "boolean") {
      draft[option.name] = false
    } else {
      draft[option.name] = ""
    }
    return draft
  }, {})
}

function hasManualOptionValue(value: string | boolean | number | undefined): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0
  }
  return value !== undefined && value !== null
}

function cleanManualPlatformDraft(values: Record<string, string | boolean | number>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values)
      .map(([key, value]) => [key, typeof value === "string" ? value.trim() : value] as const)
      .filter(([, value]) => value !== ""),
  )
}

function getOptionLabel(option: SynapseConnectorOptionDefinition): string {
  return OPTION_LABELS[option.name] ?? option.name
}

function ConnectorOptionField({
  option,
  value,
  disabled,
  onChange,
}: {
  option: SynapseConnectorOptionDefinition
  value: string | boolean | number | undefined
  disabled: boolean
  onChange: (value: string | boolean | number) => void
}) {
  const fieldId = `platform-option-${option.name}`
  const label = getOptionLabel(option)

  if (option.kind === "boolean") {
    return (
      <Field orientation="horizontal">
        <Checkbox
          id={fieldId}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked === true)}
          disabled={disabled}
        />
        <Label htmlFor={fieldId}>{label}</Label>
      </Field>
    )
  }

  return (
    <Field>
      <Label htmlFor={fieldId}>{label}</Label>
      <Input
        id={fieldId}
        type={option.kind === "secret" ? "password" : option.kind === "number" ? "number" : "text"}
        value={value === undefined ? "" : String(value)}
        onChange={(event) => {
          onChange(option.kind === "number" ? Number(event.target.value) : event.target.value)
        }}
        placeholder={OPTION_PLACEHOLDERS[option.name]}
        disabled={disabled}
        aria-required={option.required}
      />
    </Field>
  )
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

export { ConnectorsModule, ConnectorsProjectView, QrCodePreview }
