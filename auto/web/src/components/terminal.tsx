import { useRef, useEffect, useCallback, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { OutputLine } from '../types'
import { cn } from '../lib/utils'

interface TerminalProps {
  lines: OutputLine[]
  trimmedCount: number
  className?: string
}

const LINE_HEIGHT = 20

export function Terminal({ lines, trimmedCount, className }: TerminalProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => LINE_HEIGHT,
    overscan: 20,
  })

  const handleScroll = useCallback(() => {
    const el = parentRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < LINE_HEIGHT * 2
    setAutoScroll(atBottom)
  }, [])

  useEffect(() => {
    if (autoScroll && lines.length > 0) {
      virtualizer.scrollToIndex(lines.length - 1, { align: 'end' })
    }
  }, [lines.length, autoScroll, virtualizer])

  return (
    <div className={cn('relative', className)}>
      {trimmedCount > 0 && (
        <div className="bg-muted text-muted-foreground text-xs px-3 py-1 text-center">
          {trimmedCount} 行已截断
        </div>
      )}
      <div
        ref={parentRef}
        onScroll={handleScroll}
        className="h-full overflow-auto bg-terminal-bg text-terminal-fg font-mono text-xs leading-5"
      >
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map(virtualRow => {
            const line = lines[virtualRow.index]
            return (
              <div
                key={virtualRow.index}
                className={cn(
                  'absolute left-0 w-full px-3 whitespace-pre',
                  line.stream === 'stderr' && 'text-terminal-stderr',
                )}
                style={{
                  top: virtualRow.start,
                  height: virtualRow.size,
                }}
              >
                {line.text}
              </div>
            )
          })}
        </div>
      </div>
      {!autoScroll && (
        <button
          type="button"
          onClick={() => {
            setAutoScroll(true)
            virtualizer.scrollToIndex(lines.length - 1, { align: 'end' })
          }}
          className="absolute bottom-2 right-2 bg-primary text-primary-foreground text-xs px-2 py-1 rounded-md opacity-80 hover:opacity-100"
        >
          ↓ 最新
        </button>
      )}
    </div>
  )
}
