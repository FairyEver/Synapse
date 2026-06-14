import { describe, expect, it, vi } from 'vitest'

import { createContentStoreDraftFromForm } from './content-store-create-page'

describe('createContentStoreDraftFromForm', () => {
  it('creates Skill drafts with the default SKILL.md file', async () => {
    const createDraft = vi.fn().mockResolvedValue({ itemId: 'item-1' })

    await expect(createContentStoreDraftFromForm({
      type: 'skill',
      title: '  My Skill  ',
      description: '  desc  ',
      body: '',
    }, createDraft)).resolves.toEqual({ itemId: 'item-1' })

    expect(createDraft).toHaveBeenCalledWith({
      type: 'skill',
      title: 'My Skill',
      description: 'desc',
      files: [{
        path: 'SKILL.md',
        contentBase64: 'IyBTa2lsbA==',
        mimeType: 'text/markdown',
      }],
    })
  })

  it('rejects incomplete non-Skill drafts before sending requests', async () => {
    const createDraft = vi.fn()

    await expect(createContentStoreDraftFromForm({
      type: 'prompt',
      title: 'Prompt',
      description: '',
      body: '   ',
    }, createDraft)).rejects.toThrow('正文不能为空')

    expect(createDraft).not.toHaveBeenCalled()
  })
})
