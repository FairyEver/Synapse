import type { ReactNode } from 'react'

const inline = /(!?\[[^\]\n]+\]\([^\n)]*\)|`[^`\n]+`|\*\*[^*\n]+\*\*)/gu
function phrase(value: string) {
  return value.split(inline).map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    const label = /^!?\[([^\]]+)\]\(/u.exec(part)
    // External links and images remain plain labels. Raw HTML is escaped by React.
    return label ? <span key={i}>{label[1]}</span> : part
  })
}

export function SkillMainView({ content }: { content: string }) {
  const lines = content.replace(/^\uFEFF/u, '').split(/\r?\n/u)
  const end = lines[0]?.trim() === '---' ? lines.findIndex((line, index) => index > 0 && line.trim() === '---') : -1
  const nodes: ReactNode[] = []
  let index = end + 1
  while (index < lines.length) {
    const line = lines[index], start = index++
    if (!line.trim()) continue
    const fence = /^\s*(`{3,}|~{3,})/u.exec(line)
    if (fence) {
      const code: string[] = []
      while (index < lines.length && !lines[index].trimStart().startsWith(fence[1])) code.push(lines[index++])
      index++
      nodes.push(<pre className="overflow-auto rounded-lg bg-surface-secondary p-4 text-sm" key={start}><code>{code.join('\n')}</code></pre>)
      continue
    }
    const heading = /^(#{1,6})\s+(.+)/u.exec(line)
    if (heading) {
      const Tag = heading[1].length === 1 ? 'h2' : heading[1].length === 2 ? 'h3' : 'h4'
      nodes.push(<Tag className="mt-3 text-lg font-semibold" key={start}>{phrase(heading[2])}</Tag>)
      continue
    }
    const list = /^\s*([-*+]|\d+[.)])\s+(.+)/u
    const item = list.exec(line)
    if (item) {
      const ordered = /^\d/u.test(item[1])
      const List = ordered ? 'ol' : 'ul'
      const items = [item[2]]
      while (index < lines.length) {
        const next = list.exec(lines[index])
        if (!next || /^\d/u.test(next[1]) !== ordered) break
        items.push(next[2]); index++
      }
      nodes.push(<List className={ordered ? 'list-decimal ps-6' : 'list-disc ps-6'} key={start}>
        {items.map((value, i) => <li key={i}>{phrase(value)}</li>)}
      </List>)
      continue
    }
    nodes.push(<p key={start}>{phrase(line)}</p>)
  }
  return <article className="grid min-w-0 gap-2 wrap-anywhere leading-relaxed">{nodes.length ? nodes : <p className="text-muted">没有说明</p>}</article>
}
