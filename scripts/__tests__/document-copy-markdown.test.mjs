import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildCopyMarkdown,
  escapeCopyMarkdown,
  restoreCopyMarkdown
} from '../../document/.vitepress/copy-markdown.mjs'

test('copies readable homepage Markdown instead of VitePress frontmatter', () => {
  const markdown = buildCopyMarkdown(
    `---
layout: home
---`,
    {
      layout: 'home',
      hero: {
        name: 'Synapse',
        text: '跨编辑器 AI 能力管理工具',
        tagline: '管理 Rule、Skill、Prompt、Agent 与自动化任务。',
        actions: [{ text: '查看开放接口', link: '/open-api/' }]
      }
    }
  )

  assert.equal(
    markdown,
    `# Synapse 跨编辑器 AI 能力管理工具

管理 Rule、Skill、Prompt、Agent 与自动化任务。

[查看开放接口](/open-api/)
`
  )
  assert.doesNotMatch(markdown, /layout:\s*home/u)
})

test('removes frontmatter while preserving ordinary document content', () => {
  assert.equal(
    buildCopyMarkdown(`---
title: 示例
---
# 示例

正文
`, { title: '示例' }),
    `# 示例

正文
`
  )
})

test('preserves leading Markdown content when the page has no frontmatter', () => {
  const markdown = `    const value = true

正文
`

  assert.equal(buildCopyMarkdown(markdown), markdown)
})

test('bijective and lossless escaping of closing script tags, case variations and literal backslash escapes', () => {
  const cases = [
    '<script>console.log("hello")</script>',
    '<SCRIPT>console.log("HELLO")</SCRIPT>',
    '<sCrIpT>console.log("mixed")</sCrIpT>',
    'Literal escaped: <\\/script> should not be touched',
    'Multiple tags: </script> and </SCRIPT> and <\\/script>',
    'Sentinel literal: __SYNAPSE_ESC_ and __SYNAPSE_ESC_L_ and __SYNAPSE_ESC_S_123_',
  ]

  for (const raw of cases) {
    const escaped = escapeCopyMarkdown(raw)
    // Escaped string must NOT contain any case-insensitive </script
    assert.doesNotMatch(escaped, /<\/script/iu)
    // Restoring must return the exact original string byte-for-byte
    const restored = restoreCopyMarkdown(escaped)
    assert.equal(restored, raw)
  }
})
