import { describe, expect, it } from 'vitest'
import { getCodeEditorLanguage } from './code-editor-language'

describe('getCodeEditorLanguage', () => {
  it('maps common code and markdown file extensions to Monaco languages', () => {
    expect(getCodeEditorLanguage('SKILL.md')).toBe('markdown')
    expect(getCodeEditorLanguage('src/index.ts')).toBe('typescript')
    expect(getCodeEditorLanguage('src/app.tsx')).toBe('typescript')
    expect(getCodeEditorLanguage('scripts/run.mjs')).toBe('javascript')
    expect(getCodeEditorLanguage('config.yaml')).toBe('yaml')
    expect(getCodeEditorLanguage('page.html')).toBe('html')
    expect(getCodeEditorLanguage('style.css')).toBe('css')
    expect(getCodeEditorLanguage('unknown.txt')).toBe('markdown')
  })
})
