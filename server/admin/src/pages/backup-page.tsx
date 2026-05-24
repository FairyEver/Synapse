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
  const [downloadingFilename, setDownloadingFilename] = React.useState<string | null>(null)
  const [deletingFilename, setDeletingFilename] = React.useState<string | null>(null)
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null)

  const loadList = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const backups = await adminApi.listBackups()
      setList(backups)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "请求失败")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadList()
  }, [loadList])

  async function handleBackup() {
    setBackingUp(true)
    setError(null)
    setSuccessMessage(null)
    try {
      const result = await adminApi.triggerBackup()
      await loadList()
      setSuccessMessage(`已备份 ${result.filename}`)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "备份失败")
    } finally {
      setBackingUp(false)
    }
  }

  async function handleDelete(filename: string) {
    if (!window.confirm(`确定删除备份 ${filename}？`)) {
      return
    }
    setError(null)
    setSuccessMessage(null)
    setDeletingFilename(filename)
    try {
      await adminApi.deleteBackup(filename)
      await loadList()
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "删除失败")
    } finally {
      setDeletingFilename(null)
    }
  }

  async function handleDownload(filename: string) {
    setError(null)
    setSuccessMessage(null)
    setDownloadingFilename(filename)
    try {
      await adminApi.downloadBackup(filename)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "下载失败")
    } finally {
      setDownloadingFilename(null)
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
      {successMessage ? <p className="text-sm text-muted-foreground">{successMessage}</p> : null}
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
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((file) => (
              <TableRow key={file.filename}>
                <TableCell>{file.filename}</TableCell>
                <TableCell>{formatSize(file.size)}</TableCell>
                <TableCell>{formatDate(file.createdAt)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`下载备份 ${file.filename}`}
                      disabled={downloadingFilename === file.filename}
                      onClick={() => void handleDownload(file.filename)}
                    >
                      {downloadingFilename === file.filename ? "下载中…" : "下载"}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      aria-label={`删除备份 ${file.filename}`}
                      disabled={deletingFilename === file.filename}
                      onClick={() => void handleDelete(file.filename)}
                    >
                      {deletingFilename === file.filename ? "删除中…" : "删除"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  )
}
