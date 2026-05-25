type ComposerInsertionInput = {
  readonly draft: string
  readonly selectionStart: number
  readonly selectionEnd: number
  readonly text: string
}

type ComposerInsertionResult = {
  readonly value: string
  readonly cursor: number
}

function insertTextAtComposerSelection({
  draft,
  selectionStart,
  selectionEnd,
  text,
}: ComposerInsertionInput): ComposerInsertionResult {
  const start = Math.max(0, Math.min(selectionStart, draft.length))
  const end = Math.max(start, Math.min(selectionEnd, draft.length))
  const prefix = draft.slice(0, start)
  const suffix = draft.slice(end)
  const needsLeadingSpace = prefix.length > 0 && !/\s$/.test(prefix) && !/^\s/.test(text)
  const insertion = `${needsLeadingSpace ? " " : ""}${text}`
  const value = `${prefix}${insertion}${suffix}`
  const cursor = prefix.length + insertion.length

  return { value, cursor }
}

export { insertTextAtComposerSelection }
