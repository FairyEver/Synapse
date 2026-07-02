import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const editorPagePath = fileURLToPath(
  new URL('./content-store-editor-page.tsx', import.meta.url)
)

describe('content store editor page layout', () => {
  it('blocks legacy editing and links to Skill Repository', () => {
    const source = readFileSync(editorPagePath, 'utf8')

    expect(source).toContain("to='/skill-repositories'")
    expect(source).toContain('云端 Prompt 和 Rule 商店已停止维护')
    expect(source).not.toContain('useContentStoreDraftEditor')
    expect(source).not.toContain('<ContentStorePublishDialog')
    expect(source).not.toContain('<ConfirmDialog')
  })
})
