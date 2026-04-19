import { useMemo } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CodeIcon, EyeIcon } from "lucide-react"
import { renderMarkdown } from "@/lib/markdown"
import { cn } from "@/lib/utils"

type MarkdownViewerMode = "rendered" | "source"

type MarkdownViewerProps = {
  className?: string
  content: string
  mode?: MarkdownViewerMode
  showTabs?: boolean
}

const MARKDOWN_BODY_CLASSNAME = cn(
  "text-sm leading-6 text-foreground",
  "[&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4",
  "[&_blockquote]:border-l [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
  "[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.8125rem]",
  "[&_h1]:text-lg [&_h1]:font-semibold",
  "[&_h2]:text-base [&_h2]:font-semibold",
  "[&_h3]:font-medium",
  "[&_hr]:my-4 [&_hr]:border-border",
  "[&_img]:max-w-full",
  "[&_li>p]:my-1",
  "[&_ol]:list-decimal [&_ol]:pl-5",
  "[&_p]:break-words",
  "[&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted/40 [&_pre]:p-4",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_table]:w-full [&_table]:border-collapse",
  "[&_tbody_tr]:border-t [&_tbody_tr]:border-border",
  "[&_td]:align-top [&_td]:px-3 [&_td]:py-2",
  "[&_th]:border-b [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium",
  "[&_ul]:list-disc [&_ul]:pl-5",
  "[&_*+blockquote]:mt-4 [&_*+h1]:mt-6 [&_*+h2]:mt-6 [&_*+h3]:mt-5 [&_*+hr]:mt-6 [&_*+ol]:mt-3 [&_*+p]:mt-3 [&_*+pre]:mt-4 [&_*+table]:mt-4 [&_*+ul]:mt-3",
)

function MarkdownViewer({
  className,
  content,
  mode = "rendered",
  showTabs = true,
}: MarkdownViewerProps) {
  const renderedHtml = useMemo(() => renderMarkdown(content), [content])

  const handleRenderedClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target

    if (!(target instanceof HTMLElement)) {
      return
    }

    const link = target.closest("a")

    if (!link) {
      return
    }

    event.preventDefault()
  }

  const renderedContent = (
    <div
      data-allow-select="true"
      className="rounded-lg border border-border bg-muted/20 px-4 py-4"
      onClickCapture={handleRenderedClickCapture}
    >
      <div
        className={MARKDOWN_BODY_CLASSNAME}
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
    </div>
  )

  const sourceContent = (
    <div
      data-allow-select="true"
      className="rounded-lg border border-border bg-muted/20 px-4 py-4"
    >
      <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6 text-foreground">
        {content}
      </pre>
    </div>
  )

  if (!showTabs) {
    return mode === "source" ? sourceContent : renderedContent
  }

  return (
    <Tabs defaultValue="rendered" className={cn("gap-4", className)}>
      <TabsList className="mx-auto">
        <TabsTrigger value="rendered">
          <EyeIcon />
          预览
        </TabsTrigger>
        <TabsTrigger value="source">
          <CodeIcon />
          源码
        </TabsTrigger>
      </TabsList>

      <TabsContent value="rendered" className="mt-0">
        {renderedContent}
      </TabsContent>

      <TabsContent value="source" className="mt-0">
        {sourceContent}
      </TabsContent>
    </Tabs>
  )
}

export { MarkdownViewer }
export type { MarkdownViewerMode }
