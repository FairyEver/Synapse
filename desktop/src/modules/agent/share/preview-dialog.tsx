import { AgentSharePaper } from "./share-paper"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowLeft, Copy, Download, LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFrame, DialogFrameBody, DialogFrameFooter, DialogFrameHeader } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { AgentConversationTarget } from "@/types/agent-conversation-window"
import type { AgentShareSettings } from "@/types/agent-share"
import { GeneratedUiTheme } from "../openui/generated-ui-theme"
import type { AgentShareController } from "./use-agent-share"

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
  const output = share.output
  const { run } = output
  const { closePreview, exportAction } = share
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

  useEffect(() => {
    if (!paper || !exportAction) return
    let current = true
    void run(paper, settings, exportAction).then(() => { if (current) closePreview() })
    return () => { current = false }
  }, [paper, exportAction, run, settings, closePreview])

  const sharePaper = <AgentSharePaper paperRef={setPaper} messages={share.preview ?? []} settings={settings} target={target} indexes={indexes} />
  if (share.active && share.preview && exportAction) {
    return <div aria-hidden="true" inert className="pointer-events-none fixed -left-[20000px] top-0"><GeneratedUiTheme>{sharePaper}</GeneratedUiTheme></div>
  }
  const open = share.active && share.preview !== null && !exportAction
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
              {sharePaper}
            </div></div></GeneratedUiTheme>
          </div>
          <aside aria-label="图片设置" className="w-56 shrink-0 overflow-y-auto border-l bg-background p-5 sm:w-60"><fieldset disabled={!!output.busy} className="space-y-6">
            <h2 className="text-sm font-semibold">图片设置</h2>
            <div className="space-y-2"><p className="text-sm font-medium">清晰度</p><div role="group" aria-label="清晰度" className="flex gap-1 rounded-lg bg-muted p-1">{([2, 3] as const).map((scale) => <Button key={scale} type="button" className="flex-1" variant={settings.scale === scale ? "outline" : "ghost"} aria-pressed={settings.scale === scale} onClick={() => change("scale", scale)}>{scale === 2 ? "高清 2×" : "超清 3×"}</Button>)}</div></div>
            <div className="space-y-2"><p className="text-sm font-medium">版式宽度</p><div role="group" aria-label="版式宽度" className="flex gap-1 rounded-lg bg-muted p-1">{([720, 960] as const).map((width) => <Button key={width} type="button" className="flex-1" variant={settings.width === width ? "outline" : "ghost"} aria-pressed={settings.width === width} onClick={() => change("width", width)}>{width === 720 ? "标准" : "宽版"}</Button>)}</div></div>
            <div className="border-t pt-4"><Toggle label="显示模型" id="agent-share-model" checked={settings.showModel} onChange={(value) => change("showModel", value)} /><Toggle label="显示时间" id="agent-share-time" checked={settings.showTime} onChange={(value) => change("showTime", value)} /><Toggle label="隐藏邮箱" id="agent-share-email" checked={settings.redact} onChange={(value) => change("redact", value)} /></div>
          </fieldset></aside>
        </DialogFrameBody>
        {output.error && <div role="alert" className="border-t px-5 py-3 text-sm text-destructive">{output.error}</div>}
        <DialogFrameFooter className="flex-row items-center justify-between gap-3 bg-background sm:justify-between"><div className="text-xs leading-5 text-muted-foreground"><p className="tabular-nums">{settings.width * settings.scale} × {size.height * settings.scale} px · PNG</p><p>{settings.redact ? "邮箱已隐藏" : "包含邮箱地址"} · 仅在本机生成</p></div><div className="flex items-center gap-2"><Button type="button" variant="outline" disabled={!paper || !!output.busy} onClick={() => void output.run(paper, settings, "copy")}>{output.busy === "copy" ? <LoaderCircle className="animate-spin" /> : <Copy />}复制图片</Button><Button type="button" disabled={!paper || !!output.busy} onClick={() => void output.run(paper, settings, "save")}>{output.busy === "save" ? <LoaderCircle className="animate-spin" /> : <Download />}下载图片</Button></div></DialogFrameFooter>
      </DialogFrame>
    </DialogContent>
  </Dialog>
}
