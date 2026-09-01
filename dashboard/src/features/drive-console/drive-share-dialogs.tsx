import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import {
  DRIVE_DEFAULT_ACCESS_SETTINGS,
  DRIVE_DEFAULT_SITE_ACCESS_SETTINGS,
  type DriveAccessExpiresIn,
  type DriveAccessSettingsInput,
  type DriveAccessSettingsUpdateInput,
  type DriveBrowserChildrenPageDto,
  type DriveBrowserItemDto,
  type DriveShareAccessMode,
  type DriveShareListItemDto,
  type DriveSitePreflightDto,
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
import { formatDriveBrowserBytes } from '@/features/drive-browser/shared/drive-format'
import { trackedDriveApi as driveApi } from '@/features/drive-browser/shared/drive-telemetry-api'
import { DriveWebSharesPanel } from './drive-sites-dialogs'

type ShareCreateMode = 'drive' | 'web'
type ShareFilter = 'file' | 'folder' | 'web'
type ShareCreatedResult = { readonly name: string; readonly url: string }
const DRIVE_SHARE_LIST_PAGE_LIMIT = 50

function createDefaultAccessSettings(): DriveAccessSettingsInput {
  return { ...DRIVE_DEFAULT_ACCESS_SETTINGS, editorEmails: [] }
}

export function DriveShareSettingsDialog({
  item,
  open,
  onCreated,
  onOpenChange,
}: {
  readonly item: Pick<DriveBrowserItemDto, 'id' | 'name' | 'type'> | null
  readonly open: boolean
  readonly onCreated: () => Promise<void>
  readonly onOpenChange: (open: boolean) => void
}) {
  const [mode, setMode] = useState<ShareCreateMode>('drive')
  const [settings, setSettings] = useState<DriveAccessSettingsInput>(createDefaultAccessSettings)
  const [editorEmailInput, setEditorEmailInput] = useState('')
  const [editorEmailError, setEditorEmailError] = useState<string | null>(null)
  const [preflight, setPreflight] = useState<DriveSitePreflightDto | null>(null)
  const [preflightError, setPreflightError] = useState<string | null>(null)
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [entryPath, setEntryPath] = useState('')
  const [webPasswordEnabled, setWebPasswordEnabled] = useState(false)
  const [webExpiresIn, setWebExpiresIn] = useState<DriveAccessExpiresIn>(DRIVE_DEFAULT_SITE_ACCESS_SETTINGS.expiresIn)
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<ShareCreatedResult | null>(null)

  useEffect(() => {
    if (!open) return
    setMode('drive')
    setSettings(createDefaultAccessSettings())
    setEditorEmailInput('')
    setEditorEmailError(null)
    setPreflight(null)
    setPreflightError(null)
    setPreflightLoading(false)
    setEntryPath('')
    setWebPasswordEnabled(false)
    setWebExpiresIn(DRIVE_DEFAULT_SITE_ACCESS_SETTINGS.expiresIn)
    setSubmitting(false)
    setCreated(null)
  }, [item?.id, open])

  useEffect(() => {
    if (!open || mode !== 'web' || item?.type !== 'folder') return
    let cancelled = false
    setPreflight(null)
    setPreflightError(null)
    setPreflightLoading(true)
    setEntryPath('')
    void driveApi.preflightSite(item.id).then((result) => {
      if (cancelled) return
      setPreflight(result)
      setEntryPath(result.defaultEntryPath ?? '')
    }).catch((error: unknown) => {
      if (!cancelled) setPreflightError(errorMessage(error, '网页分享检查失败'))
    }).finally(() => {
      if (!cancelled) setPreflightLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [item?.id, item?.type, mode, open])

  const createDriveShare = async () => {
    if (!item) return false
    const prepared = prepareDriveShareSettingsForSubmit(settings, editorEmailInput)
    if (prepared.settings === null) {
      setEditorEmailError(prepared.error)
      return false
    }
    setEditorEmailError(null)
    const result = await driveApi.createShare(item.id, prepared.settings)
    setCreated({ name: item.name, url: result.password ? result.urlWithPassword : result.url })
    return true
  }

  const createWebShare = async () => {
    if (!item || item.type !== 'folder' || !preflight || preflight.sourceFolderItemId !== item.id || !entryPath) return false
    const result = await driveApi.createSite({
      sourceFolderItemId: item.id,
      name: item.name,
      entryPath,
      accessMode: webPasswordEnabled ? 'password' : 'public',
      expiresIn: webExpiresIn,
    })
    setCreated({ name: item.name, url: result.password ? result.urlWithPassword : result.url })
    return true
  }

  const createShare = async () => {
    if (submitting || !item) return
    setSubmitting(true)
    try {
      const didCreate = mode === 'web' ? await createWebShare() : await createDriveShare()
      if (!didCreate) {
        setSubmitting(false)
        return
      }
    } catch (error) {
      toast(errorMessage(error, mode === 'web' ? '网页分享创建失败' : '分享失败'))
      setSubmitting(false)
      return
    }
    try {
      await onCreated()
    } catch (error) {
      toast(errorMessage(error, '分享已创建，但列表刷新失败'))
    } finally {
      setSubmitting(false)
    }
  }

  const canCreateWebShare = Boolean(
    item?.type === 'folder'
    && preflight
    && preflight.sourceFolderItemId === item.id
    && entryPath,
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-drive-telemetry-scope='portal' aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{created ? '分享已创建' : '分享'}</DialogTitle>
        </DialogHeader>
        {created ? (
          <div className='grid gap-3'>
            <div className='text-sm text-muted-foreground'>{created.name}</div>
            <div className='flex gap-2'>
              <Input value={created.url} readOnly className='font-mono text-xs' onFocus={(event) => event.currentTarget.select()} />
              <Button type='button' variant='outline' onClick={() => { void copyShareUrl(created.url) }}>复制链接</Button>
            </div>
          </div>
        ) : (
          <div className='grid gap-4'>
            <div className='text-sm text-muted-foreground'>{item?.name}</div>
            {item?.type === 'folder' ? (
              <Tabs value={mode} onValueChange={(value) => setMode(value as ShareCreateMode)}>
                <TabsList>
                  <TabsTrigger value='drive'>文件夹分享</TabsTrigger>
                  <TabsTrigger value='web'>网页分享</TabsTrigger>
                </TabsList>
              </Tabs>
            ) : null}
            {mode === 'drive' ? (
              <DriveShareAccessFields
                idPrefix='drive-share-create'
                settings={settings}
                editorEmailInput={editorEmailInput}
                editorEmailError={editorEmailError}
                onEditorEmailInputChange={setEditorEmailInput}
                onEditorEmailErrorChange={setEditorEmailError}
                onSettingsChange={setSettings}
              />
            ) : (
              <div className='grid gap-4'>
                {preflightLoading ? <div className='text-sm text-muted-foreground'>正在检查文件夹</div> : null}
                {preflightError ? <div className='text-sm text-destructive'>{preflightError}</div> : null}
                {preflight && preflight.htmlFiles.length === 0 ? <div className='text-sm text-muted-foreground'>文件夹中没有 HTML 文件</div> : null}
                {preflight && preflight.htmlFiles.length > 0 ? (
                  <>
                    <div className='grid gap-2'>
                      <Label htmlFor='drive-web-share-entry'>入口页</Label>
                      <Select value={entryPath} onValueChange={setEntryPath}>
                        <SelectTrigger id='drive-web-share-entry' className='w-full'>
                          <SelectValue placeholder='选择入口页' />
                        </SelectTrigger>
                        <SelectContent data-drive-telemetry-scope='portal'>
                          {preflight.htmlFiles.map((htmlFile) => (
                            <SelectItem key={htmlFile} value={htmlFile}>{htmlFile}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className='text-sm text-muted-foreground'>
                      {preflight.fileCount} 个文件，{formatDriveBrowserBytes(preflight.totalBytes)}{preflight.includesJavaScript ? '，包含 JavaScript' : ''}
                    </div>
                  </>
                ) : null}
                <label className='flex items-center justify-between gap-3' htmlFor='drive-web-share-create-password-enabled'>
                  <span className='text-sm font-medium'>需要密码</span>
                  <Switch id='drive-web-share-create-password-enabled' checked={webPasswordEnabled} onCheckedChange={setWebPasswordEnabled} />
                </label>
                <div className='grid gap-2'>
                  <Label htmlFor='drive-web-share-create-expires-in'>有效时长</Label>
                  <ExpirySelect id='drive-web-share-create-expires-in' value={webExpiresIn} onValueChange={setWebExpiresIn} />
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          {created ? (
            <Button type='button' onClick={() => onOpenChange(false)}>完成</Button>
          ) : (
            <>
              <Button type='button' variant='outline' disabled={submitting} onClick={() => onOpenChange(false)}>取消</Button>
              <Button
                type='button'
                disabled={submitting || (mode === 'web' && !canCreateWebShare)}
                onClick={() => { void createShare() }}
              >
                创建分享
              </Button>
            </>
          )}
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
  const [accessTarget, setAccessTarget] = useState<DriveShareListItemDto | null>(null)
  const [accessSettings, setAccessSettings] = useState<DriveAccessSettingsInput>(createDefaultAccessSettings)
  const [editorEmailInput, setEditorEmailInput] = useState('')
  const [editorEmailError, setEditorEmailError] = useState<string | null>(null)
  const [accessExpiryChanged, setAccessExpiryChanged] = useState(false)
  const [accessPasswordChanged, setAccessPasswordChanged] = useState(false)

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
    if (open) {
      setFilter('file')
      void load()
    }
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

  const openAccessSettings = (item: DriveShareListItemDto) => {
    setAccessTarget(item)
    setAccessSettings({
      passwordEnabled: item.passwordEnabled,
      expiresIn: DRIVE_DEFAULT_ACCESS_SETTINGS.expiresIn,
      accessMode: item.accessMode,
      editorEmails: item.editorEmails,
    })
    setEditorEmailInput('')
    setEditorEmailError(null)
    setAccessExpiryChanged(false)
    setAccessPasswordChanged(false)
  }

  const updateShareAccess = async () => {
    if (!accessTarget) return
    const prepared = prepareDriveShareSettingsForSubmit(accessSettings, editorEmailInput)
    if (prepared.settings === null) {
      setEditorEmailError(prepared.error)
      return
    }
    setActionShareId(accessTarget.id)
    try {
      const update = toDriveShareAccessUpdate(prepared.settings, {
        includeExpiry: accessExpiryChanged,
        includePassword: accessPasswordChanged,
      })
      await driveApi.createShare(accessTarget.itemId, update)
      setAccessTarget(null)
      await load()
      await onChanged()
    } catch (error) {
      toast(errorMessage(error, '访问设置保存失败'))
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
      <DialogContent data-drive-telemetry-scope='portal' className='sm:max-w-4xl' aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>分享管理</DialogTitle>
        </DialogHeader>
        <Tabs value={filter} onValueChange={(value) => setFilter(value as ShareFilter)}>
          <TabsList>
            <TabsTrigger value='file'>文件</TabsTrigger>
            <TabsTrigger value='folder'>文件夹</TabsTrigger>
            <TabsTrigger value='web'>网页</TabsTrigger>
          </TabsList>
        </Tabs>
        {filter === 'web' ? (
          <DriveWebSharesPanel active={open} onChanged={onChanged} onCopyUrl={copyShareUrl} />
        ) : (
          <div className='grid gap-2'>
            {loading && items.length === 0 ? <div className='text-sm text-muted-foreground'>加载中</div> : null}
            {!loading && visible.length === 0 && !canLoadMore ? <div className='text-sm text-muted-foreground'>暂无分享</div> : null}
            {visible.map((item) => (
              <div key={item.id} className='flex items-center justify-between gap-3 border-b py-2'>
                <div className='min-w-0 flex-1'>
                  <div className='truncate text-sm font-medium'>{item.itemName}</div>
                  <Input value={item.password ? item.urlWithPassword : item.url} readOnly className='mt-1 font-mono text-xs' />
                </div>
                <div className='flex shrink-0 items-center gap-1'>
                  <Button type='button' variant='ghost' size='sm' onClick={() => { void copyShareUrl(item.password ? item.urlWithPassword : item.url) }}>复制链接</Button>
                  <Button type='button' variant='ghost' size='sm' disabled={actionShareId === item.id} onClick={() => openAccessSettings(item)}>访问设置</Button>
                  <Button type='button' variant='ghost' size='sm' disabled={actionShareId === item.id} onClick={() => { void disableShare(item) }}>取消分享</Button>
                </div>
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
        )}
        <DialogFooter>
          <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
        <Dialog open={accessTarget !== null} onOpenChange={(nextOpen) => {
          if (!nextOpen) setAccessTarget(null)
        }}>
          <DialogContent data-drive-telemetry-scope='portal' aria-describedby={undefined}>
            <DialogHeader><DialogTitle>访问设置</DialogTitle></DialogHeader>
            <DriveShareAccessFields
              idPrefix='drive-share-manage'
              settings={accessSettings}
              editorEmailInput={editorEmailInput}
              editorEmailError={editorEmailError}
              onEditorEmailInputChange={setEditorEmailInput}
              onEditorEmailErrorChange={setEditorEmailError}
              onSettingsChange={setAccessSettings}
              preserveExistingExpiry={!accessExpiryChanged}
              onExpiryChange={() => setAccessExpiryChanged(true)}
              onPasswordChange={() => setAccessPasswordChanged(true)}
            />
            <DialogFooter>
              <Button type='button' variant='outline' disabled={Boolean(actionShareId)} onClick={() => setAccessTarget(null)}>取消</Button>
              <Button type='button' disabled={Boolean(actionShareId)} onClick={() => { void updateShareAccess() }}>保存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}

function DriveShareAccessFields({
  idPrefix,
  settings,
  editorEmailInput,
  editorEmailError,
  onEditorEmailInputChange,
  onEditorEmailErrorChange,
  onSettingsChange,
  preserveExistingExpiry = false,
  onExpiryChange,
  onPasswordChange,
}: {
  readonly idPrefix: string
  readonly settings: DriveAccessSettingsInput
  readonly editorEmailInput: string
  readonly editorEmailError: string | null
  readonly onEditorEmailInputChange: (value: string) => void
  readonly onEditorEmailErrorChange: (value: string | null) => void
  readonly onSettingsChange: (settings: DriveAccessSettingsInput | ((current: DriveAccessSettingsInput) => DriveAccessSettingsInput)) => void
  readonly preserveExistingExpiry?: boolean
  readonly onExpiryChange?: () => void
  readonly onPasswordChange?: () => void
}) {
  const updateAccessMode = (value: DriveShareAccessMode) => {
    onEditorEmailErrorChange(null)
    onSettingsChange((current) => ({
      ...current,
      accessMode: value,
      editorEmails: value === 'specified_users_edit' ? current.editorEmails : [],
    }))
    if (value !== 'specified_users_edit') onEditorEmailInputChange('')
  }
  const addEditorEmails = () => {
    if (!editorEmailInput.trim()) {
      onEditorEmailErrorChange('请输入邮箱。')
      return
    }
    const result = mergeDriveShareEditorEmails(settings.editorEmails ?? [], editorEmailInput)
    if (result.error) {
      onEditorEmailErrorChange(result.error)
      return
    }
    onSettingsChange((current) => ({ ...current, editorEmails: result.emails }))
    onEditorEmailInputChange('')
    onEditorEmailErrorChange(null)
  }
  const removeEditorEmail = (email: string) => {
    onSettingsChange((current) => ({
      ...current,
      editorEmails: (current.editorEmails ?? []).filter((item) => item !== email),
    }))
    onEditorEmailErrorChange(null)
  }
  const showEditorEmails = settings.accessMode === 'specified_users_edit'
  const editorEmails = settings.editorEmails ?? []

  return (
    <div className='grid gap-4'>
      <div className='grid gap-2'>
        <Label htmlFor={`${idPrefix}-access-mode`}>权限</Label>
        <Select value={settings.accessMode ?? 'link_read'} onValueChange={(value) => updateAccessMode(value as DriveShareAccessMode)}>
          <SelectTrigger id={`${idPrefix}-access-mode`} className='w-full'><SelectValue /></SelectTrigger>
          <SelectContent data-drive-telemetry-scope='portal'>
            <SelectItem value='link_read'>可阅读</SelectItem>
            <SelectItem value='link_edit'>登录用户可编辑</SelectItem>
            <SelectItem value='specified_users_edit'>指定用户可编辑</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {showEditorEmails ? (
        <div className='grid gap-2'>
          <Label htmlFor={`${idPrefix}-editor-email`}>可编辑用户</Label>
          <div className='flex gap-2'>
            <Input
              id={`${idPrefix}-editor-email`}
              value={editorEmailInput}
              placeholder='name@example.com'
              aria-invalid={Boolean(editorEmailError)}
              onChange={(event) => {
                onEditorEmailInputChange(event.target.value)
                if (editorEmailError) onEditorEmailErrorChange(null)
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
      <label className='flex items-center justify-between gap-3' htmlFor={`${idPrefix}-password-enabled`}>
        <span className='text-sm font-medium'>需要密码</span>
        <Switch
          id={`${idPrefix}-password-enabled`}
          checked={settings.passwordEnabled}
          onCheckedChange={(checked) => {
            onPasswordChange?.()
            onSettingsChange((current) => ({ ...current, passwordEnabled: checked }))
          }}
        />
      </label>
      <div className='grid gap-2'>
        <Label htmlFor={`${idPrefix}-expires-in`}>有效时长</Label>
        <ExpirySelect
          id={`${idPrefix}-expires-in`}
          value={preserveExistingExpiry ? undefined : settings.expiresIn}
          placeholder={preserveExistingExpiry ? '保持当前有效期' : undefined}
          onValueChange={(value) => {
            onExpiryChange?.()
            onSettingsChange((current) => ({ ...current, expiresIn: value }))
          }}
        />
      </div>
    </div>
  )
}

function ExpirySelect({
  id,
  value,
  placeholder,
  onValueChange,
}: {
  readonly id: string
  readonly value: DriveAccessExpiresIn | undefined
  readonly placeholder?: string
  readonly onValueChange: (value: DriveAccessExpiresIn) => void
}) {
  return (
    <Select value={value} onValueChange={(nextValue) => onValueChange(nextValue as DriveAccessExpiresIn)}>
      <SelectTrigger id={id} className='w-full'><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent data-drive-telemetry-scope='portal'>
        <SelectItem value='3d'>3 天</SelectItem>
        <SelectItem value='7d'>7 天</SelectItem>
        <SelectItem value='30d'>30 天</SelectItem>
        <SelectItem value='1y'>1 年</SelectItem>
        <SelectItem value='forever'>永久</SelectItem>
      </SelectContent>
    </Select>
  )
}

function toDriveShareAccessUpdate(
  settings: DriveAccessSettingsInput,
  options: { readonly includeExpiry: boolean; readonly includePassword: boolean },
): DriveAccessSettingsUpdateInput {
  return {
    ...(options.includePassword ? { passwordEnabled: settings.passwordEnabled } : {}),
    ...(options.includeExpiry ? { expiresIn: settings.expiresIn } : {}),
    accessMode: settings.accessMode,
    editorEmails: settings.editorEmails,
  }
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

async function copyShareUrl(url: string): Promise<void> {
  try {
    if (!navigator.clipboard) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(url)
    toast('已复制链接')
  } catch {
    toast('复制失败，请手动复制')
  }
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
