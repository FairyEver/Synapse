import { useState } from "react"
import { ModuleHero, ModuleNote, ModulePanel } from "@/components/module-layout"
import { Button } from "@/components/ui/button"
import { getSynapseRuntime } from "@/lib/runtime"

const editorOptions = ["Cursor", "VS Code", "Claude Code"]
const refreshModes = ["手动刷新", "启动时检查", "空闲时提醒"]

export function SettingsModule() {
  const runtime = getSynapseRuntime()
  const [repositoryName, setRepositoryName] = useState("Team Knowledge Hub")
  const [repositoryUrl, setRepositoryUrl] = useState("https://github.com/example/team-ai-repository")
  const [rulesDirectory, setRulesDirectory] = useState("rules")
  const [skillsDirectory, setSkillsDirectory] = useState("skills")
  const [preferredEditor, setPreferredEditor] = useState(editorOptions[0])
  const [refreshMode, setRefreshMode] = useState(refreshModes[0])
  const [showPreviewBanner, setShowPreviewBanner] = useState(true)

  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-6">
      <ModuleHero
        description="把仓库上下文和全局偏好分成更清楚的两组设置，减少装饰噪音，让表单本身更好读。"
        eyebrow="Settings"
        metrics={[
          {
            label: "运行平台",
            value: runtime.platform,
            description: "当前壳层正在读取 preload 暴露的运行时信息。",
          },
          {
            label: "默认编辑器",
            value: preferredEditor,
            description: "作为当前应用偏好的默认编辑器选择。",
          },
          {
            label: "刷新策略",
            value: refreshMode,
            description: "保持软件级偏好与仓库级设置分离。",
          },
        ]}
        title="整理仓库信息与全局偏好"
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_20rem]">
        <div className="grid gap-4">
          <ModulePanel
            description="这一组信息跟随仓库上下文变化，主要承接仓库名称、地址和目录约定。"
            title="仓库上下文"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm text-muted-foreground">
                仓库名称
                <input
                  className="field-control"
                  value={repositoryName}
                  onChange={(event) => setRepositoryName(event.target.value)}
                />
              </label>

              <label className="grid gap-2 text-sm text-muted-foreground">
                默认编辑器
                <select
                  className="field-control"
                  value={preferredEditor}
                  onChange={(event) => setPreferredEditor(event.target.value)}
                >
                  {editorOptions.map((editor) => (
                    <option key={editor} value={editor}>
                      {editor}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2 text-sm text-muted-foreground md:col-span-2">
                Git 仓库地址
                <input
                  className="field-control"
                  value={repositoryUrl}
                  onChange={(event) => setRepositoryUrl(event.target.value)}
                />
              </label>

              <label className="grid gap-2 text-sm text-muted-foreground">
                Rules 目录
                <input
                  className="field-control"
                  value={rulesDirectory}
                  onChange={(event) => setRulesDirectory(event.target.value)}
                />
              </label>

              <label className="grid gap-2 text-sm text-muted-foreground">
                Skills 目录
                <input
                  className="field-control"
                  value={skillsDirectory}
                  onChange={(event) => setSkillsDirectory(event.target.value)}
                />
              </label>
            </div>
          </ModulePanel>

          <ModulePanel
            description="这一组偏好属于应用层，不应和单个仓库的配置混在一起。"
            title="应用偏好"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm text-muted-foreground">
                刷新策略
                <select className="field-control" value={refreshMode} onChange={(event) => setRefreshMode(event.target.value)}>
                  {refreshModes.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-2 text-sm text-muted-foreground">
                新手引导
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="pill"
                    type="button"
                    variant={showPreviewBanner ? "default" : "secondary"}
                    onClick={() => setShowPreviewBanner(true)}
                  >
                    显示
                  </Button>
                  <Button
                    size="pill"
                    type="button"
                    variant={!showPreviewBanner ? "default" : "secondary"}
                    onClick={() => setShowPreviewBanner(false)}
                  >
                    隐藏
                  </Button>
                </div>
              </div>
            </div>
          </ModulePanel>
        </div>

        <div className="grid gap-4">
          <ModuleNote title="运行时信息">
            <dl className="space-y-3 text-sm leading-6 text-muted-foreground">
              <div className="flex items-center justify-between gap-3">
                <dt>Electron</dt>
                <dd className="text-foreground">{runtime.versions.electron}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>Chromium</dt>
                <dd className="text-foreground">{runtime.versions.chrome}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>Node.js</dt>
                <dd className="text-foreground">{runtime.versions.node}</dd>
              </div>
            </dl>
          </ModuleNote>

          <ModuleNote title="当前表单状态" tone="muted">
            <dl className="space-y-3 text-sm leading-6 text-muted-foreground">
              <div className="flex items-center justify-between gap-3">
                <dt>仓库名</dt>
                <dd className="max-w-[10rem] truncate text-foreground">{repositoryName}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>刷新策略</dt>
                <dd className="text-foreground">{refreshMode}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>新手引导</dt>
                <dd className="text-foreground">{showPreviewBanner ? "显示" : "隐藏"}</dd>
              </div>
            </dl>
          </ModuleNote>
        </div>
      </div>
    </div>
  )
}
