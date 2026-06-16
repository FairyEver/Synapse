import type { DriveBrowserItemDto } from '@synapse/shared'
import { Archive, File, FileText, Folder, Image } from 'lucide-react'

export function DriveBrowserItemIcon({ item }: { readonly item: DriveBrowserItemDto }) {
  if (item.type === 'folder') return <Folder className='size-4 shrink-0 text-muted-foreground' />
  if (item.previewKind === 'image') return <Image className='size-4 shrink-0 text-muted-foreground' />
  if (
    item.previewKind === 'text' ||
    item.previewKind === 'html-source' ||
    item.previewKind === 'markdown'
  ) {
    return <FileText className='size-4 shrink-0 text-muted-foreground' />
  }
  if (item.previewKind === 'download-only') return <Archive className='size-4 shrink-0 text-muted-foreground' />
  return <File className='size-4 shrink-0 text-muted-foreground' />
}
