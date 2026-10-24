import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowLeft, Copy, Download, LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFrame, DialogFrameBody, DialogFrameFooter, DialogFrameHeader } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { AgentConversationTarget } from "@/types/agent-conversation-window"
import type { AgentShareSettings } from "@/types/agent-share"
import { AgentShareMessageBody } from "../components/agent-message-event"
import { GeneratedUiTheme } from "../openui/generated-ui-theme"
import { redactShareText } from "./redaction"
import type { AgentShareController } from "./use-agent-share"
import { useShareImageExport } from "./use-share-image-export"

function Toggle({ label, id, checked, onChange }: { label: string; id: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="flex items-center justify-between gap-4 py-2"><Label htmlFor={id} className="font-normal">{label}</Label><Switch id={id} checked={checked} onCheckedChange={onChange} /></div>
}

export function AgentSharePreviewDialog({ share, target }: { readonly share: AgentShareController; readonly target: AgentConversationTarget }) {
  const [paper, setPaper] = useState<HTMLElement | null>(null)
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ available: 620, height: 0 })
  const [fullSize, setFullSize] = useState(false)
  const frame = useRef<number | null>(null)
  const scope = `${target.projectId}:${target.conversationId}:${target.sessionKey}:${share.preview?.map((item) => item.id).join(",") ?? "closed"}`
  const output = useShareImageExport(scope)
  const settings = share.settings
  const zoom = fullSize ? 1 : Math.min(1, Math.max(0.1, (size.available - 64) / settings.width))
  const indexes = new Map(share.messages.map((item, index) => [item.id, index]))
  const change = <K extends keyof AgentShareSettings>(key: K, value: AgentShareSettings[K]) => share.setSettings((current) => ({ ...current, [key]: value }))
  useEffect(() => { setFullSize(false) }, [scope])
  useLayoutEffect(() => {
    if (!paper || !viewport) return
    const measure = () => {
      const next = { available: viewport.clientWidth, height: paper.offsetHeight }
      setSize((current) => current.available === next.available && current.height === next.height ? current : next)
    }
    const observer = new ResizeObserver(() => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() => { frame.current = null; measure() })
    })
    observer.observe(paper); observer.observe(viewport); measure()
    return () => { observer.disconnect(); if (frame.current !== null) cancelAnimationFrame(frame.current) }
  }, [paper, viewport])

  const open = share.active && share.preview !== null
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !output.busy) share.closePreview() }}>
    <DialogContent showCloseButton={false} className="h-[min(860px,90dvh)] w-[calc(100%-3rem)] max-w-6xl gap-0 p-0 sm:max-w-6xl" onEscapeKeyDown={(event) => { if (output.busy) event.preventDefault(); event.stopPropagation() }} onPointerDownOutside={(event) => { if (output.busy) event.preventDefault() }}>
      <DialogFrame>
        <DialogFrameHeader title="预览分享图片" description={`已选择 ${share.preview?.length ?? 0} 条消息`} bordered showCloseButton={!output.busy}
          leading={<Button type="button" variant="ghost" size="icon" aria-label="返回选择" disabled={!!output.busy} onClick={share.closePreview}><ArrowLeft /></Button>}
          actions={<Button type="button" variant="ghost" aria-pressed={fullSize} disabled={!!output.busy} onClick={() => setFullSize((current) => !current)} className="tabular-nums">{fullSize ? "100% · 适应宽度" : `${Math.round(zoom * 100)}%`}</Button>}
        />
        <DialogFrameBody className="flex overflow-hidden">
          <div ref={setViewport} tabIndex={0} aria-label="长图预览" className="min-h-0 min-w-0 flex-1 overflow-auto bg-surface p-8">
            <GeneratedUiTheme><div className="mx-auto" style={{ width: settings.width * zoom, height: size.height * zoom }}><div className="origin-top-left" style={{ width: settings.width, transform: `scale(${zoom})` }}>
              <article ref={setPaper} data-agent-share-paper className="overflow-hidden rounded-lg bg-background p-10 text-sm text-foreground [&_[data-streamdown=code-block-copy-button]]:hidden [&_[data-slot=scroll-area-scrollbar]]:hidden" style={{ width: settings.width }}>
                {settings.showTitle && <header className="mb-8 border-b pb-7"><h2 className="break-words text-2xl leading-snug font-semibold">{redactShareText(settings.title.trim() || "对话摘录", settings.redact)}</h2></header>}
                <div className="space-y-8">{share.preview?.map((message, index, all) => {
                  const previous = index > 0 ? indexes.get(all[index - 1]!.id) : undefined
                  const current = indexes.get(message.id)
                  const omitted = previous !== undefined && current !== undefined && current > previous + 1
                  const item = { ...message, content: redactShareText(message.content, settings.redact) }
                  return <Fragment key={message.id}>
                    {omitted && <div data-share-omission className="flex items-center gap-4 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />已省略内容<span className="h-px flex-1 bg-border" /></div>}
                    <section data-share-export-message={message.id}>
                      <AgentShareMessageBody item={item} projectId={target.projectId} conversationId={target.conversationId} hideEmails={settings.redact} />
                    </section>
                  </Fragment>
                })}</div>
                {settings.showBrand && <footer className="mt-10 flex items-center justify-between border-t pt-5 text-xs text-muted-foreground"><span className="font-medium">Synapse</span><span>对话摘录</span></footer>}
              </article>
            </div></div></GeneratedUiTheme>
          </div>
          <aside aria-label="图片设置" className="w-56 shrink-0 overflow-y-auto border-l bg-background p-5 sm:w-60"><fieldset disabled={!!output.busy} className="space-y-6">
            <h2 className="text-sm font-semibold">图片设置</h2>
            <div className="space-y-2"><p className="text-sm font-medium">清晰度</p><div role="group" aria-label="清晰度" className="flex gap-1 rounded-lg bg-muted p-1">{([2, 3] as const).map((scale) => <Button key={scale} type="button" className="flex-1" variant={settings.scale === scale ? "outline" : "ghost"} aria-pressed={settings.scale === scale} onClick={() => change("scale", scale)}>{scale === 2 ? "高清 2×" : "超清 3×"}</Button>)}</div></div>
            <div className="space-y-2"><p className="text-sm font-medium">版式宽度</p><div role="group" aria-label="版式宽度" className="flex gap-1 rounded-lg bg-muted p-1">{([720, 960] as const).map((width) => <Button key={width} type="button" className="flex-1" variant={settings.width === width ? "outline" : "ghost"} aria-pressed={settings.width === width} onClick={() => change("width", width)}>{width === 720 ? "标准" : "宽版"}</Button>)}</div></div>
            <div><Toggle label="显示标题" id="agent-share-title" checked={settings.showTitle} onChange={(value) => change("showTitle", value)} />{settings.showTitle && <Input aria-label="分享图片标题" maxLength={60} className="mt-2" value={settings.title} onChange={(event) => change("title", event.target.value)} />}</div>
            <div className="border-t pt-4"><Toggle label="隐藏邮箱" id="agent-share-email" checked={settings.redact} onChange={(value) => change("redact", value)} /><Toggle label="底部标识" id="agent-share-brand" checked={settings.showBrand} onChange={(value) => change("showBrand", value)} /></div>
          </fieldset></aside>
        </DialogFrameBody>
        {output.error && <div role="alert" className="border-t px-5 py-3 text-sm text-destructive">{output.error}</div>}
        <DialogFrameFooter className="flex-row items-center justify-between gap-3 bg-background sm:justify-between"><div className="text-xs leading-5 text-muted-foreground"><p className="tabular-nums">{settings.width * settings.scale} × {size.height * settings.scale} px · PNG</p><p>{settings.redact ? "邮箱已隐藏" : "包含邮箱地址"} · 仅在本机生成</p></div><div className="flex items-center gap-2"><Button type="button" variant="outline" disabled={!paper || !!output.busy} onClick={() => void output.run(paper, settings, "copy")}>{output.busy === "copy" ? <LoaderCircle className="animate-spin" /> : <Copy />}复制图片</Button><Button type="button" disabled={!paper || !!output.busy} onClick={() => void output.run(paper, settings, "save")}>{output.busy === "save" ? <LoaderCircle className="animate-spin" /> : <Download />}保存图片</Button></div></DialogFrameFooter>
      </DialogFrame>
    </DialogContent>
  </Dialog>
}
