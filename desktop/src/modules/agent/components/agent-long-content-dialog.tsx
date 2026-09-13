import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFrame,
  DialogFrameBody,
  DialogFrameFooter,
  DialogFrameHeader,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useAgentLongContent } from "../hooks/use-agent-long-content"

export function AgentLongContentDialog({
  projectId,
  conversationId,
  historyIndex,
}: {
  readonly projectId: string
  readonly conversationId: string
  readonly historyIndex: number
}) {
  const viewer = useAgentLongContent({ projectId, conversationId, historyIndex })

  return (
    <Dialog open={viewer.open} onOpenChange={viewer.onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          内容较长，查看全文
        </Button>
      </DialogTrigger>
      <DialogContent className="h-[min(80vh,48rem)] max-w-4xl p-0" showCloseButton={false}>
        <DialogFrame>
          <DialogFrameHeader title="完整内容" bordered />
          <DialogFrameBody>
            <ScrollArea className="h-full" viewportClassName="px-5 py-4">
              {viewer.error ? <Button variant="ghost" onClick={() => void viewer.retry()}>{viewer.error}</Button> : null}
              <pre className="whitespace-pre-wrap break-words text-sm">{viewer.loading ? "加载中" : viewer.content}</pre>
            </ScrollArea>
          </DialogFrameBody>
          <DialogFrameFooter>
            <Button
              type="button"
              variant="outline"
              disabled={viewer.loading || !viewer.canGoPrevious}
              onClick={() => void viewer.previous()}
            >
              {viewer.previousLabel}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={viewer.loading || !viewer.canGoNext}
              onClick={() => void viewer.next()}
            >
              下一段
            </Button>
          </DialogFrameFooter>
        </DialogFrame>
      </DialogContent>
    </Dialog>
  )
}
