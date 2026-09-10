import { describe, expect, it } from 'vitest'
import {
  preserveMilkdownCommonMarkAutolinks,
  requiresMilkdownSourceMode,
} from './milkdown-markdown-compatibility'

describe('Milkdown Markdown compatibility', () => {
  it.each([
    '> ```md\n> [docs]: /inside-code\n> ```',
    '- ~~~md\n  [docs]: /inside-code\n  ~~~~',
  ])('ignores reference definitions inside container-nested fences: %s', (markdown) => {
    expect(requiresMilkdownSourceMode(markdown)).toBe(false)
  })

  it('only closes a fence with a matching marker of sufficient length and no trailing content', () => {
    const unclosedFence = [
      '````md',
      '```',
      '[short]: /inside-code',
      '~~~~',
      '[mismatch]: /inside-code',
      '```` trailing',
      '[trailing]: /inside-code',
    ].join('\n')

    expect(requiresMilkdownSourceMode(unclosedFence)).toBe(false)
    expect(requiresMilkdownSourceMode(`${unclosedFence}\n\`\`\`\`\n[outside]: /reference`)).toBe(true)
  })

  it('uses the same fenced-container boundary for autolink restoration and preserves CRLF', () => {
    const source = [
      '> ```md',
      '> https://inside.example test@inside.example',
      '> ```',
      'Outside https://outside.example test@outside.example',
    ].join('\r\n')
    const serialized = [
      '> ```md',
      '> <https://inside.example> <test@inside.example>',
      '> ```',
      'Outside <https://outside.example> <test@outside.example>',
    ].join('\r\n')

    expect(preserveMilkdownCommonMarkAutolinks(serialized, source)).toBe([
      '> ```md',
      '> <https://inside.example> <test@inside.example>',
      '> ```',
      'Outside https://outside.example test@outside.example',
    ].join('\r\n'))
  })

  it('leaves inline code and explicit autolinks unchanged while restoring bare prose autolinks', () => {
    expect(preserveMilkdownCommonMarkAutolinks(
      'See <https://bare.example> `<https://code.example>` <https://explicit.example>',
      'See https://bare.example `https://code.example` <https://explicit.example>',
    )).toBe('See https://bare.example `<https://code.example>` <https://explicit.example>')
  })
})
