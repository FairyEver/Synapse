import { useCallback, useMemo, useState } from "react"
import { useAppConfig } from "@/app-shell/config"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { settingsCategories, settingsItems } from "@/modules/settings/data"
import { AboutPanel } from "@/modules/settings/components/about-panel"
import { ProjectListEditor } from "@/modules/settings/components/project-list-editor"
import { RepositoryListEditor } from "@/modules/settings/components/repository-list-editor"
import { SettingItemRow } from "@/modules/settings/components/setting-item-row"
import { SettingsCategorySidebar } from "@/modules/settings/components/settings-category-sidebar"
import type { SettingItem, SettingsCategoryId } from "@/modules/settings/types"
import { createSettingPatch, getSettingValue } from "@/modules/settings/utils"

function SettingsModule() {
  const { activeRepository, config, error, isReady, updateConfig } = useAppConfig()
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>("general")
  const [saveError, setSaveError] = useState<string | null>(null)
  const context = useMemo(
    () => ({
      config,
      activeRepository,
    }),
    [activeRepository, config],
  )

  const category = settingsCategories.find((item) => item.id === activeCategory) ?? settingsCategories[0]
  const categoryItems = useMemo(
    () =>
      settingsItems.filter(
        (item) => item.category === activeCategory && (item.visible ? item.visible(context) : true),
      ),
    [activeCategory, context],
  )
  const regularItems = categoryItems.filter((item) => item.type !== "list")
  const repositoriesItem = categoryItems.find((item) => item.key === "repositories")
  const projectsItem = categoryItems.find((item) => item.key === "global.projects")
  const aboutVersionItem = useMemo(
    () => settingsItems.find((item) => item.key === "app.version") ?? null,
    [],
  )

  const applyPatch = useCallback(
    async (patch: Parameters<typeof updateConfig>[0], reloadAfterUpdate = false) => {
      try {
        setSaveError(null)
        await updateConfig(patch)

        if (reloadAfterUpdate) {
          window.location.reload()
        }
      } catch (updateError) {
        setSaveError(updateError instanceof Error ? updateError.message : "保存设置失败。")
      }
    },
    [updateConfig],
  )

  const handleSaveItem = useCallback(
    async (item: SettingItem, nextValue: unknown) => {
      const patch = createSettingPatch(item, nextValue, context)

      if (!patch) {
        return
      }

      await applyPatch(patch)
    },
    [applyPatch, context],
  )

  const handleSaveRepositories = useCallback(
    async (repositories: typeof config.repositories, activeRepoUuid: string | null, reloadAfterUpdate: boolean) => {
      await applyPatch(
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
      await applyPatch({
        global: {
          projects,
        },
      })
    },
    [applyPatch],
  )

  const aboutVersion = aboutVersionItem
    ? String(getSettingValue(aboutVersionItem, context))
    : "0.0.0"

  return (
    <div className="flex h-full min-h-0">
      <SettingsCategorySidebar
        categories={settingsCategories}
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
      />

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold">{category.label}</h1>
            <p className="text-sm text-muted-foreground">{category.description}</p>
            {activeCategory === "content" && activeRepository ? (
              <p className="text-sm text-muted-foreground">
                当前仓库：{activeRepository.name}
              </p>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
          </div>

          {!isReady ? (
            <Card>
              <CardHeader>
                <CardTitle>加载设置</CardTitle>
                <CardDescription>正在读取本地 JSON 配置文件。</CardDescription>
              </CardHeader>
            </Card>
          ) : null}

          {isReady && activeCategory === "content" && activeRepository === null ? (
            <Card>
              <CardHeader>
                <CardTitle>还没有激活仓库</CardTitle>
                <CardDescription>
                  先到“仓库”分类添加并切换一个 Git 仓库，内容设置才会显示出来。
                </CardDescription>
              </CardHeader>
            </Card>
          ) : null}

          {isReady && regularItems.length > 0 ? (
            <Card>
              <CardContent className="flex flex-col">
                {regularItems.map((item, index) => (
                  <div key={item.key}>
                    {index > 0 ? <Separator /> : null}
                    <SettingItemRow
                      item={item}
                      value={getSettingValue(item, context)}
                      context={context}
                      onSave={handleSaveItem}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {isReady && repositoriesItem ? (
            <RepositoryListEditor
              item={repositoriesItem}
              repositories={config.repositories}
              activeRepoUuid={config.activeRepoUuid}
              onSave={handleSaveRepositories}
            />
          ) : null}

          {isReady && projectsItem ? (
            <ProjectListEditor
              item={projectsItem}
              projects={config.global.projects}
              onSave={handleSaveProjects}
            />
          ) : null}

          {isReady && activeCategory === "about" ? <AboutPanel version={aboutVersion} /> : null}
        </div>
      </div>
    </div>
  )
}

export { SettingsModule }
