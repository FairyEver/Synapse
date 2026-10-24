import { ChevronRight, LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AgentComposerInputBox } from "../components/agent-composer-input-box"
import type { AgentShareController } from "./use-agent-share"

export function AgentShareSelectionBar({ share }: { readonly share: AgentShareController }) {
  return <div className="absolute inset-x-4 bottom-5 z-10 mx-auto max-w-2xl md:inset-x-20" data-agent-share-selection-bar>
    <AgentComposerInputBox
      editor={<div className="px-2 py-1">
        <div className="flex min-h-9 items-center justify-between gap-2"><span className="text-sm font-medium" aria-live="polite">已选择 {share.selected.size} 条消息</span><div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{share.loading ? "正在加载历史消息" : "Shift 连选"}</span><Button type="button" variant="ghost" onClick={share.exit}>取消</Button></div></div>
        {share.error && <div role="alert" className="flex items-center justify-between gap-2 text-sm text-destructive"><span>{share.error}</span>{!share.complete && <Button type="button" variant="ghost" disabled={share.loading} onClick={share.retryHistory}>重试</Button>}</div>}
      </div>}
      leadingActions={<div className="flex flex-wrap gap-0.5"><Button type="button" variant="ghost" disabled={share.loading || !share.complete} onClick={() => share.preset("all")}>全选</Button><Button type="button" variant="ghost" disabled={share.loading || !share.complete} onClick={() => share.preset("ai")}>仅 AI</Button><Button type="button" variant="ghost" onClick={() => share.preset("latest")}>最近一轮</Button><Button type="button" variant="ghost" onClick={() => share.preset("clear")}>清空</Button></div>}
      trailingActions={<Button type="button" disabled={!share.selected.size || share.preparing} onClick={() => void share.openPreview()}>{share.preparing ? <LoaderCircle className="animate-spin" /> : null}预览图片<ChevronRight /></Button>}
    />
  </div>
}
