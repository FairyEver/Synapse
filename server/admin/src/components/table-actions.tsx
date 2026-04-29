import * as React from "react"
import { Button } from "@/components/ui/button"
import { TableCell, TableHead } from "@/components/ui/table"
import type { DeviceStatus, ManagedStatus } from "@/lib/api"
import { cn } from "@/lib/utils"

const managedStatusActions: Array<{ label: string; value: ManagedStatus }> = [
  { label: "启用", value: "active" },
  { label: "停用", value: "disabled" },
  { label: "撤销", value: "revoked" },
  { label: "过期", value: "expired" },
]

const deviceStatusActions: Array<{ label: string; value: DeviceStatus }> = [
  { label: "启用", value: "active" },
  { label: "撤销", value: "revoked" },
]

function TableActionHead({
  className,
  children = "操作",
  ...props
}: React.ComponentProps<typeof TableHead>) {
  return (
    <TableHead
      className={cn("sticky right-0 bg-background text-right", className)}
      {...props}
    >
      {children}
    </TableHead>
  )
}

function TableActionCell({
  className,
  ...props
}: React.ComponentProps<typeof TableCell>) {
  return (
    <TableCell
      className={cn("sticky right-0 bg-background", className)}
      {...props}
    />
  )
}

function TableActionGroup({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn("flex justify-end gap-px", className)} {...props} />
}

function TableActionButton({
  className,
  size = "sm",
  variant = "ghost",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      size={size}
      variant={variant}
      className={cn("px-1.5", className)}
      {...props}
    />
  )
}

function ManagedStatusActionButtons({
  value,
  onChange,
  children,
}: {
  readonly value: ManagedStatus
  readonly onChange: (value: ManagedStatus) => void | Promise<void>
  readonly children?: React.ReactNode
}) {
  return (
    <TableActionGroup>
      {managedStatusActions.filter((status) => status.value !== value).map((status) => (
        <TableActionButton
          key={status.value}
          type="button"
          onClick={() => {
            void onChange(status.value)
          }}
        >
          {status.label}
        </TableActionButton>
      ))}
      {children}
    </TableActionGroup>
  )
}

function DeviceStatusActionButtons({
  value,
  onChange,
}: {
  readonly value: DeviceStatus
  readonly onChange: (value: DeviceStatus) => void | Promise<void>
}) {
  return (
    <TableActionGroup>
      {deviceStatusActions.filter((status) => status.value !== value).map((status) => (
        <TableActionButton
          key={status.value}
          type="button"
          onClick={() => {
            void onChange(status.value)
          }}
        >
          {status.label}
        </TableActionButton>
      ))}
    </TableActionGroup>
  )
}

export {
  DeviceStatusActionButtons,
  ManagedStatusActionButtons,
  TableActionButton,
  TableActionCell,
  TableActionGroup,
  TableActionHead,
}
