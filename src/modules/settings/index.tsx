import { useCallback, useMemo, useState } from "react"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { SidebarContentLayout } from "@/components/sidebar-content-layout"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LogsModule } from "@/modules/logs"
import { settingsCategories, settingsItems } from "@/modules/settings/data"
import { AboutPanel } from "@/modules/settings/components/about-panel"
import { ConfigBackupPanel } from "@/modules/settings/components/config-backup-panel"
import { IdentityPanel } from "@/modules/settings/components/identity-panel"
import { ProjectListEditor } from "@/modules/settings/components/project-list-editor"
import { RepositoryMaintenancePanel } from "@/modules/settings/components/repository-maintenance-panel"
import { RepositoryListEditor } from "@/modules/settings/components/repository-list-editor"
import { SettingItemRow } from "@/modules/settings/components/setting-item-row"
import { SettingsGroup } from "@/modules/settings/components/settings-group"
import { SettingsCategorySidebar } from "@/modules/settings/components/settings-category-sidebar"
import type { SettingItem, SettingsCategoryId } from "@/modules/settings/types"
import { createSettingPatch, getSettingValue } from "@/modules/settings/utils"
import { cn } from "@/lib/utils"

const logger = createRendererLogger("settings")

function SettingsModule() {
  const { activeRepository, config, error, isReady, updateConfig } = useAppConfig()
  const { promise } = useAppNotifications()
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>("general")
  const context = useMemo(
    () => ({
      config,
      activeRepository,
    }),
    [activeRepository, config],
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
  const isLogsCategory = activeCategory === "logs"

  const applyPatch = useCallback(
    async (patch: Parameters<typeof updateConfig>[0], reloadAfterUpdate = false) => {
      try {
        logger.info("Applying settings patch.", {
          patch,
          reloadAfterUpdate,
        })
        await promise(
          () => updateConfig(patch),
          {
            loading: reloadAfterUpdate ? "正在保存并刷新..." : "正在保存设置...",
            success: () => {
              if (reloadAfterUpdate && window.synapse?.config) {
                logger.info("Reloading window after settings patch.")
                window.location.reload()
                return null
              }

              return "设置已保存。"
            },
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
    async (repositories: typeof config.repositories, activeRepoUuid: string | null, reloadAfterUpdate: boolean) => {
      logger.info("Saving repository list from settings.", {
        activeRepoUuid,
        reloadAfterUpdate,
        repositoryCount: repositories.length,
      })
      return applyPatch(
        {
          repositories,
          activeRepoUuid,
        },
        reloadAfterUpdate,
      )
    },
    [applyPatch],
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
      contentScrollable={!isLogsCategory}
      sidebar={
        <SettingsCategorySidebar
          categories={settingsCategories}
          activeCategory={activeCategory}
          onCategoryChange={(nextCategory) => {
            logger.info("Settings category changed.", {
              nextCategory,
            })
            setActiveCategory(nextCategory)
          }}
        />
      }
    >
      <div className={cn("flex flex-col gap-6", isLogsCategory ? "h-full min-h-0 pb-4" : "pb-6")}>
        {activeCategory === "content" && activeRepository ? (
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

        {isReady && activeCategory === "content" && activeRepository ? (
          <RepositoryMaintenancePanel repositoryUuid={activeRepository.uuid} />
        ) : null}

        {isReady && hasRepositoriesItem ? (
          <RepositoryListEditor
            repositories={config.repositories}
            activeRepoUuid={config.activeRepoUuid}
            onSave={handleSaveRepositories}
          />
        ) : null}

        {isReady && hasProjectsItem ? (
          <ProjectListEditor
            projects={config.global.projects}
            onSave={handleSaveProjects}
          />
        ) : null}

        {isReady && activeCategory === "logs" ? (
          <div className="min-h-0 flex-1">
            <LogsModule />
          </div>
        ) : null}

        {isReady && activeCategory === "about" ? <AboutPanel /> : null}
      </div>
    </SidebarContentLayout>
  )
}

export { SettingsModule }
