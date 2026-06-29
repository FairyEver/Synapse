import { useEffect, useState } from 'react'
import type { DriveTrashItemDto } from '@synapse/shared'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { driveApi } from '@/lib/api'

export function DriveTrashView({ onChanged }: { readonly onChanged: () => Promise<void> }) {
  const [items, setItems] = useState<DriveTrashItemDto[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const page = await driveApi.listTrash({ offset: 0, limit: 50 })
      setItems([...page.items])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (loading) return <div className='text-sm text-muted-foreground'>加载中</div>
  if (items.length === 0) return <div className='rounded-lg border p-6 text-center text-sm text-muted-foreground'>回收站为空</div>
  return (
    <div className='rounded-lg border bg-background'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>原路径</TableHead>
            <TableHead className='text-right'>操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>{item.name}</TableCell>
              <TableCell className='text-muted-foreground'>{item.originalPath ?? '-'}</TableCell>
              <TableCell className='text-right'>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  onClick={() => {
                    void driveApi.restoreItem(item.id).then(async () => {
                      await load()
                      await onChanged()
                    })
                  }}
                >
                  恢复
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  onClick={() => {
                    void driveApi.deleteTrashItem(item.id).then(async () => {
                      await load()
                      await onChanged()
                    })
                  }}
                >
                  删除
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
