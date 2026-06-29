import { useEffect, useState } from 'react'
import {
  DRIVE_DEFAULT_ACCESS_SETTINGS,
  type DriveAccessSettingsInput,
  type DriveShareAccessMode,
  type DriveShareListItemDto,
} from '@synapse/shared'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { driveApi } from '@/lib/api'

type ShareFilter = 'file' | 'folder'

export function DriveShareSettingsDialog({
  itemName,
  open,
  submitting,
  onConfirm,
  onOpenChange,
}: {
  readonly itemName: string
  readonly open: boolean
  readonly submitting: boolean
  readonly onConfirm: (settings: DriveAccessSettingsInput) => Promise<void>
  readonly onOpenChange: (open: boolean) => void
}) {
  const [settings, setSettings] = useState<DriveAccessSettingsInput>(() => ({
    ...DRIVE_DEFAULT_ACCESS_SETTINGS,
    editorEmails: [],
  }))

  useEffect(() => {
    if (!open) return
    setSettings({ ...DRIVE_DEFAULT_ACCESS_SETTINGS, editorEmails: [] })
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>分享设置</DialogTitle>
        </DialogHeader>
        <div className='grid gap-4'>
          <div className='text-sm text-muted-foreground'>{itemName}</div>
          <div className='grid gap-2'>
            <Label htmlFor='drive-share-access-mode'>权限</Label>
            <Select
              value={settings.accessMode ?? 'link_read'}
              onValueChange={(value) => setSettings((current) => ({ ...current, accessMode: value as DriveShareAccessMode }))}
            >
              <SelectTrigger id='drive-share-access-mode' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='link_read'>可阅读</SelectItem>
                <SelectItem value='link_edit'>登录用户可编辑</SelectItem>
                <SelectItem value='specified_users_edit'>指定用户可编辑</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className='flex items-center justify-between gap-3' htmlFor='drive-share-password-enabled'>
            <span className='text-sm font-medium'>需要密码</span>
            <Switch
              id='drive-share-password-enabled'
              checked={settings.passwordEnabled}
              onCheckedChange={(checked) => setSettings((current) => ({ ...current, passwordEnabled: checked }))}
            />
          </label>
          <div className='grid gap-2'>
            <Label htmlFor='drive-share-expires-in'>有效时长</Label>
            <Select
              value={settings.expiresIn}
              onValueChange={(value) => setSettings((current) => ({ ...current, expiresIn: value as DriveAccessSettingsInput['expiresIn'] }))}
            >
              <SelectTrigger id='drive-share-expires-in' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='3d'>3 天</SelectItem>
                <SelectItem value='7d'>7 天</SelectItem>
                <SelectItem value='30d'>30 天</SelectItem>
                <SelectItem value='1y'>1 年</SelectItem>
                <SelectItem value='forever'>永久</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button type='button' variant='outline' disabled={submitting} onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            type='button'
            disabled={submitting}
            onClick={() => {
              void onConfirm({ ...settings, editorEmails: settings.editorEmails ?? [] })
            }}
          >
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DriveSharesDialog({
  open,
  onChanged,
  onOpenChange,
}: {
  readonly open: boolean
  readonly onChanged: () => Promise<void>
  readonly onOpenChange: (open: boolean) => void
}) {
  const [items, setItems] = useState<DriveShareListItemDto[]>([])
  const [filter, setFilter] = useState<ShareFilter>('file')
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const page = await driveApi.listShares({ offset: 0, limit: 50 })
      setItems([...page.items])
    } catch (error) {
      toast(errorMessage(error, '分享列表加载失败'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load()
  }, [open])

  const disableShare = async (item: DriveShareListItemDto) => {
    try {
      await driveApi.disableShare(item.id)
      await load()
      await onChanged()
    } catch (error) {
      toast(errorMessage(error, '取消分享失败'))
    }
  }

  const visible = items.filter((item) => item.itemType === filter)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-3xl' aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>我的分享</DialogTitle>
        </DialogHeader>
        <Tabs value={filter} onValueChange={(value) => setFilter(value as ShareFilter)}>
          <TabsList>
            <TabsTrigger value='file'>文件</TabsTrigger>
            <TabsTrigger value='folder'>文件夹</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className='grid gap-2'>
          {loading ? <div className='text-sm text-muted-foreground'>加载中</div> : null}
          {!loading && visible.length === 0 ? <div className='text-sm text-muted-foreground'>暂无分享</div> : null}
          {visible.map((item) => (
            <div key={item.id} className='flex items-center justify-between gap-3 border-b py-2'>
              <div className='min-w-0'>
                <div className='truncate text-sm font-medium'>{item.itemName}</div>
                <Input value={item.password ? item.urlWithPassword : item.url} readOnly className='mt-1 font-mono text-xs' />
              </div>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => {
                  void disableShare(item)
                }}
              >
                取消分享
              </Button>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}
