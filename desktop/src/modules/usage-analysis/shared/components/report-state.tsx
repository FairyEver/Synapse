import type { ReactNode } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"

interface ReportStateProps {
  readonly loading: boolean
  readonly error: Error | null
  readonly empty: boolean
  readonly refreshing?: boolean
  readonly children: ReactNode
}

export function ReportState({ loading, error, empty, refreshing = false, children }: ReportStateProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>读取失败</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    )
  }

  if (empty) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{refreshing ? "刷新中" : "暂无数据"}</EmptyTitle>
          {refreshing ? null : <EmptyDescription>刷新后查看本机记录。</EmptyDescription>}
        </EmptyHeader>
      </Empty>
    )
  }

  return <>{children}</>
}
