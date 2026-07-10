import { createRendererLogger } from "@/app-shell/logging"
import { MarkdownViewer } from "@/components/markdown-viewer"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFrame,
  DialogFrameBody,
  DialogFrameHeader,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { toast } from "sonner"
import skillAuthoringGuideMarkdown from "./docs/skill-authoring-guide.md?raw"
import {
  loadSkillAuthoringGuide,
  type SkillAuthoringGuideLoadResult,
  type SkillAuthoringGuideSegment,
} from "./skill-authoring-guide"

const logger = createRendererLogger("resource-repository.skill-authoring-guide")
const guide = loadSkillAuthoringGuide(skillAuthoringGuideMarkdown)
if (guide.status === "error") {
  logger.error("Skill authoring guide load failed.", guide.error)
}

type SkillAuthoringGuideDialogProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

export function SkillAuthoringGuideDialog({ open, onOpenChange }: SkillAuthoringGuideDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-3xl"
        showCloseButton={false}
      >
        <DialogFrame className="max-h-[calc(100vh-2rem)]">
          <DialogFrameHeader title="Skill 开发指南" />
          <DialogFrameBody>
            <SkillAuthoringGuideContent guide={guide} />
          </DialogFrameBody>
        </DialogFrame>
      </DialogContent>
    </Dialog>
  )
}

export function SkillAuthoringGuideContent({
  guide,
}: {
  readonly guide: SkillAuthoringGuideLoadResult
}) {
  if (guide.status === "error") {
    return <p className="px-5 py-4 text-sm text-muted-foreground">指南加载失败</p>
  }

  return (
    <ScrollArea className="h-full min-h-0" data-track="skill-authoring-guide">
      <div className="space-y-6 px-5 py-4">
        {guide.segments.map((segment, index) => (
          <GuideSegment key={segment.kind === "prompt" ? segment.id : `markdown-${index}`} segment={segment} />
        ))}
      </div>
    </ScrollArea>
  )
}

function GuideSegment({ segment }: { readonly segment: SkillAuthoringGuideSegment }) {
  if (segment.kind === "markdown") {
    return <MarkdownViewer content={segment.content} showTabs={false} surface="plain" />
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{segment.title}</h2>
        <Button type="button" variant="outline" size="sm" onClick={() => void copyPrompt(segment.content)}>
          复制提示词
        </Button>
      </div>
      <pre
        data-allow-select="true"
        className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/40 p-4 font-mono text-[0.8125rem] leading-6 text-foreground select-text"
      >
        {segment.content}
      </pre>
    </section>
  )
}

async function copyPrompt(content: string): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) {
      logger.error("Skill authoring prompt copy failed.", {
        errorName: "ClipboardUnavailable",
        messageLength: 0,
      })
      toast.error("复制失败")
      return
    }

    await navigator.clipboard.writeText(content)
    toast.success("提示词已复制")
  } catch (error) {
    logger.error("Skill authoring prompt copy failed.", {
      errorName: error instanceof Error ? error.name : typeof error,
      messageLength: error instanceof Error ? error.message.length : 0,
    })
    toast.error("复制失败")
  }
}
