import type { SynapseProjectConfig, SynapseRepositoryConfig } from "@/types/config"
import { SettingsSectionHeading } from "@/modules/settings/components/settings-section-heading"
import { RepositoryListEditor } from "@/modules/settings/components/repository-list-editor"
import { ProjectListEditor } from "@/modules/settings/components/project-list-editor"

type StoragePanelProps = {
  projects: SynapseProjectConfig[]
  onSaveRepositories: (
    repositories: SynapseRepositoryConfig[],
    activeRepoUuid: string | null,
  ) => Promise<boolean>
  onSaveProjects: (projects: SynapseProjectConfig[]) => Promise<void>
}

function StoragePanel({
  projects,
  onSaveRepositories,
  onSaveProjects,
}: StoragePanelProps) {
  return (
    <div className="flex flex-col">
      <SettingsSectionHeading>仓库目录</SettingsSectionHeading>
      <RepositoryListEditor onSave={onSaveRepositories} />

      <SettingsSectionHeading>项目路径</SettingsSectionHeading>
      <ProjectListEditor projects={projects} onSave={onSaveProjects} />
    </div>
  )
}

export { StoragePanel }
