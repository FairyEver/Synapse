export type DiffLineKind = 'eq' | 'add' | 'del'

export interface InlineDiffSegment {
  readonly text: string
  readonly changed: boolean
}

export interface DiffLineOp {
  readonly type: DiffLineKind
  readonly oldLineNumber: number | null
  readonly newLineNumber: number | null
  readonly text: string
  readonly segments?: readonly InlineDiffSegment[]
}

export type CollapsedDiffBlock =
  | { readonly kind: 'ops'; readonly ops: readonly DiffLineOp[] }
  | { readonly kind: 'gap'; readonly key: string; readonly count: number }

export interface SplitDiffRow {
  readonly left: DiffLineOp | null
  readonly right: DiffLineOp | null
}

export interface DiffStats {
  readonly additions: number
  readonly deletions: number
}

const MAX_LCS_CELLS = 4_000_000
const MAX_INLINE_CELLS = 40_000

function splitDocumentLines(text: string): string[] {
  if (text.length === 0) return []
  return text.replace(/\r\n/gu, '\n').split('\n')
}

export function computeLineDiff(oldText: string, newText: string): DiffLineOp[] {
  const a = splitDocumentLines(oldText)
  const b = splitDocumentLines(newText)
  const m = a.length
  const n = b.length

  let prefix = 0
  while (prefix < m && prefix < n && a[prefix] === b[prefix]) prefix += 1

  let suffix = 0
  while (
    suffix < m - prefix &&
    suffix < n - prefix &&
    a[m - 1 - suffix] === b[n - 1 - suffix]
  ) {
    suffix += 1
  }

  const ops: DiffLineOp[] = []
  let oldLn = 1
  let newLn = 1

  for (let index = 0; index < prefix; index += 1) {
    ops.push({
      type: 'eq',
      oldLineNumber: oldLn++,
      newLineNumber: newLn++,
      text: a[index]!,
    })
  }

  const midA = a.slice(prefix, m - suffix)
  const midB = b.slice(prefix, n - suffix)

  if (midA.length * midB.length <= MAX_LCS_CELLS) {
    const midOps = computeLcsLines(midA, midB, oldLn, newLn)
    ops.push(...midOps.ops)
    oldLn = midOps.nextOldLn
    newLn = midOps.nextNewLn
  } else {
    for (const line of midA) {
      ops.push({ type: 'del', oldLineNumber: oldLn++, newLineNumber: null, text: line })
    }
    for (const line of midB) {
      ops.push({ type: 'add', oldLineNumber: null, newLineNumber: newLn++, text: line })
    }
  }

  for (let index = m - suffix; index < m; index += 1) {
    ops.push({
      type: 'eq',
      oldLineNumber: oldLn++,
      newLineNumber: newLn++,
      text: a[index]!,
    })
  }

  return decorateInlineDiff(ops)
}

function computeLcsLines(
  a: readonly string[],
  b: readonly string[],
  startOldLn: number,
  startNewLn: number
): {
  readonly ops: DiffLineOp[]
  readonly nextOldLn: number
  readonly nextNewLn: number
} {
  const m = a.length
  const n = b.length
  const width = n + 1
  const dp = new Uint32Array((m + 1) * width)

  for (let i = m - 1; i >= 0; i -= 1) {
    const rowOffset = i * width
    const nextRowOffset = (i + 1) * width
    for (let j = n - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        dp[rowOffset + j] = dp[nextRowOffset + j + 1]! + 1
      } else {
        const down = dp[nextRowOffset + j]!
        const right = dp[rowOffset + j + 1]!
        dp[rowOffset + j] = down >= right ? down : right
      }
    }
  }

  const ops: DiffLineOp[] = []
  let i = 0
  let j = 0
  let oldLn = startOldLn
  let newLn = startNewLn

  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ type: 'eq', oldLineNumber: oldLn++, newLineNumber: newLn++, text: a[i]! })
      i += 1
      j += 1
    } else if (dp[(i + 1) * width + j]! >= dp[i * width + j + 1]!) {
      ops.push({ type: 'del', oldLineNumber: oldLn++, newLineNumber: null, text: a[i]! })
      i += 1
    } else {
      ops.push({ type: 'add', oldLineNumber: null, newLineNumber: newLn++, text: b[j]! })
      j += 1
    }
  }

  while (i < m) {
    ops.push({ type: 'del', oldLineNumber: oldLn++, newLineNumber: null, text: a[i++]! })
  }
  while (j < n) {
    ops.push({ type: 'add', oldLineNumber: null, newLineNumber: newLn++, text: b[j++]! })
  }

  return { ops, nextOldLn: oldLn, nextNewLn: newLn }
}

function tokenizeInline(line: string): string[] {
  return line.match(/[A-Za-z0-9_`./:-]+|\s+|./gu) ?? []
}

function mergeSegments(parts: readonly InlineDiffSegment[]): InlineDiffSegment[] {
  const merged: InlineDiffSegment[] = []
  for (const part of parts) {
    const last = merged[merged.length - 1]
    if (last && last.changed === part.changed) {
      merged[merged.length - 1] = {
        text: last.text + part.text,
        changed: last.changed,
      }
    } else {
      merged.push(part)
    }
  }
  return merged
}

function diffInlinePair(
  oldLine: string,
  newLine: string
): {
  readonly oldSegments: readonly InlineDiffSegment[]
  readonly newSegments: readonly InlineDiffSegment[]
} {
  const a = tokenizeInline(oldLine)
  const b = tokenizeInline(newLine)
  if (a.length === 0 || b.length === 0 || a.length * b.length > MAX_INLINE_CELLS) {
    return {
      oldSegments: [{ text: oldLine, changed: false }],
      newSegments: [{ text: newLine, changed: false }],
    }
  }

  const m = a.length
  const n = b.length
  const width = n + 1
  const dp = new Uint16Array((m + 1) * width)

  for (let i = m - 1; i >= 0; i -= 1) {
    const rowOffset = i * width
    const nextRowOffset = (i + 1) * width
    for (let j = n - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        dp[rowOffset + j] = dp[nextRowOffset + j + 1]! + 1
      } else {
        const down = dp[nextRowOffset + j]!
        const right = dp[rowOffset + j + 1]!
        dp[rowOffset + j] = down >= right ? down : right
      }
    }
  }

  const oldParts: InlineDiffSegment[] = []
  const newParts: InlineDiffSegment[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      oldParts.push({ text: a[i]!, changed: false })
      newParts.push({ text: b[j]!, changed: false })
      i += 1
      j += 1
    } else if (dp[(i + 1) * width + j]! >= dp[i * width + j + 1]!) {
      oldParts.push({ text: a[i++]!, changed: true })
    } else {
      newParts.push({ text: b[j++]!, changed: true })
    }
  }
  while (i < m) oldParts.push({ text: a[i++]!, changed: true })
  while (j < n) newParts.push({ text: b[j++]!, changed: true })

  return {
    oldSegments: mergeSegments(oldParts),
    newSegments: mergeSegments(newParts),
  }
}

function decorateInlineDiff(ops: readonly DiffLineOp[]): DiffLineOp[] {
  const result = ops.map((op) => ({ ...op }))
  let index = 0
  while (index < result.length) {
    if (result[index]!.type === 'del') {
      const delStart = index
      while (index < result.length && result[index]!.type === 'del') index += 1
      const addStart = index
      while (index < result.length && result[index]!.type === 'add') index += 1
      const pairCount = Math.min(addStart - delStart, index - addStart)
      for (let offset = 0; offset < pairCount; offset += 1) {
        const delOp = result[delStart + offset]!
        const addOp = result[addStart + offset]!
        const { oldSegments, newSegments } = diffInlinePair(delOp.text, addOp.text)
        result[delStart + offset] = { ...delOp, segments: oldSegments }
        result[addStart + offset] = { ...addOp, segments: newSegments }
      }
    } else {
      index += 1
    }
  }
  return result
}

export function getDiffStats(ops: readonly DiffLineOp[]): DiffStats {
  let additions = 0
  let deletions = 0
  for (const op of ops) {
    if (op.type === 'add') additions += 1
    else if (op.type === 'del') deletions += 1
  }
  return { additions, deletions }
}

export function buildCollapsedDiffBlocks(
  ops: readonly DiffLineOp[],
  options: {
    readonly showFull: boolean
    readonly contextLines?: number
    readonly expandedGapKeys: ReadonlySet<string>
    readonly keyPrefix: string
  }
): CollapsedDiffBlock[] {
  if (options.showFull) {
    return ops.length > 0 ? [{ kind: 'ops', ops }] : []
  }

  const contextLines = options.contextLines ?? 3
  const visible = new Array<boolean>(ops.length).fill(false)
  for (let i = 0; i < ops.length; i += 1) {
    if (ops[i]!.type !== 'eq') {
      const from = Math.max(0, i - contextLines)
      const to = Math.min(ops.length - 1, i + contextLines)
      for (let cursor = from; cursor <= to; cursor += 1) {
        visible[cursor] = true
      }
    }
  }

  const blocks: CollapsedDiffBlock[] = []
  let index = 0
  let gapIndex = 0
  while (index < ops.length) {
    if (visible[index]) {
      const chunk: DiffLineOp[] = []
      while (index < ops.length && visible[index]) chunk.push(ops[index++]!)
      blocks.push({ kind: 'ops', ops: chunk })
    } else {
      const start = index
      while (index < ops.length && !visible[index]) index += 1
      const hidden = ops.slice(start, index)
      const key = `${options.keyPrefix}:gap:${gapIndex++}`
      if (hidden.length <= 2 || options.expandedGapKeys.has(key)) {
        blocks.push({ kind: 'ops', ops: hidden })
      } else {
        blocks.push({ kind: 'gap', key, count: hidden.length })
      }
    }
  }
  return blocks
}

export function buildSplitDiffRows(ops: readonly DiffLineOp[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = []
  let index = 0
  while (index < ops.length) {
    const current = ops[index]!
    if (current.type === 'eq') {
      rows.push({ left: current, right: current })
      index += 1
      continue
    }
    const dels: DiffLineOp[] = []
    const adds: DiffLineOp[] = []
    while (index < ops.length && ops[index]!.type === 'del') dels.push(ops[index++]!)
    while (index < ops.length && ops[index]!.type === 'add') adds.push(ops[index++]!)
    const maxLen = Math.max(dels.length, adds.length)
    for (let offset = 0; offset < maxLen; offset += 1) {
      rows.push({
        left: dels[offset] ?? null,
        right: adds[offset] ?? null,
      })
    }
  }
  return rows
}
