import fileIcon from "./assets/file.svg"
import folderIcon from "./assets/folder.svg"

type DriveItemIconKind = "file" | "folder" | "public-assets" | "trash"
type DriveItemAssetKind = "file" | "folder"

const DRIVE_ITEM_ASSET_KIND: Record<DriveItemIconKind, DriveItemAssetKind> = {
  file: "file",
  folder: "folder",
  "public-assets": "folder",
  trash: "folder",
}

const DRIVE_ITEM_ICON_BY_KIND: Record<DriveItemAssetKind, string> = {
  file: fileIcon,
  folder: folderIcon,
}

export function DriveItemIcon({ kind }: { readonly kind: DriveItemIconKind }) {
  const assetKind = DRIVE_ITEM_ASSET_KIND[kind]
  return (
    <img
      src={DRIVE_ITEM_ICON_BY_KIND[assetKind]}
      alt=""
      className="size-4 shrink-0"
      data-drive-item-icon={assetKind}
      draggable={false}
      aria-hidden="true"
    />
  )
}
