import { Button, TextArea } from '@heroui/react'
import { DRIVE_MESSAGE_BODY_MAX_LENGTH } from '@synapse/shared'
import { useCallback, useState, type ComponentProps, type ClipboardEvent, type DragEvent } from 'react'
import { createDriveLazyComponent } from './shared/drive-lazy-component'

type RichProps = ComponentProps<typeof import('./drive-message-rich-composer').DriveMessageRichComposer>
const RichComposer = createDriveLazyComponent<RichProps>(
  () => import('./drive-message-rich-composer').then((module) => ({ default: module.DriveMessageRichComposer })),
  ({ value, onChange, label, busy, fieldVariant = 'primary' }: RichProps) => (
    <TextArea fullWidth autoFocus variant={fieldVariant} aria-label={label} rows={3} value={value} disabled={busy} onChange={(event) => onChange(event.target.value)} />
  ),
)

export function DriveMessageComposer(props: RichProps) {
  const [pendingImages, setPendingImages] = useState<readonly File[]>([])
  const onConsumed = useCallback(() => setPendingImages([]), [])
  const queueImages = (files: readonly File[]) => {
    if (!files.length || props.busy) return
    setPendingImages((previous) => [...previous, ...files])
    if (props.expanded === false) props.onExpand?.()
  }
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.items).filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile()).filter((file): file is File => file !== null)
    if (!files.length) return
    event.preventDefault(); event.stopPropagation(); queueImages(files)
  }
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.files.length) return
    event.preventDefault(); event.stopPropagation(); queueImages(Array.from(event.dataTransfer.files))
  }
  const expanded = props.expanded ?? true
  return (
    <div data-drive-message-editor role='group' aria-label={props.label} className='w-full min-w-0 space-y-3' onPasteCapture={onPaste} onDropCapture={onDrop}
      onDragOverCapture={(event) => { if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault() }}
      onKeyDown={(event) => { event.stopPropagation(); if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') event.preventDefault() }}>
      {expanded ? <RichComposer {...props} pendingImages={pendingImages} onPendingImagesConsumed={onConsumed} /> : (<>
        <TextArea fullWidth variant={props.fieldVariant ?? 'primary'} aria-label={props.label} placeholder='写下留言…' rows={3}
          value={props.value} disabled={props.busy} onChange={(event) => props.onChange(event.target.value)} onFocus={props.onExpand} />
        <div className='flex flex-wrap items-center gap-2'>
          <Button type='button' isDisabled={props.busy || !props.value.trim() || props.value.trim().length > DRIVE_MESSAGE_BODY_MAX_LENGTH} onPress={props.onSubmit}>{props.busy ? '提交中' : props.submitLabel}</Button>
        </div>
      </>)}
    </div>
  )
}
