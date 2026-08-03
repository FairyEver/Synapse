type DriveTableColumnsProps = {
  readonly columns: readonly string[]
}

const DRIVE_FILE_TABLE_COLUMNS = ["w-auto", "w-24", "w-40", "w-52"] as const
const DRIVE_PUBLIC_ASSET_TABLE_COLUMNS = ["w-auto", "w-20", "w-36", "w-16", "w-44", "w-44"] as const
const DRIVE_TRASH_TABLE_COLUMNS = ["w-auto", "w-28", "w-20", "w-56", "w-44", "w-36"] as const
const DRIVE_SHARE_TABLE_COLUMNS = ["w-72", "w-auto", "w-44"] as const
const DRIVE_TABLE_STICKY_ACTION_COLUMN_CLASS = "sticky right-0 z-10 bg-background text-right"

function DriveTableColumns({ columns }: DriveTableColumnsProps) {
  return (
    <colgroup>
      {columns.map((className, index) => (
        <col key={`${className}-${index}`} className={className} />
      ))}
    </colgroup>
  )
}

export {
  DRIVE_FILE_TABLE_COLUMNS,
  DRIVE_PUBLIC_ASSET_TABLE_COLUMNS,
  DRIVE_SHARE_TABLE_COLUMNS,
  DRIVE_TABLE_STICKY_ACTION_COLUMN_CLASS,
  DRIVE_TRASH_TABLE_COLUMNS,
  DriveTableColumns,
}
