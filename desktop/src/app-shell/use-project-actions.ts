import { useCallback } from "react"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { arePathsEqualForCompare } from "@/lib/path-compare"
import { getRendererPlatform } from "@/lib/runtime-platform"
import type { SynapseProjectConfig } from "@/types/config"

const logger = createRendererLogger("projects.actions")

type ProjectAddInput = {
  readonly name: string
  readonly path: string
}

type ProjectAddResult =
  | { readonly status: "added"; readonly project: SynapseProjectConfig }
  | { readonly status: "existing"; readonly project: SynapseProjectConfig }

function useProjectActions() {
  const { config, refreshConfig, updateConfig } = useAppConfig()
  const platform = getRendererPlatform()

  const isProjectPathConfigured = useCallback((projectPath: string) => (
    config.global.projects.some((project) => (
      arePathsEqualForCompare(project.path, projectPath, { platform })
    ))
  ), [config.global.projects, platform])

  const refreshProjects = useCallback(async () => {
    await refreshConfig()
  }, [refreshConfig])

  const addProject = useCallback(async (input: ProjectAddInput): Promise<ProjectAddResult> => {
    const name = input.name.trim()
    const projectPath = input.path.trim()

    if (!name || !projectPath) {
      throw new Error("项目名称和项目路径都不能为空。")
    }

    const latestConfig = await refreshConfig()
    const existingProject = latestConfig.global.projects.find((project) => (
      arePathsEqualForCompare(project.path, projectPath, { platform })
    ))

    if (existingProject) {
      return { status: "existing", project: existingProject }
    }

    const duplicateName = latestConfig.global.projects.some((project) => (
      project.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase()
    ))
    if (duplicateName) {
      throw new Error("这个项目名称已经存在了。")
    }

    const project: SynapseProjectConfig = {
      id: crypto.randomUUID(),
      name,
      path: projectPath,
    }

    await updateConfig({
      global: {
        projects: [...latestConfig.global.projects, project],
      },
    })
    logger.info("Project added.", { name, path: projectPath })

    return { status: "added", project }
  }, [platform, refreshConfig, updateConfig])

  return {
    addProject,
    isProjectPathConfigured,
    refreshProjects,
  }
}

export { useProjectActions }
export type { ProjectAddInput, ProjectAddResult }
