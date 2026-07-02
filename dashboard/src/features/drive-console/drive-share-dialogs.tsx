import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import {
  DRIVE_DEFAULT_ACCESS_SETTINGS,
  type DriveAccessSettingsInput,
  type DriveBrowserChildrenPageDto,
  type DriveShareAccessMode,
  type DriveShareListItemDto,
} from '@synapse/shared'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
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
const DRIVE_SHARE_LIST_PAGE_LIMIT = 50

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
  const [editorEmailInput, setEditorEmailInput] = useState('')
  const [editorEmailError, setEditorEmailError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSettings({ ...DRIVE_DEFAULT_ACCESS_SETTINGS, editorEmails: [] })
    setEditorEmailInput('')
    setEditorEmailError(null)
  }, [open])

  const updateAccessMode = (value: DriveShareAccessMode) => {
    setEditorEmailError(null)
    setSettings((current) => ({
      ...current,
      accessMode: value,
      editorEmails: value === 'specified_users_edit' ? current.editorEmails : [],
    }))
    if (value !== 'specified_users_edit') setEditorEmailInput('')
  }
  const addEditorEmails = () => {
    if (!editorEmailInput.trim()) {
      setEditorEmailError('请输入邮箱。')
      return
    }
    const result = mergeDriveShareEditorEmails(settings.editorEmails ?? [], editorEmailInput)
    if (result.error) {
      setEditorEmailError(result.error)
      return
    }
    setSettings((current) => ({ ...current, editorEmails: result.emails }))
    setEditorEmailInput('')
    setEditorEmailError(null)
  }
  const removeEditorEmail = (email: string) => {
    setSettings((current) => ({
      ...current,
      editorEmails: (current.editorEmails ?? []).filter((item) => item !== email),
    }))
    setEditorEmailError(null)
  }
  const confirm = () => {
    const result = prepareDriveShareSettingsForSubmit(settings, editorEmailInput)
    if (result.error) {
      setEditorEmailError(result.error)
      return
    }
    setEditorEmailError(null)
    setEditorEmailInput('')
    void onConfirm(result.settings)
  }
  const showEditorEmails = settings.accessMode === 'specified_users_edit'
  const editorEmails = settings.editorEmails ?? []

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
              onValueChange={(value) => updateAccessMode(value as DriveShareAccessMode)}
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
          {showEditorEmails ? (
            <div className='grid gap-2'>
              <Label htmlFor='drive-share-editor-email'>可编辑用户</Label>
              <div className='flex gap-2'>
                <Input
                  id='drive-share-editor-email'
                  value={editorEmailInput}
                  placeholder='name@example.com'
                  aria-invalid={Boolean(editorEmailError)}
                  onChange={(event) => {
                    setEditorEmailInput(event.target.value)
                    if (editorEmailError) setEditorEmailError(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    addEditorEmails()
                  }}
                />
                <Button type='button' variant='outline' onClick={addEditorEmails}>添加</Button>
              </div>
              {editorEmailError ? <div className='text-sm text-destructive'>{editorEmailError}</div> : null}
              {editorEmails.length > 0 ? (
                <div className='flex flex-wrap gap-2'>
                  {editorEmails.map((email) => (
                    <Badge key={email} variant='outline' className='gap-1 pr-1'>
                      {email}
                      <button
                        type='button'
                        className='inline-flex rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                        aria-label={`移除 ${email}`}
                        onClick={() => removeEditorEmail(email)}
                      >
                        <X className='h-3 w-3' />
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
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
            onClick={confirm}
          >
            创建分享
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
  const [page, setPage] = useState<DriveBrowserChildrenPageDto | null>(null)
  const [filter, setFilter] = useState<ShareFilter>('file')
  const [loading, setLoading] = useState(false)
  const [actionShareId, setActionShareId] = useState<string | null>(null)

  const load = async ({ offset = 0, append = false }: { readonly offset?: number; readonly append?: boolean } = {}) => {
    setLoading(true)
    try {
      const nextPage = await driveApi.listShares({ offset, limit: DRIVE_SHARE_LIST_PAGE_LIMIT })
      setItems((current) => append ? [...current, ...nextPage.items] : [...nextPage.items])
      setPage(nextPage.page)
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
    setActionShareId(item.id)
    try {
      await driveApi.disableShare(item.id)
      await load()
      await onChanged()
    } catch (error) {
      toast(errorMessage(error, '取消分享失败'))
    } finally {
      setActionShareId(null)
    }
  }

  const visible = items.filter((item) => item.itemType === filter)
  const canLoadMore = Boolean(page?.hasMore && page.nextOffset !== null)
  const loadMore = async () => {
    if (loading || !canLoadMore || page?.nextOffset === null || page?.nextOffset === undefined) return
    await load({ offset: page.nextOffset, append: true })
  }
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
          {loading && items.length === 0 ? <div className='text-sm text-muted-foreground'>加载中</div> : null}
          {!loading && visible.length === 0 && !canLoadMore ? <div className='text-sm text-muted-foreground'>暂无分享</div> : null}
          {visible.map((item) => (
            <div key={item.id} className='flex items-center justify-between gap-3 border-b py-2'>
              <div className='min-w-0 flex-1'>
                <div className='truncate text-sm font-medium'>{item.itemName}</div>
                <Input value={item.password ? item.urlWithPassword : item.url} readOnly className='mt-1 font-mono text-xs' />
              </div>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                disabled={actionShareId === item.id}
                onClick={() => {
                  void disableShare(item)
                }}
              >
                取消分享
              </Button>
            </div>
          ))}
          {canLoadMore ? (
            <div className='flex justify-center pt-2'>
              <Button type='button' variant='outline' size='sm' disabled={loading} onClick={() => { void loadMore() }}>
                {loading ? '加载中' : '加载更多'}
              </Button>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type DriveShareSettingsSubmitResult =
  | { readonly settings: DriveAccessSettingsInput; readonly error: null }
  | { readonly settings: null; readonly error: string }

export function prepareDriveShareSettingsForSubmit(
  settings: DriveAccessSettingsInput,
  pendingEditorEmails: string
): DriveShareSettingsSubmitResult {
  if (settings.accessMode !== 'specified_users_edit') {
    return { settings: { ...settings, editorEmails: [] }, error: null }
  }
  const result = mergeDriveShareEditorEmails(settings.editorEmails ?? [], pendingEditorEmails)
  if (result.error) return { settings: null, error: result.error }
  if (result.emails.length === 0) return { settings: null, error: '请至少添加一个可编辑用户。' }
  return {
    settings: {
      ...settings,
      editorEmails: result.emails,
    },
    error: null,
  }
}

export function mergeDriveShareEditorEmails(
  currentEmails: readonly string[],
  input: string
): { readonly emails: readonly string[]; readonly error: string | null } {
  const emails: string[] = []
  const seen = new Set<string>()
  for (const value of currentEmails) {
    const email = normalizeDriveShareEditorEmail(value)
    if (!email || seen.has(email)) continue
    seen.add(email)
    emails.push(email)
  }
  const values = input.split(/[\s,;]+/u).filter(Boolean)
  for (const value of values) {
    const email = normalizeDriveShareEditorEmail(value)
    if (!email) return { emails, error: '邮箱格式无效。' }
    if (seen.has(email)) continue
    seen.add(email)
    emails.push(email)
  }
  return { emails, error: null }
}

function normalizeDriveShareEditorEmail(value: string): string | null {
  const email = value.trim().toLowerCase()
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return null
  return email
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}
