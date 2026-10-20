import 'github-markdown-css/github-markdown-light.css'
import { useEffect, useRef, useState } from 'react'
import { ImageLightbox, type ImageLightboxPreview } from '@/components/image-lightbox'
import { cn } from '@/lib/utils'
import { MARKDOWN_BODY_CLASSNAME } from './renderers/markdown-body-presentation'

const MESSAGE_BODY_CLASSNAME = cn(
  MARKDOWN_BODY_CLASSNAME,
  'bg-transparent! text-sm! leading-relaxed! text-foreground! [&_p]:my-3! [&_ul]:my-3! [&_ol]:my-3! [&_li>p]:my-1!',
  '[&_h1]:text-base! [&_h2]:text-base! [&_h3]:text-base! [&_:is(h1,h2,h3,h4,h5,h6)]:mt-4! [&_:is(h1,h2,h3,h4,h5,h6)]:mb-2! [&_:is(h1,h2)]:border-0! [&_:is(h1,h2)]:pb-0!',
  '[&>:first-child]:mt-0! [&>:last-child]:mb-0!',
)

export function DriveMessageBody({ html }: { readonly html: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [preview, setPreview] = useState<ImageLightboxPreview | null>(null)
  useEffect(() => {
    for (const image of rootRef.current?.querySelectorAll('img') ?? []) {
      image.tabIndex = 0
      image.setAttribute('role', 'button')
      image.setAttribute('aria-label', image.alt || '查看图片')
    }
  }, [html])
  const openImage = (target: EventTarget | null) => {
    if (!(target instanceof HTMLImageElement) || !rootRef.current?.contains(target)) return
    const images = [...rootRef.current.querySelectorAll('img')]
    setPreview({ images: images.map((image) => ({ src: image.src, alt: image.alt })), initialIndex: images.indexOf(target), trigger: target })
  }
  return <>
    <div
      ref={rootRef}
      className={MESSAGE_BODY_CLASSNAME}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(event) => {
        if (event.target instanceof HTMLImageElement) { event.preventDefault(); event.stopPropagation(); openImage(event.target) }
      }}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLImageElement && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          event.stopPropagation()
          openImage(event.target)
        }
      }}
    />
    {preview ? <ImageLightbox preview={preview} onClose={() => setPreview(null)} /> : null}
  </>
}
