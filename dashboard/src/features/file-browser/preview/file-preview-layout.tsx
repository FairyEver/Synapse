import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

export const FILE_PREVIEW_COMPACT_MAX_WIDTH = 1023

export type FilePreviewLayoutMode = 'compact' | 'regular'

const FilePreviewLayoutModeContext = createContext<FilePreviewLayoutMode>('regular')
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export function FilePreviewLayout({
  children,
  className,
}: {
  readonly children: ReactNode
  readonly className?: string
}) {
  const layoutRef = useRef<HTMLElement | null>(null)
  const [mode, setMode] = useState<FilePreviewLayoutMode>(initialFilePreviewLayoutMode)

  useIsoLayoutEffect(() => {
    const element = layoutRef.current
    if (!element || typeof ResizeObserver === 'undefined') return

    const updateMode = (width: number) => {
      if (width <= 0) return
      setMode(filePreviewLayoutModeForWidth(width))
    }
    updateMode(element.getBoundingClientRect().width)

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) updateMode(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <FilePreviewLayoutModeContext.Provider value={mode}>
      <section
        ref={layoutRef}
        data-file-preview-layout={mode}
        className={cn('min-w-0', className)}
      >
        {children}
      </section>
    </FilePreviewLayoutModeContext.Provider>
  )
}

export function useFilePreviewLayoutMode(): FilePreviewLayoutMode {
  return useContext(FilePreviewLayoutModeContext)
}

export function filePreviewLayoutModeForWidth(width: number): FilePreviewLayoutMode {
  return width <= FILE_PREVIEW_COMPACT_MAX_WIDTH ? 'compact' : 'regular'
}

function initialFilePreviewLayoutMode(): FilePreviewLayoutMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'regular'
  return window.matchMedia(`(max-width: ${FILE_PREVIEW_COMPACT_MAX_WIDTH}px)`).matches ? 'compact' : 'regular'
}
