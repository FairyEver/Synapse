import { useLayoutEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ImageOff } from 'lucide-react'

type MarkdownImageFallbackEntry = {
  readonly id: number
  readonly alt: string
  readonly host: HTMLSpanElement
}

type MarkdownImageFallbacksProps = {
  readonly contentKey: string
  readonly rootRef: RefObject<HTMLElement | null>
}

export function MarkdownImageFallbacks({ contentKey, rootRef }: MarkdownImageFallbacksProps) {
  const [fallbacks, setFallbacks] = useState<readonly MarkdownImageFallbackEntry[]>([])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return

    const fallbackByImage = new Map<HTMLImageElement, MarkdownImageFallbackEntry>()
    const cleanups: Array<() => void> = []
    const syncFallbacks = () => setFallbacks([...fallbackByImage.values()])

    const prepareImagePreview = (image: HTMLImageElement) => {
      image.hidden = false
      image.tabIndex = 0
      image.setAttribute('role', 'button')
      image.setAttribute('aria-label', image.alt ? `预览图片：${image.alt}` : '预览图片')
    }

    const showFallback = (image: HTMLImageElement, id: number, sync = true) => {
      if (fallbackByImage.has(image)) return
      const host = document.createElement('span')
      host.setAttribute('data-drive-markdown-image-fallback-host', 'true')
      image.hidden = true
      image.removeAttribute('tabindex')
      image.removeAttribute('role')
      image.removeAttribute('aria-label')
      image.insertAdjacentElement('afterend', host)
      fallbackByImage.set(image, { id, alt: image.alt.trim(), host })
      if (sync) syncFallbacks()
    }

    const restoreImage = (image: HTMLImageElement) => {
      const fallback = fallbackByImage.get(image)
      if (fallback) {
        fallback.host.remove()
        fallbackByImage.delete(image)
        syncFallbacks()
      }
      prepareImagePreview(image)
    }

    root.querySelectorAll<HTMLImageElement>('img').forEach((image, index) => {
      const onError = () => showFallback(image, index)
      const onLoad = () => restoreImage(image)
      image.addEventListener('error', onError)
      image.addEventListener('load', onLoad)
      cleanups.push(() => {
        image.removeEventListener('error', onError)
        image.removeEventListener('load', onLoad)
      })

      if (!image.getAttribute('src')?.trim() || (image.complete && image.naturalWidth === 0)) {
        showFallback(image, index, false)
      } else {
        prepareImagePreview(image)
      }
    })

    syncFallbacks()

    return () => {
      for (const cleanup of cleanups) cleanup()
      for (const [image, fallback] of fallbackByImage) {
        fallback.host.remove()
        image.hidden = false
      }
    }
  }, [contentKey, rootRef])

  return fallbacks.map((fallback) => createPortal(
    <MarkdownImageFallback alt={fallback.alt} />,
    fallback.host,
    fallback.id
  ))
}

function MarkdownImageFallback({ alt }: { readonly alt: string }) {
  const accessibleLabel = alt ? `${alt}，图片无法显示` : '图片无法显示'
  return (
    <span
      data-drive-markdown-image-fallback='true'
      role='img'
      aria-label={accessibleLabel}
      className='inline-flex min-h-16 max-w-full select-none items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3 align-middle text-foreground'
    >
      <ImageOff aria-hidden className='size-5 shrink-0 text-muted-foreground' />
      <span aria-hidden className='min-w-0'>
        {alt ? <span className='block truncate text-sm font-medium'>{alt}</span> : null}
        <span className='block text-xs text-muted-foreground'>图片无法显示</span>
      </span>
    </span>
  )
}
