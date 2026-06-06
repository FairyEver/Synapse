import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { AdminUserRow, LiveClientRow } from '@/lib/api'
import {
  liveClientStatusLabels,
  liveClientStatusVariants,
} from './live-client-utils'

type UserLiveClientsSheetProps = {
  open: boolean
  user: AdminUserRow | null
  clients: readonly LiveClientRow[]
  onClose: () => void
}

export function UserLiveClientsSheet({
  open,
  user,
  clients,
  onClose,
}: UserLiveClientsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <SheetContent className='w-full overflow-y-auto sm:max-w-xl'>
        <SheetHeader>
          <SheetTitle>{user?.email ?? '客户端'}</SheetTitle>
        </SheetHeader>

        <div className='grid gap-3 px-4'>
          {clients.length === 0 ? (
            <div className='text-sm text-muted-foreground'>暂无客户端</div>
          ) : null}
          {clients.map((client) => (
            <div
              key={`${client.userId ?? 'unknown'}:${client.clientInstanceId}`}
              className='grid gap-2 rounded-md border p-3'
            >
              <div className='flex items-center justify-between gap-3'>
                <span className='font-medium'>{client.deviceName}</span>
                <Badge variant={liveClientStatusVariants[client.status]}>
                  {liveClientStatusLabels[client.status]}
                </Badge>
              </div>
              <div className='flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground'>
                <span>{client.platform}</span>
                <span>{client.appVersion}</span>
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
