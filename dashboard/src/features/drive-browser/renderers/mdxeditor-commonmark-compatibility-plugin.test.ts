import { addSyntaxExtension$ } from '@mdxeditor/editor'
import { describe, expect, it, vi } from 'vitest'
import {
  commonMarkLessThanOrEqualSyntaxExtension,
  commonMarkTextCompatibilityPlugin,
  commonMarkToMarkdownOptions,
} from './mdxeditor-commonmark-compatibility-plugin'

describe('MDXEditor CommonMark compatibility', () => {
  it('registers the text syntax extension with MDXEditor', () => {
    const pub = vi.fn()
    const plugin = commonMarkTextCompatibilityPlugin()

    plugin.init?.({ pub } as never)

    expect(pub).toHaveBeenCalledWith(addSyntaxExtension$, commonMarkLessThanOrEqualSyntaxExtension)
  })

  it('claims a less-than sign only when it starts a less-than-or-equal operator', () => {
    const tokenize = syntaxTokenizer()
    const effects = {
      enter: vi.fn(),
      consume: vi.fn(),
      exit: vi.fn(),
    }
    const ok = vi.fn()
    const nok = vi.fn()
    const afterLessThan = tokenize(effects as never, ok as never, nok as never)(60)

    expect(effects.enter).toHaveBeenCalledWith('data')
    expect(effects.consume).toHaveBeenCalledWith(60)
    afterLessThan(61)
    expect(effects.exit).toHaveBeenCalledWith('data')
    expect(ok).toHaveBeenCalledWith(61)
    expect(nok).not.toHaveBeenCalled()
  })

  it('keeps less-than-or-equal text unescaped when exporting ordinary Markdown', () => {
    const handler = commonMarkToMarkdownOptions.handlers?.text
    if (!handler) throw new Error('text handler not found')
    const safe = vi.fn(() => '金额 \\<= 1000')

    expect(handler(
      { type: 'text', value: '金额 <= 1000' },
      { type: 'paragraph', children: [] },
      { safe } as never,
      {} as never,
    )).toBe('金额 <= 1000')
  })
})

function syntaxTokenizer() {
  const construct = commonMarkLessThanOrEqualSyntaxExtension.text?.[60]
  const tokenizer = Array.isArray(construct) ? construct[0]?.tokenize : construct?.tokenize
  if (!tokenizer) throw new Error('less-than-or-equal tokenizer not found')
  return tokenizer
}
