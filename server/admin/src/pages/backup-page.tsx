import * as React from "react"
import { PageState } from "@/components/page-state"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { adminApi, type BackupFile } from "@/lib/api"
import { formatDate } from "@/lib/format"

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function BackupPage() {
  const [list, setList] = React.useState<BackupFile[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [backingUp, setBackingUp] = React.useState(false)

  const loadList = React.useCallback(() => {
    setLoading(true)
    setError(null)
    adminApi.listBackups()
      .then(setList)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "请求失败")
      })
      .finally(() => setLoading(false))
  }, [])

  React.useEffect(() => {
    loadList()
  }, [loadList])

  async function handleBackup() {
    setBackingUp(true)
    try {
      await adminApi.triggerBackup()
      loadList()
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "备份失败")
    } finally {
      setBackingUp(false)
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center">
        <Button onClick={handleBackup} disabled={backingUp}>
          {backingUp ? "备份中…" : "立即备份"}
        </Button>
      </div>
      {loading ? <PageState>加载中</PageState> : null}
      {error ? <PageState>{error}</PageState> : null}
      {!loading && !error && list.length === 0 ? (
        <PageState>暂无备份记录。配置腾讯云 COS 后将启用自动备份功能。</PageState>
      ) : null}
      {list.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>文件名</TableHead>
              <TableHead>大小</TableHead>
              <TableHead>备份时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((file) => (
              <TableRow key={file.filename}>
                <TableCell>{file.filename}</TableCell>
                <TableCell>{formatSize(file.size)}</TableCell>
                <TableCell>{formatDate(file.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  )
}
