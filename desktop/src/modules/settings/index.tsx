import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { LoaderCircle } from "lucide-react"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { subscribeOpenSettingsAbout, subscribeOpenSettingsStorage } from "@/app-shell/navigation"
import { useAppNotifications } from "@/app-shell/notifications"
import {
  useActiveRepository,
  useRepositoryActions,
} from "@/app-shell/use-repository-manager"
import { SidebarContentLayout } from "@/components/sidebar-content-layout"
import { Button } from "@/components/ui/button"
import { Card, CardHeader } from "@/components/ui/card"
import { settingsCategories, settingsItems } from "@/modules/settings/data"
import { AboutPanel } from "@/modules/settings/components/about-panel"
import type { SettingsCategory } from "@/modules/settings/types"
import { ConfigBackupPanel } from "@/modules/settings/components/config-backup-panel"
import { AppResetPanel } from "@/modules/settings/components/app-reset-panel"
import { ClaudeCodePanel } from "@/modules/settings/components/claude-code-panel"
import { ToolsPanel } from "@/modules/settings/components/tools-panel"
import { IdentityPanel } from "@/modules/settings/components/identity-panel"
import { RepositoryMaintenancePanel } from "@/modules/settings/components/repository-maintenance-panel"
import { SettingItemRow } from "@/modules/settings/components/setting-item-row"
import { SettingsGroup } from "@/modules/settings/components/settings-group"
import { SettingsCategorySidebar } from "@/modules/settings/components/settings-category-sidebar"
import { ServicesPanel } from "@/modules/settings/components/services-panel"
import { RepositoryListEditor } from "@/modules/settings/components/repository-list-editor"
import { ProjectListEditor } from "@/modules/settings/components/project-list-editor"
import { TroubleshootingPanel } from "@/modules/settings/components/troubleshooting-panel"
import { VariablesPanel } from "@/modules/settings/components/variables-panel"
import type { SettingItem, SettingsCategoryId } from "@/modules/settings/types"
import { createSettingPatch, getSettingValue } from "@/modules/settings/utils"
import type { SynapseRepositoryConfig } from "@/types/config"

const logger = createRendererLogger("settings")

function SettingsModule() {
  const { config, error, isReady, refreshConfig, updateConfig } = useAppConfig()
  const activeRepository = useActiveRepository()
  const { replaceRepositories } = useRepositoryActions()
  const { promise, warning } = useAppNotifications()
  const [activeCategory, setActiveCategoryRaw] = useState<SettingsCategoryId>("general")
  const activeCategoryRef = useRef(activeCategory)
  activeCategoryRef.current = activeCategory
  const [isAdminMode, setIsAdminModeState] = useState(false)

  const setActiveCategory = useCallback((nextCategory: SettingsCategoryId) => {
    const prev = activeCategoryRef.current
    if (prev !== nextCategory) {
      logger.info("Settings category switched.", { from: prev, to: nextCategory })
    }
    setActiveCategoryRaw(nextCategory)
  }, [])

  const setIsAdminMode = useCallback((enabled: boolean) => {
    setIsAdminModeState(enabled)
  }, [])

  useEffect(() => {
    return subscribeOpenSettingsAbout(() => {
      setActiveCategory("about")
    })
  }, [setActiveCategory])

  useEffect(() => {
    return subscribeOpenSettingsStorage(() => {
      setActiveCategory("repositories")
    })
  }, [setActiveCategory])

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
    [promise, warning, updateConfig],
  )

  const handleSaveItem = useCallback(
    async (item: SettingItem, nextValue: unknown) => {
      const patch = createSettingPatch(item, nextValue, context)

      if (!patch) {
        warning("无法保存设置：不支持的设置项。")
        return
      }

      logger.info("Saving settings item.", {
        itemKey: item.key,
      })
      await applyPatch(patch)
    },
    [applyPatch, context, warning],
  )

  const handleSaveRepositories = useCallback(
    async (nextRepositories: SynapseRepositoryConfig[], activeRepoUuid: string | null) => {
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
    [promise, replaceRepositories],
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
      contentClassName="bg-surface p-4"
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
      <div className="flex flex-col gap-4">
        {activeCategory === "admin" && activeRepository ? (
          <p className="text-sm text-muted-foreground">
            {activeRepository.name}
          </p>
        ) : null}
        {error ? (
          <div className="flex items-center gap-3">
            <p className="text-sm text-destructive">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refreshConfig()}
            >
              重试
            </Button>
          </div>
        ) : null}

        {!isReady && !error ? (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                正在读取设置
              </div>
            </CardHeader>
          </Card>
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
        {isReady && activeCategory === "general" ? <AppResetPanel /> : null}

        {isReady && activeCategory === "repositories" ? (
          <RepositoryListEditor onSave={handleSaveRepositories} />
        ) : null}

        {isReady && activeCategory === "projects" ? (
          <ProjectListEditor projects={config.global.projects} onSave={handleSaveProjects} />
        ) : null}

        {isReady && activeCategory === "tools" ? <ToolsPanel /> : null}
        {isReady && activeCategory === "claude-code" ? <ClaudeCodePanel /> : null}
        {isReady && activeCategory === "variables" ? <VariablesPanel /> : null}
        {isReady && activeCategory === "services" ? <ServicesPanel /> : null}
        {isReady && activeCategory === "troubleshooting" ? <TroubleshootingPanel /> : null}

        {isReady && activeCategory === "admin" && activeRepository ? (
          <RepositoryMaintenancePanel repositoryUuid={activeRepository.uuid} />
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
