import { ChevronsUpDown } from 'lucide-react'
import {
  buildCollapsedDiffBlocks,
  buildSplitDiffRows,
  type DiffLineOp,
  type InlineDiffSegment,
} from './change-history-diff'
import type { ChangeHistoryDiffStyle } from './change-history-model'
import { cn } from '@/lib/utils'

function InlineLineText({
  op,
  kind,
}: {
  readonly op: DiffLineOp
  readonly kind: 'add' | 'del' | 'eq'
}) {
  if (!op.segments || op.segments.length === 0) {
    return <>{op.text || '\u00A0'}</>
  }
  return (
    <>
      {op.segments.map((segment: InlineDiffSegment, index: number) => {
        if (!segment.changed || kind === 'eq') {
          return <span key={index}>{segment.text}</span>
        }
        return (
          <mark
            key={index}
            className={cn(
              'rounded-xs px-0.5 text-inherit',
              kind === 'add'
                ? 'bg-success-soft-hover font-medium'
                : 'bg-danger-soft-hover line-through'
            )}
          >
            {segment.text}
          </mark>
        )
      })}
    </>
  )
}

function GapExpandRow({
  colSpan,
  count,
  onExpand,
}: {
  readonly colSpan: number
  readonly count: number
  readonly onExpand: () => void
}) {
  return (
    <tr className='border-y border-separator bg-surface-secondary'>
      <td colSpan={colSpan} className='px-3 py-1.5 font-sans text-xs text-muted'>
        <button
          type='button'
          onClick={onExpand}
          className='inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-medium text-accent transition-colors hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
        >
          <ChevronsUpDown className='size-3.5 shrink-0' aria-hidden />
          展开 {count} 行未改动内容
        </button>
      </td>
    </tr>
  )
}

export function DriveChangeHistoryDiffView({
  ops,
  style,
  showFull,
  expandedGapKeys,
  keyPrefix,
  onExpandGap,
}: {
  readonly ops: readonly DiffLineOp[]
  readonly style: ChangeHistoryDiffStyle
  readonly showFull: boolean
  readonly expandedGapKeys: ReadonlySet<string>
  readonly keyPrefix: string
  readonly onExpandGap: (gapKey: string) => void
}) {
  const blocks = buildCollapsedDiffBlocks(ops, {
    showFull,
    contextLines: 3,
    expandedGapKeys,
    keyPrefix,
  })

  if (style === 'split') {
    return (
      <div className='overflow-x-auto bg-surface'>
        <table className='w-full min-w-[720px] table-fixed border-collapse font-mono text-xs leading-6'>
          <colgroup>
            <col className='w-11' />
            <col className='w-5' />
            <col className='w-[calc(50%-4rem)]' />
            <col className='w-11' />
            <col className='w-5' />
            <col className='w-[calc(50%-4rem)]' />
          </colgroup>
          <tbody>
            {blocks.map((block, blockIndex) => {
              if (block.kind === 'gap') {
                return (
                  <GapExpandRow
                    key={block.key}
                    colSpan={6}
                    count={block.count}
                    onExpand={() => onExpandGap(block.key)}
                  />
                )
              }
              const splitRows = buildSplitDiffRows(block.ops)
              return splitRows.map((row, rowIndex) => (
                <tr key={`${blockIndex}:${rowIndex}`}>
                  {row.left ? (
                    <>
                      <td
                        className={cn(
                          'select-none border-r border-separator px-2 text-right tabular-nums',
                          row.left.type === 'del'
                            ? 'bg-danger-soft text-danger-soft-foreground'
                            : 'bg-surface text-muted'
                        )}
                      >
                        {row.left.oldLineNumber ?? ''}
                      </td>
                      <td
                        className={cn(
                          'select-none text-center font-semibold',
                          row.left.type === 'del'
                            ? 'bg-danger-soft text-danger-soft-foreground'
                            : 'bg-surface text-muted'
                        )}
                      >
                        {row.left.type === 'del' ? '−' : ' '}
                      </td>
                      <td
                        className={cn(
                          'whitespace-pre-wrap break-words px-2 py-0.5 text-foreground',
                          row.left.type === 'del' ? 'bg-danger-soft' : 'bg-surface'
                        )}
                      >
                        <InlineLineText
                          op={row.left}
                          kind={row.left.type === 'del' ? 'del' : 'eq'}
                        />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className='border-r border-separator bg-surface-secondary' />
                      <td className='bg-surface-secondary' />
                      <td className='bg-surface-secondary' />
                    </>
                  )}
                  {row.right ? (
                    <>
                      <td
                        className={cn(
                          'select-none border-x border-separator px-2 text-right tabular-nums',
                          row.right.type === 'add'
                            ? 'bg-success-soft text-success-soft-foreground'
                            : 'bg-surface text-muted'
                        )}
                      >
                        {row.right.newLineNumber ?? ''}
                      </td>
                      <td
                        className={cn(
                          'select-none text-center font-semibold',
                          row.right.type === 'add'
                            ? 'bg-success-soft text-success-soft-foreground'
                            : 'bg-surface text-muted'
                        )}
                      >
                        {row.right.type === 'add' ? '+' : ' '}
                      </td>
                      <td
                        className={cn(
                          'whitespace-pre-wrap break-words px-2 py-0.5 text-foreground',
                          row.right.type === 'add' ? 'bg-success-soft' : 'bg-surface'
                        )}
                      >
                        <InlineLineText
                          op={row.right}
                          kind={row.right.type === 'add' ? 'add' : 'eq'}
                        />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className='border-x border-separator bg-surface-secondary' />
                      <td className='bg-surface-secondary' />
                      <td className='bg-surface-secondary' />
                    </>
                  )}
                </tr>
              ))
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className='overflow-x-auto bg-surface'>
      <table className='w-full min-w-[540px] table-fixed border-collapse font-mono text-xs leading-6'>
        <colgroup>
          <col className='w-12' />
          <col className='w-12' />
          <col className='w-6' />
          <col />
        </colgroup>
        <tbody>
          {blocks.map((block, blockIndex) => {
            if (block.kind === 'gap') {
              return (
                <GapExpandRow
                  key={block.key}
                  colSpan={4}
                  count={block.count}
                  onExpand={() => onExpandGap(block.key)}
                />
              )
            }
            return block.ops.map((op, rowIndex) => {
              const rowClass =
                op.type === 'add'
                  ? 'bg-success-soft'
                  : op.type === 'del'
                    ? 'bg-danger-soft'
                    : 'bg-surface'
              const gutterClass =
                op.type === 'add'
                  ? 'bg-success-soft text-success-soft-foreground'
                  : op.type === 'del'
                    ? 'bg-danger-soft text-danger-soft-foreground'
                    : 'bg-surface text-muted'
              return (
                <tr key={`${blockIndex}:${rowIndex}`} className={rowClass}>
                  <td
                    className={cn(
                      'select-none border-r border-separator px-2 text-right tabular-nums',
                      gutterClass
                    )}
                  >
                    {op.oldLineNumber ?? ''}
                  </td>
                  <td
                    className={cn(
                      'select-none border-r border-separator px-2 text-right tabular-nums',
                      gutterClass
                    )}
                  >
                    {op.newLineNumber ?? ''}
                  </td>
                  <td
                    className={cn(
                      'select-none text-center font-semibold',
                      gutterClass
                    )}
                  >
                    {op.type === 'add' ? '+' : op.type === 'del' ? '−' : ' '}
                  </td>
                  <td className='whitespace-pre-wrap break-words px-3 py-0.5 text-foreground'>
                    <InlineLineText op={op} kind={op.type} />
                  </td>
                </tr>
              )
            })
          })}
        </tbody>
      </table>
    </div>
  )
}
