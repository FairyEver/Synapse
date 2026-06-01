import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { AdminUserRow, ModulePermissionDefinition } from '@/lib/api'

type UserModulePermissionsSheetProps = {
  user: AdminUserRow | null
  definitions: readonly ModulePermissionDefinition[]
  permissionKeys: ReadonlySet<string>
  isLoading: boolean
  isSaving: boolean
  error: string
  open: boolean
  onClose: () => void
  onRetry: () => void
  onSave: () => void
  onToggle: (key: string, checked: boolean) => void
}

export function UserModulePermissionsSheet({
  user,
  definitions,
  permissionKeys,
  isLoading,
  isSaving,
  error,
  open,
  onClose,
  onRetry,
  onSave,
  onToggle,
}: UserModulePermissionsSheetProps) {
  const canSave = !isLoading && !isSaving && !error

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <SheetContent className='w-full overflow-y-auto sm:max-w-xl'>
        <SheetHeader>
          <SheetTitle>{user?.email ?? '模块权限'}</SheetTitle>
          <SheetDescription>选择可访问模块。</SheetDescription>
        </SheetHeader>

        <div className='grid gap-4 px-4'>
          {isLoading ? (
            <div className='text-sm text-muted-foreground'>加载中...</div>
          ) : null}
          {error ? (
            <div className='grid gap-2'>
              <div className='text-sm text-destructive'>{error}</div>
              <Button
                type='button'
                variant='outline'
                size='sm'
                className='w-fit'
                onClick={onRetry}
              >
                重试
              </Button>
            </div>
          ) : null}
          {!isLoading && !error ? (
            <div className='grid gap-3'>
              {definitions.length === 0 ? (
                <div className='text-sm text-muted-foreground'>暂无模块权限</div>
              ) : null}
              {definitions.map((definition) => (
                <Label key={definition.key} className='items-center gap-3'>
                  <Checkbox
                    checked={permissionKeys.has(definition.key)}
                    disabled={isSaving}
                    onCheckedChange={(checked) =>
                      onToggle(definition.key, checked === true)
                    }
                  />
                  <span>{definition.label}</span>
                </Label>
              ))}
            </div>
          ) : null}
        </div>

        <SheetFooter className='sm:flex-row sm:justify-end'>
          <Button
            type='button'
            variant='outline'
            disabled={isSaving}
            onClick={onClose}
          >
            取消
          </Button>
          <Button type='button' disabled={!canSave} onClick={onSave}>
            {isSaving ? '保存中...' : '保存'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
