import { describe, expect, it } from 'vitest'
import {
  addSkillTextFile,
  addSkillTextFileWithPath,
  createInitialSkillFiles,
  deleteSkillFile,
  normalizeSkillFilePath,
  renameSkillFile,
  replaceSkillFileFromUpload,
  skillHasEntryFile,
  updateSkillTextFile,
} from './content-store-file-model'

describe('content store Skill file model', () => {
  it('normalizes safe relative paths', () => {
    expect(normalizeSkillFilePath(' docs\\guide.md ')).toBe('docs/guide.md')
    expect(() => normalizeSkillFilePath('/SKILL.md')).toThrow('文件路径无效')
    expect(() => normalizeSkillFilePath('../SKILL.md')).toThrow('文件路径无效')
    expect(() => normalizeSkillFilePath('docs//guide.md')).toThrow('文件路径无效')
  })

  it.each(['bad?name.md', 'a*b.txt', 'notes<draft>.md', 'docs/name /file.md', 'docs/CON.md', 'docs/control\u0001.md'])(
    'rejects Windows-hostile path %s',
    (path) => {
      expect(() => normalizeSkillFilePath(path)).toThrow('文件路径无效')
    }
  )

  it('initializes Skill drafts with one SKILL.md file', async () => {
    const files = await createInitialSkillFiles()

    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({
      path: 'SKILL.md',
      kind: 'text',
      mimeType: 'text/markdown',
    })
    expect(skillHasEntryFile(files)).toBe(true)
  })

  it('prevents duplicate paths and SKILL.md removal', async () => {
    const files = await createInitialSkillFiles()

    await expect(addSkillTextFile(files, 'SKILL.md')).rejects.toThrow('文件已存在')
    await expect(addSkillTextFile(files, 'skill.md')).rejects.toThrow('文件已存在')
    expect(() => deleteSkillFile(files, 'SKILL.md')).toThrow('不能删除 SKILL.md')
  })

  it('returns the newly added Skill file path after sorting files', async () => {
    const withGuide = await addSkillTextFile(await createInitialSkillFiles(), 'docs/a.md')
    const result = await addSkillTextFileWithPath(withGuide, ' docs/b.md ')

    expect(result.path).toBe('docs/b.md')
    expect(result.files.map((file) => file.path)).toEqual([
      'SKILL.md',
      'docs/a.md',
      'docs/b.md',
    ])
  })

  it('updates and renames text files except SKILL.md', async () => {
    const withFile = await addSkillTextFile(await createInitialSkillFiles(), 'docs/guide.md')
    const updated = await updateSkillTextFile(withFile, 'docs/guide.md', 'hello')
    const renamed = renameSkillFile(updated, 'docs/guide.md', 'docs/readme.md')

    expect(renamed.find((file) => file.path === 'docs/readme.md')).toMatchObject({
      kind: 'text',
      text: 'hello',
    })
    expect(() => renameSkillFile(renamed, 'SKILL.md', 'README.md')).toThrow('不能重命名 SKILL.md')
  })

  it('rejects case-only duplicate paths before saving', async () => {
    const files = await addSkillTextFile(await createInitialSkillFiles(), 'docs/Readme.md')

    await expect(addSkillTextFile(files, 'docs/readme.md')).rejects.toThrow('文件已存在')
    expect(() => renameSkillFile(files, 'docs/Readme.md', 'skill.md')).toThrow('文件已存在')
    await expect(
      replaceSkillFileFromUpload(
        files,
        new File(['next'], 'readme.md', { type: 'text/markdown' }),
        'docs/readme.md'
      )
    ).rejects.toThrow('文件已存在')
  })

  it('uploads and replaces binary files without text preview', async () => {
    const files = await createInitialSkillFiles()
    const uploaded = await replaceSkillFileFromUpload(files, new File([new Uint8Array([0, 1, 2])], 'asset.bin', {
      type: 'application/octet-stream',
    }))

    const asset = uploaded.find((file) => file.path === 'asset.bin')
    expect(asset).toMatchObject({
      path: 'asset.bin',
      kind: 'binary',
      bytesBase64: 'AAEC',
      size: 3,
      text: '',
    })
  })
})
