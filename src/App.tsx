import { MonitorCog, PackageCheck, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"

function App() {
  const runtime = window.synapse

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center p-6">
        <section className="w-full overflow-hidden rounded-[32px] border border-border/60 bg-card/95 shadow-2xl shadow-black/10 backdrop-blur">
          <div className="grid gap-10 p-8 md:grid-cols-[1.3fr_0.9fr] md:p-12">
            <div className="space-y-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-sm text-muted-foreground">
                <Sparkles className="size-4 text-primary" />
                Synapse Desktop Scaffold Ready
              </div>

              <div className="space-y-4">
                <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance md:text-5xl">
                  Electron + Vite + React + Tailwind + shadcn/ui 已初始化完成
                </h1>
                <p className="max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
                  当前仓库已经具备桌面壳层、React 渲染层、Tailwind v4 样式系统，以及可直接扩展的 shadcn/ui 组件基础设施。
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button size="lg">shadcn/ui Button 已接入</Button>
                <Button size="lg" variant="outline">
                  当前平台：{runtime.platform}
                </Button>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-2xl border border-border/70 bg-background/80 p-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                  <MonitorCog className="size-4 text-primary" />
                  Runtime
                </div>
                <dl className="space-y-2 text-sm text-muted-foreground">
                  <div className="flex items-center justify-between gap-4">
                    <dt>Electron</dt>
                    <dd className="font-medium text-foreground">{runtime.versions.electron}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt>Chromium</dt>
                    <dd className="font-medium text-foreground">{runtime.versions.chrome}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt>Node.js</dt>
                    <dd className="font-medium text-foreground">{runtime.versions.node}</dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-2xl border border-border/70 bg-background/80 p-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                  <PackageCheck className="size-4 text-primary" />
                  Next Step
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  你现在可以在这个基础模板上继续扩展 Rules、Skills、Settings 三大业务模块，而无需重做工程层初始化。
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

export default App
