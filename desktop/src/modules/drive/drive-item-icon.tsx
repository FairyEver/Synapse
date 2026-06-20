import { Archive, File as FileIcon, FolderClosed, Trash2, type LucideIcon } from "lucide-react"

type DriveItemIconKind = "file" | "folder" | "public-assets" | "trash"

const DRIVE_ITEM_ICON_BY_KIND: Record<DriveItemIconKind, LucideIcon> = {
  file: FileIcon,
  folder: FolderClosed,
  "public-assets": Archive,
  trash: Trash2,
}

export function DriveItemIcon({ kind }: { readonly kind: DriveItemIconKind }) {
  const Icon = DRIVE_ITEM_ICON_BY_KIND[kind]
  return <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
}
