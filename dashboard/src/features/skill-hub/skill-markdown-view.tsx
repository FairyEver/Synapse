import 'github-markdown-css/github-markdown-light.css'
import { MARKDOWN_BODY_CLASSNAME } from '@/features/drive-browser/renderers/markdown-body-presentation'
import { cn } from '@/lib/utils'

const SKILL_MARKDOWN_CLASSNAME = cn(
  MARKDOWN_BODY_CLASSNAME,
  'bg-transparent! text-sm! leading-relaxed! text-foreground!',
  '[&_[data-skill-markdown-table-scroll="true"]]:max-w-full [&_[data-skill-markdown-table-scroll="true"]]:overflow-x-auto',
  '[&_h1]:mt-6! [&_h1]:mb-3! [&_h1]:border-0! [&_h1]:pb-0! [&_h1]:text-xl!',
  '[&_h2]:mt-6! [&_h2]:mb-2! [&_h2]:border-0! [&_h2]:pb-0! [&_h2]:text-lg!',
  '[&_h3]:mt-5! [&_h3]:mb-2! [&_h3]:text-base!',
  '[&>:first-child]:mt-0! [&>:last-child]:mb-0!',
)

export function SkillMarkdownView({ html }: { html: string }) {
  if (!html.trim()) return <p className="text-sm text-muted">空文件</p>
  return <article data-testid="skill-markdown-body" className={SKILL_MARKDOWN_CLASSNAME}
    dangerouslySetInnerHTML={{ __html: html }} />
}
