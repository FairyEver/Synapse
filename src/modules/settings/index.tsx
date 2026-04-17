import { useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const inputClassName =
  "h-11 w-full rounded-2xl border border-border/70 bg-white/90 px-4 text-sm text-foreground shadow-sm outline-none transition focus:border-primary/60 focus:ring-4 focus:ring-primary/10"

const selectClassName =
  "h-11 w-full rounded-2xl border border-border/70 bg-white/90 px-4 text-sm text-foreground shadow-sm outline-none transition focus:border-primary/60 focus:ring-4 focus:ring-primary/10"

const editorOptions = ["Cursor", "VS Code", "Claude Code"]
const refreshModes = ["手动刷新", "启动时检查", "空闲时提醒"]

export function SettingsModule() {
  const runtime = window.synapse
  const [repositoryName, setRepositoryName] = useState("Team Knowledge Hub")
  const [repositoryUrl, setRepositoryUrl] = useState("https://github.com/example/team-ai-repository")
  const [rulesDirectory, setRulesDirectory] = useState("rules")
  const [skillsDirectory, setSkillsDirectory] = useState("skills")
  const [preferredEditor, setPreferredEditor] = useState(editorOptions[0])
  const [refreshMode, setRefreshMode] = useState(refreshModes[0])
  const [showPreviewBanner, setShowPreviewBanner] = useState(true)

  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-6">
      <section className="overflow-hidden rounded-[30px] border border-white/80 bg-[linear-gradient(135deg,rgba(248,248,245,0.96),rgba(242,237,227,0.9))] shadow-[0_24px_90px_-46px_rgba(15,23,42,0.45)] backdrop-blur">
        <div className="grid gap-6 p-6 lg:grid-cols-[1.12fr_0.88fr] lg:p-8">
          <div className="space-y-5">
            <div className="inline-flex items-center rounded-full border border-primary/15 bg-white/70 px-3 py-1 text-[11px] font-semibold tracking-[0.24em] text-primary uppercase">
              Settings Module
            </div>

            <div className="space-y-3">
              <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-4xl">
                设置页开始承接仓库上下文与全局偏好
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
                这里先放入交互外壳和字段结构。真正的本地配置读写、仓库切换和持久化会在后续步骤接入。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button className="h-11 rounded-2xl px-5" variant="outline">
                保存设置占位
              </Button>
              <button
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition app-no-drag",
                  showPreviewBanner
                    ? "border-primary/25 bg-primary text-primary-foreground shadow-sm"
                    : "border-border/70 bg-white/85 text-muted-foreground hover:border-primary/25 hover:text-foreground",
                )}
                type="button"
                onClick={() => setShowPreviewBanner((current) => !current)}
              >
                {showPreviewBanner ? "引导提示已开启" : "引导提示已关闭"}
              </button>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/70 bg-white/74 p-5">
            <h2 className="text-lg font-semibold text-foreground">运行时信息</h2>
            <dl className="mt-4 space-y-3 text-sm text-muted-foreground">
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/75 px-4 py-3">
                <dt>平台</dt>
                <dd className="font-medium text-foreground">{runtime.platform}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/75 px-4 py-3">
                <dt>Electron</dt>
                <dd className="font-medium text-foreground">{runtime.versions.electron}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/75 px-4 py-3">
                <dt>Chromium</dt>
                <dd className="font-medium text-foreground">{runtime.versions.chrome}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/75 px-4 py-3">
                <dt>Node.js</dt>
                <dd className="font-medium text-foreground">{runtime.versions.node}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-[30px] border border-border/70 bg-white/76 p-5 shadow-[0_20px_80px_-48px_rgba(15,23,42,0.4)] backdrop-blur sm:p-6">
          <div className="grid gap-5">
            <div>
              <h2 className="text-xl font-semibold text-foreground">仓库上下文</h2>
              <p className="mt-2 text-sm text-muted-foreground">这一组设置会跟随未来的仓库切换能力一起变化。</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm text-muted-foreground">
                仓库名称
                <input
                  className={inputClassName}
                  value={repositoryName}
                  onChange={(event) => setRepositoryName(event.target.value)}
                />
              </label>

              <label className="grid gap-2 text-sm text-muted-foreground">
                默认编辑器
                <select
                  className={selectClassName}
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
                  className={inputClassName}
                  value={repositoryUrl}
                  onChange={(event) => setRepositoryUrl(event.target.value)}
                />
              </label>

              <label className="grid gap-2 text-sm text-muted-foreground">
                Rules 目录
                <input
                  className={inputClassName}
                  value={rulesDirectory}
                  onChange={(event) => setRulesDirectory(event.target.value)}
                />
              </label>

              <label className="grid gap-2 text-sm text-muted-foreground">
                Skills 目录
                <input
                  className={inputClassName}
                  value={skillsDirectory}
                  onChange={(event) => setSkillsDirectory(event.target.value)}
                />
              </label>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground">全局偏好</h3>
              <p className="mt-2 text-sm text-muted-foreground">这一组设置不跟随仓库切换，属于软件级偏好。</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm text-muted-foreground">
                刷新策略
                <select className={selectClassName} value={refreshMode} onChange={(event) => setRefreshMode(event.target.value)}>
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
                  <button
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition app-no-drag",
                      showPreviewBanner
                        ? "border-primary/25 bg-primary text-primary-foreground shadow-sm"
                        : "border-border/70 bg-white/85 text-muted-foreground hover:border-primary/25 hover:text-foreground",
                    )}
                    type="button"
                    onClick={() => setShowPreviewBanner(true)}
                  >
                    显示
                  </button>
                  <button
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition app-no-drag",
                      !showPreviewBanner
                        ? "border-primary/25 bg-primary text-primary-foreground shadow-sm"
                        : "border-border/70 bg-white/85 text-muted-foreground hover:border-primary/25 hover:text-foreground",
                    )}
                    type="button"
                    onClick={() => setShowPreviewBanner(false)}
                  >
                    隐藏
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <aside className="grid gap-4">
          <section className="rounded-[30px] border border-border/70 bg-white/76 p-5 backdrop-blur">
            <h2 className="text-lg font-semibold text-foreground">结构拆分</h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              Settings 模块现在独立存在，后续可以继续拆出仓库管理、凭证配置、更新检查等子区域，而不影响其他模块。
            </p>
          </section>

          <section className="rounded-[30px] border border-border/70 bg-[linear-gradient(180deg,rgba(247,240,222,0.92),rgba(235,244,236,0.9))] p-5">
            <h2 className="text-lg font-semibold text-foreground">后续接入点</h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              第 4、5、6、18 步会继续把本地配置系统、仓库管理、同步和应用内更新真正接进来。
            </p>
          </section>
        </aside>
      </section>
    </div>
  )
}
