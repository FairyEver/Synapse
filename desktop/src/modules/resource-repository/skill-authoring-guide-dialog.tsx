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

const logger = createRendererLogger("resource-repository.skill-authoring-guide")

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
          <DialogFrameHeader
            title="Skill 开发提示词"
            actions={(
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void copyPrompt(skillAuthoringGuideMarkdown)}
              >
                复制完整提示词
              </Button>
            )}
          />
          <DialogFrameBody>
            <SkillAuthoringGuideContent markdown={skillAuthoringGuideMarkdown} />
          </DialogFrameBody>
        </DialogFrame>
      </DialogContent>
    </Dialog>
  )
}

export function SkillAuthoringGuideContent({
  markdown,
}: {
  readonly markdown: string
}) {
  return (
    <ScrollArea className="h-full min-h-0" data-track="skill-authoring-guide">
      <div className="px-5 py-4">
        <MarkdownViewer content={markdown} showTabs={false} surface="plain" />
      </div>
    </ScrollArea>
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
