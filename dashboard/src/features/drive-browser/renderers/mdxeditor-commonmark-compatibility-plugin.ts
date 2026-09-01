import {
  addSyntaxExtension$,
  realmPlugin,
} from '@mdxeditor/editor'
import type {
  FromMarkdownOptions,
  ToMarkdownOptions,
} from '@mdxeditor/editor'

type MarkdownSyntaxExtension = NonNullable<FromMarkdownOptions['extensions']>[number]

export type PreparedCommonMark = {
  readonly markdown: string
  readonly requiresSourceMode: boolean
}

const LESS_THAN_CODE = 60
const EQUALS_CODE = 61

export const commonMarkLessThanOrEqualSyntaxExtension = {
  text: {
    [LESS_THAN_CODE]: {
      tokenize(effects, ok, nok) {
        return start

        function start(code: number | null) {
          if (code !== LESS_THAN_CODE) return nok(code)
          effects.enter('data')
          effects.consume(code)
          return afterLessThan
        }

        function afterLessThan(code: number | null) {
          if (code !== EQUALS_CODE) return nok(code)
          effects.exit('data')
          return ok(code)
        }
      },
    },
  },
} satisfies MarkdownSyntaxExtension

export const commonMarkTextCompatibilityPlugin = realmPlugin({
  init(realm) {
    realm.pub(addSyntaxExtension$, commonMarkLessThanOrEqualSyntaxExtension)
  },
})

export function prepareCommonMarkForMdxEditor(markdown: string): PreparedCommonMark {
  let requiresSourceMode = false
  let fence: { readonly marker: '`' | '~'; readonly length: number } | null = null
  let inlineCodeMarker: string | null = null
  let activeListContentIndent: number | null = null

  const prepared = markdown.split(/(\r?\n)/u).map((line) => {
    if (/^\r?\n$/u.test(line)) return line

    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line)
    if (fenceMatch) {
      const sequence = fenceMatch[1]
      const marker = sequence[0] as '`' | '~'
      if (!fence) {
        if (marker === '~' || !fenceMatch[2].includes('`')) {
          fence = { marker, length: sequence.length }
        }
      } else if (
        marker === fence.marker
        && sequence.length >= fence.length
        && /^\s*$/u.test(fenceMatch[2])
      ) {
        fence = null
      }
      return line
    }
    if (fence) return line

    const listIndent = markdownListContentIndent(line)
    const leadingIndent = markdownLeadingIndent(line)
    if (listIndent !== null && (leadingIndent <= 3 || activeListContentIndent !== null)) {
      activeListContentIndent = listIndent
    } else if (/\S/u.test(line)) {
      if (activeListContentIndent !== null && leadingIndent < activeListContentIndent) {
        activeListContentIndent = null
      }
      if (
        leadingIndent >= 4
        && (activeListContentIndent === null || leadingIndent >= activeListContentIndent + 4)
      ) {
        requiresSourceMode = true
        return line
      }
    }

    let result = ''
    for (let index = 0; index < line.length;) {
      if (line[index] === '`' && !isEscaped(line, index)) {
        const marker = /^`+/u.exec(line.slice(index))?.[0] ?? '`'
        inlineCodeMarker = inlineCodeMarker === marker ? null : inlineCodeMarker ?? marker
        result += marker
        index += marker.length
        continue
      }

      if (inlineCodeMarker || line[index] !== '<' || isEscaped(line, index)) {
        result += line[index]
        index += 1
        continue
      }

      if (line[index + 1] === '=') {
        result += '\\<='
        index += 2
        continue
      }

      const breakTag = /^<br\s*\/?\s*>/iu.exec(line.slice(index))?.[0]
      if (breakTag) {
        result += breakTag.includes('/') ? breakTag : '<br />'
        index += breakTag.length
        continue
      }

      const closingIndex = line.indexOf('>', index + 1)
      const candidate = closingIndex >= 0 ? line.slice(index + 1, closingIndex) : ''
      if (closingIndex >= 0 && isExistingLinkDestination(line, index)) {
        result += line.slice(index, closingIndex + 1)
        index = closingIndex + 1
        continue
      }
      if (closingIndex >= 0) {
        if (isCommonMarkUriAutolink(candidate)) {
          result += `[${escapeMarkdownLinkLabel(candidate)}](<${candidate}>)`
          index = closingIndex + 1
          continue
        }
        if (isCommonMarkEmailAutolink(candidate)) {
          result += `[${escapeMarkdownLinkLabel(candidate)}](<mailto:${candidate}>)`
          index = closingIndex + 1
          continue
        }
      }

      if (/^[A-Za-z!/?]/u.test(line.slice(index + 1))) requiresSourceMode = true
      result += line[index]
      index += 1
    }
    return result
  }).join('')

  return requiresSourceMode
    ? { markdown, requiresSourceMode: true }
    : { markdown: prepared, requiresSourceMode: false }
}

export const commonMarkToMarkdownOptions = {
  resourceLink: false,
  handlers: {
    text(node, _parent, state, info) {
      return state.safe(node.value, info)
        .replace(/\\<\\=/gu, '<=')
        .replace(/\\<=/gu, '<=')
    },
  },
} satisfies ToMarkdownOptions

function isExistingLinkDestination(line: string, index: number): boolean {
  if (line[index - 1] === '(') return true
  return /^ {0,3}\[[^\]\r\n]+\]:\s*$/u.test(line.slice(0, index))
}

function markdownListContentIndent(line: string): number | null {
  const match = /^([ \t]*)(?:[*+-]|\d{1,9}[.)])([ \t]+)/u.exec(line)
  if (!match) return null
  const markerLength = match[0].length - match[1].length - match[2].length
  return markdownIndentWidth(match[1]) + markerLength + markdownIndentWidth(match[2])
}

function markdownLeadingIndent(line: string): number {
  return markdownIndentWidth(/^[ \t]*/u.exec(line)?.[0] ?? '')
}

function markdownIndentWidth(value: string): number {
  let width = 0
  for (const character of value) width += character === '\t' ? 4 : 1
  return width
}

function isCommonMarkUriAutolink(value: string): boolean {
  return /^[A-Za-z][A-Za-z\d+.-]{1,31}:[^\u0000-\u0020<>]*$/u.test(value)
}

function isCommonMarkEmailAutolink(value: string): boolean {
  return /^[A-Za-z\d.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z\d](?:[A-Za-z\d-]{0,61}[A-Za-z\d])?(?:\.[A-Za-z\d](?:[A-Za-z\d-]{0,61}[A-Za-z\d])?)*$/u.test(value)
}

function escapeMarkdownLinkLabel(value: string): string {
  return value.replace(/[\\\[\]]/gu, '\\$&')
}

function isEscaped(value: string, index: number): boolean {
  let backslashCount = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) backslashCount += 1
  return backslashCount % 2 === 1
}
