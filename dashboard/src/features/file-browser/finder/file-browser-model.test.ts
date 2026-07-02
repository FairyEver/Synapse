import { describe, expect, it } from 'vitest'
import { buildFileBrowserTree } from './file-browser-model'

const files = [
  sourceFile('skill', 'SKILL.md'),
  sourceFile('readme', 'README.md'),
  sourceFile('usage', 'docs/usage.md'),
  sourceFile('guide', 'docs/guide.md'),
  sourceFile('asset', 'assets/logo.png', 'binary'),
]

describe('buildFileBrowserTree', () => {
  it('derives root rows from flat file paths', () => {
    const tree = buildFileBrowserTree(files, '')

    expect(tree.breadcrumbs).toEqual([{ name: 'Root', path: '' }])
    expect(tree.rows.map((row) => row.type === 'folder' ? row.path : row.file.path)).toEqual([
      'assets',
      'docs',
      'README.md',
      'SKILL.md',
    ])
  })

  it('lists children for a virtual folder', () => {
    const tree = buildFileBrowserTree(files, 'docs')

    expect(tree.breadcrumbs).toEqual([
      { name: 'Root', path: '' },
      { name: 'docs', path: 'docs' },
    ])
    expect(tree.rows.map((row) => row.type === 'file' ? row.file.path : row.path)).toEqual([
      'docs/guide.md',
      'docs/usage.md',
    ])
  })

  it('can prioritize a root file without hard-coding its name', () => {
    const tree = buildFileBrowserTree(files, '', { priorityFilePath: 'SKILL.md' })

    expect(tree.rows.map((row) => row.type === 'file' ? row.file.path : row.path)).toEqual([
      'SKILL.md',
      'assets',
      'docs',
      'README.md',
    ])
  })

  it('rejects duplicate paths case-insensitively', () => {
    expect(() => buildFileBrowserTree([
      sourceFile('a', 'README.md'),
      sourceFile('b', 'readme.md'),
    ], '')).toThrow('Duplicate file path')
  })
})

function sourceFile(id: string, path: string, kind: 'text' | 'binary' = 'text') {
  return {
    id,
    path,
    size: 10,
    updatedAt: '2026-07-02T00:00:00.000Z',
    kind,
  }
}
