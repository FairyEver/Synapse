import { useEffect, useMemo, useState } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { adminApi, type ProblemFeedbackRow } from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTableColumnHeader, ServerDataTable } from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { RelativeTime } from '@/components/relative-time'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { getProblemFeedbackPreview } from './problem-feedback-preview'

const PAGE_SIZE = 10

export default function ProblemFeedbackPage() {
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['admin-problem-feedback', page],
    queryFn: () => adminApi.listProblemFeedback(page),
    gcTime: 0,
  })
  const selected = data?.data.find((item) => item.id === selectedId) ?? null

  useEffect(() => {
    setSelectedId(null)
    setDeleteOpen(false)
  }, [page])

  const deleteMutation = useMutation({
    mutationFn: adminApi.deleteProblemFeedback,
    onSuccess: async () => {
      setDeleteOpen(false)
      setSelectedId(null)
      await refetch()
    },
    onError: () => {
      toast.error('删除失败')
    },
  })

  const columns = useMemo<ColumnDef<ProblemFeedbackRow>[]>(() => [
    {
      accessorKey: 'receivedAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='接收时间' />
      ),
      cell: ({ row }) => (
        <RelativeTime
          className='tabular-nums'
          value={row.original.receivedAt}
          mode='absolute'
        />
      ),
      enableSorting: false,
      enableHiding: false,
      meta: { className: 'w-44' },
    },
    {
      id: 'content',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='正文预览' />
      ),
      cell: ({ row }) => (
        <span className='block truncate'>
          {getProblemFeedbackPreview(row.original.content)}
        </span>
      ),
      enableSorting: false,
      enableHiding: false,
      meta: { className: 'max-w-0' },
    },
    {
      id: 'actions',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='操作' />
      ),
      cell: ({ row }) => {
        const preview = getProblemFeedbackPreview(row.original.content)
        return (
          <div className='flex justify-end'>
            <Button
              variant='ghost'
              size='sm'
              aria-label={`查看 ${preview}`}
              onClick={(event) => {
                event.stopPropagation()
                setSelectedId(row.original.id)
              }}
            >
              查看
            </Button>
          </div>
        )
      },
      enableSorting: false,
      enableHiding: false,
      meta: {
        className: 'w-20',
        thClassName: 'text-right',
        tdClassName: 'text-right',
      },
    },
  ], [])

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>问题反馈</h1>
      </Header>
      <Main>
        <ServerDataTable
          columns={columns}
          data={data?.data ?? []}
          page={page}
          pageSize={PAGE_SIZE}
          total={data?.total ?? 0}
          error={isError ? error : null}
          isLoading={isLoading}
          loadingRowCount={PAGE_SIZE}
          onRetry={() => void refetch()}
          onPageChange={setPage}
          onPageSizeChange={() => undefined}
          showPageSize={false}
          clampPage={false}
          getRowProps={(row) => {
            const preview = getProblemFeedbackPreview(row.original.content)
            return {
              role: 'button',
              tabIndex: 0,
              'aria-label': preview,
              onClick: () => setSelectedId(row.original.id),
              onKeyDown: (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelectedId(row.original.id)
                }
              },
            }
          }}
        />
      </Main>

      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) setSelectedId(null)
        }}
      >
        <SheetContent className='sm:max-w-xl'>
          <SheetHeader>
            <SheetTitle>问题反馈</SheetTitle>
            <SheetDescription className='sr-only'>
              问题反馈完整正文
            </SheetDescription>
          </SheetHeader>
          {selected ? (
            <>
              <div className='min-h-0 flex-1 overflow-auto px-4'>
                <pre className='break-words whitespace-pre-wrap font-sans text-sm'>
                  {selected.content}
                </pre>
              </div>
              <SheetFooter>
                <Button
                  variant='destructive'
                  disabled={deleteMutation.isPending}
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 data-icon='inline-start' />
                  删除
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!deleteMutation.isPending) setDeleteOpen(open)
        }}
        title='删除问题反馈'
        desc='删除后不可恢复。'
        confirmText='删除'
        cancelBtnText='取消'
        destructive
        isLoading={deleteMutation.isPending}
        handleConfirm={() => {
          if (selected) deleteMutation.mutate(selected.id)
        }}
      />
    </>
  )
}
