import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const editorPagePath = fileURLToPath(
  new URL('./content-store-editor-page.tsx', import.meta.url)
)

describe('content store editor page layout', () => {
  it('keeps skill metadata in a side property panel', () => {
    const source = readFileSync(editorPagePath, 'utf8')
    const skillBranchStart = source.indexOf('{isSkill ? (')
    const skillBranchEnd = source.indexOf(') : (', skillBranchStart)
    const skillBranch = source.slice(skillBranchStart, skillBranchEnd)

    expect(source).toContain("aria-label='内容属性'")
    expect(skillBranch).toContain("lg:grid-cols-[20rem_minmax(0,1fr)_18rem]")
    expect(skillBranch).toContain('<ContentMetadataPanel')
    expect(skillBranch).not.toContain(
      "grid shrink-0 gap-4 rounded-lg border bg-card p-4 lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]"
    )
  })

  it('routes visibility changes through a confirmation dialog', () => {
    const source = readFileSync(editorPagePath, 'utf8')

    expect(source).toContain("import { ConfirmDialog } from '@/components/confirm-dialog'")
    expect(source).toContain('setVisibilityTarget')
    expect(source).toContain('<ConfirmDialog')
  })
})
