export const DRIVE_PUBLIC_ASSETS_ENTRY_ID = "__drive_public_assets__"
export const DRIVE_TRASH_ENTRY_ID = "__drive_trash__"

export type DriveSystemEntryId = typeof DRIVE_PUBLIC_ASSETS_ENTRY_ID | typeof DRIVE_TRASH_ENTRY_ID

export type DriveSystemEntry = {
  readonly id: DriveSystemEntryId
  readonly name: "公开素材" | "回收站"
  readonly kind: "public_assets" | "trash"
}

const DRIVE_ROOT_SYSTEM_ENTRIES: readonly DriveSystemEntry[] = [
  { id: DRIVE_PUBLIC_ASSETS_ENTRY_ID, name: "公开素材", kind: "public_assets" },
  { id: DRIVE_TRASH_ENTRY_ID, name: "回收站", kind: "trash" },
]

export function driveRootSystemEntries(parentId: string | null): readonly DriveSystemEntry[] {
  return parentId === null ? DRIVE_ROOT_SYSTEM_ENTRIES : []
}

export function isDriveSystemEntryId(id: string): id is DriveSystemEntryId {
  return id === DRIVE_PUBLIC_ASSETS_ENTRY_ID || id === DRIVE_TRASH_ENTRY_ID
}
