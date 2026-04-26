import { FolderKanban, Plug, Plus, Server } from "lucide-react"
import { useMemo, useState } from "react"
import { useAppConfig } from "@/app-shell/config"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import type { SynapseProjectConfig } from "@/types/config"
import {
  CC_CONNECT_AGENT_OPTIONS,
  DEFAULT_AGENT_TYPE,
  createCcConnectProjectDraft,
  sanitizeCcProjectName,
  summarizeCcConnectProjects,
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

  const handleChooseDirectory = async () => {
    return window.synapse?.repository.chooseDirectory() ?? null
  }

  return (
    <ConnectorsProjectView
      projects={config.global.projects}
      isReady={isReady}
      error={error}
      onCreateProject={handleCreateProject}
      onChooseDirectory={handleChooseDirectory}
    />
  )
}

function ConnectorsProjectView({
  projects,
  isReady,
  error,
  onCreateProject,
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

          <ProjectDetailPreview project={selectedProject} />
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

function ProjectDetailPreview({ project }: { project: ConnectorProjectSummary | null }) {
  if (!project) {
    return null
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
      <CardContent className="grid gap-4 md:grid-cols-2">
        <DetailItem label="Agent" value={project.agentType ?? "未设置"} />
        <DetailItem label="平台" value={`${project.platformCount} 个`} />
        <DetailItem label="工作目录" value={project.workDir} />
        <DetailItem label="会话" value="待接入" />
      </CardContent>
    </Card>
  )
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
