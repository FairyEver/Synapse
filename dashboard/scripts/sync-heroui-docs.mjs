import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const docsRoot = path.join(packageRoot, '.heroui-docs/react')
const sources = [
  ['apps/docs/content/docs/en/react/', 'docs/'],
  ['apps/docs/src/demos/en/', 'demos/'],
]

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Synapse-Dashboard-HeroUI-Docs' },
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw new Error(`HeroUI docs request failed (${response.status}): ${url}`)
  return response.text()
}

async function syncDocs() {
  // 只下载官方文档与示例文件；不克隆或复制上游代码仓库。
  const branch = JSON.parse(await fetchText('https://api.github.com/repos/heroui-inc/heroui/branches/v3'))
  const commit = branch.commit.sha
  if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error('Invalid HeroUI source commit')
  const tree = JSON.parse(await fetchText(`https://api.github.com/repos/heroui-inc/heroui/git/trees/${commit}?recursive=1`))
  if (tree.truncated) throw new Error('HeroUI documentation tree is incomplete')

  const files = tree.tree.flatMap((entry) => {
    if (entry.type !== 'blob') return []
    const source = sources.find(([prefix]) => entry.path.startsWith(prefix))
    if (!source || !/\.(?:mdx|md|json|tsx|ts|css)$/u.test(entry.path)) return []
    const relative = source[1] + entry.path.slice(source[0].length)
    if (relative.split('/').includes('..')) throw new Error(`Invalid documentation path: ${relative}`)
    return [{ relative, url: `https://raw.githubusercontent.com/heroui-inc/heroui/${commit}/${entry.path}` }]
  })
  if (!files.some((file) => file.relative.startsWith('docs/components/'))
    || !files.some((file) => file.relative.startsWith('demos/'))) {
    throw new Error('HeroUI React documentation or demos are missing')
  }

  for (const name of ['llms.txt', 'llms-full.txt', 'llms-components.txt', 'llms-patterns.txt']) {
    files.push({ relative: name, url: `https://heroui.com/react/${name}` })
  }

  let cursor = 0
  let completed = 0
  const results = await Promise.allSettled(Array.from({ length: 8 }, async () => {
    while (cursor < files.length) {
      const file = files[cursor++]
      const content = await fetchText(file.url)
      const destination = path.join(docsRoot, file.relative)
      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, content)
      completed += 1
      if (completed % 100 === 0) process.stdout.write(`HeroUI docs: ${completed}/${files.length}\n`)
    }
  }))
  const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason)
  if (errors.length > 0) throw new AggregateError(errors, 'HeroUI documentation sync failed')

  const docsCount = files.filter((file) => file.relative.startsWith('docs/')).length
  const demosCount = files.filter((file) => file.relative.startsWith('demos/')).length
  const index = [
    '# HeroUI React v3 官方文档与示例',
    '',
    `源提交：${commit}；文档 ${docsCount} 份，示例 ${demosCount} 份。`,
    '本地文件按官方源码路径保留分组；使用组件前先读文档，再按组件名查 demos。',
    '',
    ...files.map((file) => `- [${file.relative}](<./${file.relative}>)`),
    '',
  ].join('\n')
  await writeFile(path.join(docsRoot, 'INDEX.md'), index)
  await writeFile(path.join(docsRoot, 'manifest.json'), JSON.stringify({
    sourceCommit: commit,
    syncedAt: new Date().toISOString(),
    docsCount,
    demosCount,
    files: files.map((file) => file.relative),
  }, null, 2) + '\n')

  const rulesPath = path.join(packageRoot, 'CLAUDE.md')
  const rules = await readFile(rulesPath, 'utf8')
  const start = '<!-- HEROUI-REACT-AGENTS-MD-START -->'
  const end = '<!-- HEROUI-REACT-AGENTS-MD-END -->'
  const section = `${start}\n## HeroUI 本地文档索引\n\n- 根目录：\`.heroui-docs/react/\`\n- [完整索引](./.heroui-docs/react/INDEX.md)：组件、指南、发布说明及 demos。\n- 官方源提交：\`${commit}\`；文档 ${docsCount} 份，示例 ${demosCount} 份。\n- 刷新：\`pnpm --filter @synapse/dashboard docs:heroui:sync\`。\n${end}`
  const startIndex = rules.indexOf(start)
  const endIndex = rules.indexOf(end)
  if ((startIndex === -1) !== (endIndex === -1) || (startIndex !== -1 && endIndex < startIndex)) {
    throw new Error('HeroUI documentation index markers are malformed in CLAUDE.md')
  }
  const updated = startIndex === -1
    ? `${rules.trimEnd()}\n\n${section}\n`
    : rules.slice(0, startIndex) + section + rules.slice(endIndex + end.length)
  await writeFile(rulesPath, updated)
  process.stdout.write(`HeroUI docs ready: ${docsCount} documents, ${demosCount} demos; ${commit}\n`)
}

syncDocs().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`)
  if (error instanceof AggregateError) {
    for (const cause of error.errors) process.stderr.write(`${cause.stack ?? cause}\n`)
  }
  process.exitCode = 1
})
