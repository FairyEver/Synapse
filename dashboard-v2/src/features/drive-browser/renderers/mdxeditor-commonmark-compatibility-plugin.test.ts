import {
  addExportVisitor$,
  addImportVisitor$,
  addLexicalNode$,
  addMdastExtension$,
  addSyntaxExtension$,
  lexical,
} from '@mdxeditor/editor'
import { describe, expect, it, vi } from 'vitest'
import {
  commonMarkLessThanOrEqualSyntaxExtension,
  commonMarkHtmlCommentFromMarkdownExtension,
  commonMarkTextCompatibilityPlugin,
  commonMarkToMarkdownOptions,
  htmlCommentExportVisitor,
  htmlCommentImportVisitor,
  HtmlCommentNode,
  CommentExcludedHtmlBlockNode,
  commentExcludedHtmlBlockImportVisitor,
  commonMarkHardBreakExportVisitor,
  CommentExcludedParagraphBreakNode,
  commentAwareParagraphImportVisitor,
  commentExcludedParagraphBreakExportVisitor,
  prepareCommonMarkForMdxEditor,
} from './mdxeditor-commonmark-compatibility-plugin'

describe('MDXEditor CommonMark compatibility', () => {
  it('registers the text syntax extension with MDXEditor', () => {
    const pub = vi.fn()
    const plugin = commonMarkTextCompatibilityPlugin()

    plugin.init?.({ pub } as never)

    expect(pub).toHaveBeenCalledWith(addSyntaxExtension$, commonMarkLessThanOrEqualSyntaxExtension)
    expect(pub).toHaveBeenCalledWith(addMdastExtension$, commonMarkHtmlCommentFromMarkdownExtension)
    expect(pub).toHaveBeenCalledWith(addLexicalNode$, HtmlCommentNode)
    expect(pub).toHaveBeenCalledWith(addLexicalNode$, CommentExcludedHtmlBlockNode)
    expect(pub).toHaveBeenCalledWith(addLexicalNode$, CommentExcludedParagraphBreakNode)
    expect(pub).toHaveBeenCalledWith(addImportVisitor$, htmlCommentImportVisitor)
    expect(pub).toHaveBeenCalledWith(addImportVisitor$, commentExcludedHtmlBlockImportVisitor)
    expect(pub).toHaveBeenCalledWith(addImportVisitor$, commentAwareParagraphImportVisitor)
    expect(pub).toHaveBeenCalledWith(addExportVisitor$, htmlCommentExportVisitor)
    expect(pub).toHaveBeenCalledWith(addExportVisitor$, commonMarkHardBreakExportVisitor)
    expect(pub).toHaveBeenCalledWith(addExportVisitor$, commentExcludedParagraphBreakExportVisitor)
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
    const safe = vi.fn(() => '金额 \\<\\= 1000')

    expect(handler(
      { type: 'text', value: '金额 <= 1000' },
      { type: 'paragraph', children: [] },
      { safe } as never,
      {} as never,
    )).toBe('金额 <= 1000')
  })

  it('normalizes CommonMark autolinks and comparisons only outside code', () => {
    const source = [
      '<https://example.com/a?q=1>',
      '联系 <user@example.com>，金额 <= 1000。',
      '[现有链接](<https://example.com/existing>)',
      '',
      '`<https://example.com/code> <=`',
      '',
      '```md',
      '<https://example.com/fenced>',
      '<= 2000',
      '```',
    ].join('\n')

    expect(prepareCommonMarkForMdxEditor(source)).toEqual({
      markdown: [
        '[https://example.com/a?q=1](<https://example.com/a?q=1>)',
        '联系 [user@example.com](<mailto:user@example.com>)，金额 \\<= 1000。',
        '[现有链接](<https://example.com/existing>)',
        '',
        '`<https://example.com/code> <=`',
        '',
        '```md',
        '<https://example.com/fenced>',
        '<= 2000',
        '```',
      ].join('\n'),
      requiresSourceMode: false,
    })
  })

  it('escapes programming-language generics only for rich-text parsing', () => {
    const source = [
      'Controller 返回 CommonResult<PageResult<VehicleCallOrderRespVO>>。',
      '字段为 List<OrderDTO> orderList 和 Map<String, List<OrderDTO>>。',
      '普通比较 a<b 保持不变。',
      '<span>raw html</span>',
      '',
      '`CommonResult<PageResult<VehicleCallOrderRespVO>>`',
      '',
      '```java',
      'CommonResult<PageResult<VehicleCallOrderRespVO>> result;',
      '```',
    ].join('\n')

    expect(prepareCommonMarkForMdxEditor(source)).toEqual({
      markdown: [
        'Controller 返回 CommonResult\\<PageResult\\<VehicleCallOrderRespVO>>。',
        '字段为 List\\<OrderDTO> orderList 和 Map\\<String, List\\<OrderDTO>>。',
        '普通比较 a<b 保持不变。',
        '<span>raw html</span>',
        '',
        '`CommonResult<PageResult<VehicleCallOrderRespVO>>`',
        '',
        '```java',
        'CommonResult<PageResult<VehicleCallOrderRespVO>> result;',
        '```',
      ].join('\n'),
      requiresSourceMode: false,
    })
  })

  it('lets MDXEditor parse indented code and raw HTML before falling back to source mode', () => {
    for (const markdown of [
      '    <https://example.com>',
      '1. list item\n\n       indented code',
      '<!doctype html>',
      '<?xml version="1.0"?>',
      '<![CDATA[x < y]]>',
      '<span>raw html</span>',
      '<img src="image.png">',
    ]) {
      expect(prepareCommonMarkForMdxEditor(markdown)).toEqual({
        markdown,
        requiresSourceMode: false,
      })
    }
  })

  it('does not force marker-only nested list items into source mode', () => {
    const markdown = [
      '   1. 一级',
      '      1. 二级',
      '         二级说明',
      '      2.',
      '',
      '   2. 一级第二项',
    ].join('\n')

    expect(prepareCommonMarkForMdxEditor(markdown)).toEqual({
      markdown,
      requiresSourceMode: false,
    })
  })

  it('keeps HTML comments eligible for rich mode', () => {
    const markdown = [
      '正文 <!-- <https://example.com> <= <br> -->',
      '',
      '<!-- block',
      '<user@example.com> <= <br>',
      'comment -->',
    ].join('\n')

    expect(prepareCommonMarkForMdxEditor(markdown)).toEqual({
      markdown,
      requiresSourceMode: false,
    })
  })

  it('keeps supported break tags in rich mode without touching code examples', () => {
    const markdown = [
      '第一行<br>第二行',
      '',
      '`<br>`',
      '',
      '```html',
      '<br>',
      '```',
    ].join('\n')

    expect(prepareCommonMarkForMdxEditor(markdown)).toEqual({
      markdown: [
        '第一行<br />第二行',
        '',
        '`<br>`',
        '',
        '```html',
        '<br>',
        '```',
      ].join('\n'),
      requiresSourceMode: false,
    })
  })

  it('uses source mode when one list mixes plain and task items', () => {
    const markdown = [
      '- plain item',
      '- [x] task item',
    ].join('\n')

    expect(prepareCommonMarkForMdxEditor(markdown)).toEqual({
      markdown,
      requiresSourceMode: true,
    })
    expect(prepareCommonMarkForMdxEditor([
      '- plain item',
      '',
      'Separate paragraph',
      '',
      '- [x] task item',
    ].join('\n')).requiresSourceMode).toBe(false)
  })

  it('adds comment-excluded separators between loose list item paragraphs', () => {
    const editor = lexical.createEditor({
      nodes: [CommentExcludedParagraphBreakNode],
      onError(error) {
        throw error
      },
    })
    const visitChildren = vi.fn()
    const paragraph = { type: 'paragraph', children: [] }
    const mdastParent = {
      type: 'listItem',
      children: [{ type: 'paragraph', children: [] }, paragraph],
    }

    editor.update(() => {
      const lexicalParent = lexical.$createParagraphNode()
      lexical.$getRoot().append(lexicalParent)
      vi.spyOn(lexicalParent, 'getType').mockReturnValue('listitem')

      commentAwareParagraphImportVisitor.visitNode({
        mdastNode: paragraph,
        mdastParent,
        lexicalParent,
        actions: { visitChildren },
      } as never)

      expect(lexicalParent.getChildren()).toHaveLength(2)
      expect(lexicalParent.getChildren().every(
        (node) => node instanceof CommentExcludedParagraphBreakNode,
      )).toBe(true)
      expect(visitChildren).toHaveBeenCalledWith(paragraph, lexicalParent)
    }, { discrete: true })
  })
})

function syntaxTokenizer() {
  const construct = commonMarkLessThanOrEqualSyntaxExtension.text?.[60]
  const tokenizer = Array.isArray(construct) ? construct[0]?.tokenize : construct?.tokenize
  if (!tokenizer) throw new Error('less-than-or-equal tokenizer not found')
  return tokenizer
}
