import { describe, expect, it } from 'vitest'
import {
  createInitialSkillFiles,
  replaceSkillFileFromUpload,
  updateSkillTextFile,
} from './content-store-file-model'
import {
  serializeDraftForCreate,
  serializeDraftForSave,
} from './content-store-draft-serialization'

describe('content store draft serialization', () => {
  it('serializes Skill text and binary files as strict base64', async () => {
    const files = await replaceSkillFileFromUpload(
      await updateSkillTextFile(await createInitialSkillFiles(), 'SKILL.md', '# Skill'),
      new File([new Uint8Array([0, 1, 2])], 'asset.bin', {
        type: 'application/octet-stream',
      })
    )

    const payload = serializeDraftForCreate({
      type: 'skill',
      title: 'Skill',
      description: '',
      body: '',
      files,
    })

    expect(payload).toEqual({
      type: 'skill',
      title: 'Skill',
      description: null,
      files: [
        { path: 'SKILL.md', contentBase64: 'IyBTa2lsbA==', mimeType: 'text/markdown' },
        { path: 'asset.bin', contentBase64: 'AAEC', mimeType: 'application/octet-stream' },
      ],
    })
  })

  it('serializes Rule and Prompt bodies without files', async () => {
    expect(serializeDraftForCreate({
      type: 'rule',
      title: 'Rule',
      description: 'Deploy',
      body: 'rule body',
      files: [],
    })).toEqual({
      type: 'rule',
      title: 'Rule',
      description: 'Deploy',
      body: 'rule body',
    })

    expect(serializeDraftForSave({
      type: 'prompt',
      title: 'Prompt',
      description: '',
      body: 'prompt body',
      files: [],
      baseRevision: 2,
    })).toEqual({
      type: 'prompt',
      baseRevision: 2,
      title: 'Prompt',
      description: null,
      body: 'prompt body',
    })
  })
})
