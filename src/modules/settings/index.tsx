import { useCallback, useMemo, useState } from "react"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import {
  useActiveRepository,
  useRepositoryActions,
  useRepositoryList,
} from "@/app-shell/use-repository-manager"
import { SidebarContentLayout } from "@/components/sidebar-content-layout"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { settingsCategories, settingsItems } from "@/modules/settings/data"
import { AboutPanel } from "@/modules/settings/components/about-panel"
import type { SettingsCategory } from "@/modules/settings/types"
import { ConfigBackupPanel } from "@/modules/settings/components/config-backup-panel"
import { IdentityPanel } from "@/modules/settings/components/identity-panel"
import { LogExportPanel } from "@/modules/settings/components/log-export-panel"
import { ProjectListEditor } from "@/modules/settings/components/project-list-editor"
import { RepositoryMaintenancePanel } from "@/modules/settings/components/repository-maintenance-panel"
import { RepositoryListEditor } from "@/modules/settings/components/repository-list-editor"
import { SettingItemRow } from "@/modules/settings/components/setting-item-row"
import { SettingsGroup } from "@/modules/settings/components/settings-group"
import { SettingsCategorySidebar } from "@/modules/settings/components/settings-category-sidebar"
import type { SettingItem, SettingsCategoryId } from "@/modules/settings/types"
import { createSettingPatch, getSettingValue } from "@/modules/settings/utils"

const logger = createRendererLogger("settings")

let sessionAdminMode = false

function SettingsModule() {
  const { config, error, isReady, updateConfig } = useAppConfig()
  const activeRepository = useActiveRepository()
  const repositories = useRepositoryList()
  const { replaceRepositories } = useRepositoryActions()
  const { promise } = useAppNotifications()
  const [activeCategory, setActiveCategoryRaw] = useState<SettingsCategoryId>("general")
  const [isAdminMode, setIsAdminModeState] = useState(sessionAdminMode)

  const setActiveCategory = useCallback((nextCategory: SettingsCategoryId) => {
    setActiveCategoryRaw((prev) => {
      if (prev !== nextCategory) {
        logger.info("Settings category switched.", { from: prev, to: nextCategory })
      }
      return nextCategory
    })
  }, [])

  const setIsAdminMode = useCallback((enabled: boolean) => {
    sessionAdminMode = enabled
    setIsAdminModeState(enabled)
  }, [])
  const context = useMemo(
    () => ({
      config,
      activeRepository,
    }),
    [activeRepository, config],
  )

  const visibleCategories = useMemo<SettingsCategory[]>(
    () =>
      settingsCategories.filter((category) => {
        if (category.id === "admin") {
          return isAdminMode
        }
        return true
      }),
    [isAdminMode],
  )

  const categoryItems = useMemo(
    () =>
      settingsItems.filter(
        (item) => item.category === activeCategory && (item.visible ? item.visible(context) : true),
      ),
    [activeCategory, context],
  )

  const regularItems = categoryItems.filter((item) => item.type !== "list" && activeCategory !== "about")
  const hasRepositoriesItem = categoryItems.some((item) => item.key === "repositories")
  const hasProjectsItem = categoryItems.some((item) => item.key === "global.projects")

  const applyPatch = useCallback(
    async (patch: Parameters<typeof updateConfig>[0], reset = false) => {
      try {
        logger.info("Applying settings patch.", {
          patch,
          reset,
        })
        await promise(
          () => updateConfig(patch, reset),
          {
            loading: reset ? "正在保存并重置..." : "正在保存设置...",
            success: () => "设置已保存。",
            error: (updateError) => updateError instanceof Error ? updateError.message : "保存设置失败。",
          },
        )

        return true
      } catch (updateError) {
        logger.error("Failed to apply settings patch.", updateError)
        return false
      }
    },
    [promise, updateConfig],
  )

  const handleSaveItem = useCallback(
    async (item: SettingItem, nextValue: unknown) => {
      const patch = createSettingPatch(item, nextValue, context)

      if (!patch) {
        return
      }

      logger.info("Saving settings item.", {
        itemKey: item.key,
      })
      await applyPatch(patch)
    },
    [applyPatch, context],
  )

  const handleSaveRepositories = useCallback(
    async (nextRepositories: typeof repositories, activeRepoUuid: string | null) => {
      logger.info("Saving repository list from settings.", {
        activeRepoUuid,
        repositoryCount: nextRepositories.length,
      })
      try {
        await promise(
          () => replaceRepositories(nextRepositories, activeRepoUuid),
          {
            loading: "正在保存目录...",
            success: () => "目录已保存。",
            error: (updateError) => updateError instanceof Error ? updateError.message : "保存目录失败。",
          },
        )

        return true
      } catch (updateError) {
        logger.error("Failed to save repository list from settings.", updateError)
        return false
      }
    },
    [promise, replaceRepositories, repositories],
  )

  const handleSaveProjects = useCallback(
    async (projects: typeof config.global.projects) => {
      logger.info("Saving project list from settings.", {
        projectCount: projects.length,
      })
      await applyPatch({
        global: {
          projects,
        },
      })
    },
    [applyPatch],
  )

  return (
    <SidebarContentLayout
      contentClassName="bg-muted/30"
      sidebar={
        <SettingsCategorySidebar
          categories={visibleCategories}
          activeCategory={activeCategory}
          onCategoryChange={(nextCategory) => {
            setActiveCategory(nextCategory)
          }}
        />
      }
    >
      <div className="flex flex-col gap-6 pb-6">
        {activeCategory === "content" && activeRepository ? (
          <p className="text-sm text-muted-foreground">
            {activeRepository.name}
          </p>
        ) : null}
        {activeCategory === "admin" && activeRepository ? (
          <p className="text-sm text-muted-foreground">
            {activeRepository.name}
          </p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {!isReady ? (
          <Card className="bg-background ring-0">
            <CardHeader>
              <CardTitle>加载中</CardTitle>
              <CardDescription>正在读取设置。</CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        {isReady && activeCategory === "content" && activeRepository === null ? (
          <div className="flex min-h-60 flex-col items-center justify-center gap-4">
            <p className="text-sm text-muted-foreground">请先添加本地目录</p>
            <Button
              variant="outline"
              onClick={() => setActiveCategory("repositories")}
            >
              前往添加目录
            </Button>
          </div>
        ) : null}

        {isReady && activeCategory === "admin" && activeRepository === null ? (
          <div className="flex min-h-60 flex-col items-center justify-center gap-4">
            <p className="text-sm text-muted-foreground">请先添加本地目录</p>
            <Button
              variant="outline"
              onClick={() => setActiveCategory("repositories")}
            >
              前往添加目录
            </Button>
          </div>
        ) : null}

        {isReady && regularItems.length > 0 ? (
          <SettingsGroup>
            {regularItems.map((item) => (
              <SettingItemRow
                key={item.key}
                item={item}
                value={getSettingValue(item, context)}
                context={context}
                onSave={handleSaveItem}
              />
            ))}
          </SettingsGroup>
        ) : null}

        {isReady && activeCategory === "general" ? <IdentityPanel /> : null}
        {isReady && activeCategory === "general" ? <ConfigBackupPanel /> : null}
        {isReady && activeCategory === "logs" ? <LogExportPanel /> : null}

        {isReady && activeCategory === "admin" && activeRepository ? (
          <RepositoryMaintenancePanel repositoryUuid={activeRepository.uuid} />
        ) : null}

        {isReady && hasRepositoriesItem ? (
          <RepositoryListEditor
            onSave={handleSaveRepositories}
          />
        ) : null}

        {isReady && hasProjectsItem ? (
          <ProjectListEditor
            projects={config.global.projects}
            onSave={handleSaveProjects}
          />
        ) : null}

        {isReady && activeCategory === "about" ? (
          <AboutPanel
            isAdminMode={isAdminMode}
            onAdminModeChange={setIsAdminMode}
          />
        ) : null}
      </div>
    </SidebarContentLayout>
  )
}

export { SettingsModule }
