import {
  addSyntaxExtension$,
  realmPlugin,
} from '@mdxeditor/editor'
import type {
  FromMarkdownOptions,
  ToMarkdownOptions,
} from '@mdxeditor/editor'

type MarkdownSyntaxExtension = NonNullable<FromMarkdownOptions['extensions']>[number]

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

export const commonMarkToMarkdownOptions = {
  handlers: {
    text(node, _parent, state, info) {
      return state.safe(node.value, info)
        .replace(/\\<\\=/gu, '<=')
        .replace(/\\<=/gu, '<=')
    },
  },
} satisfies ToMarkdownOptions
