import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  adminApi,
  type AdminUserRow,
  type ModulePermissionDefinition,
} from '@/lib/api'
import { togglePermissionKey } from './module-permissions'

export function useUserModulePermissionsEditor() {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<AdminUserRow | null>(null)
  const [definitions, setDefinitions] = useState<ModulePermissionDefinition[]>([])
  const [permissionKeys, setPermissionKeys] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  async function open(userToEdit: AdminUserRow) {
    setUser(userToEdit)
    setError('')
    setIsLoading(true)
    setPermissionKeys(
      new Set(userToEdit.modulePermissions.map((item) => item.permissionKey))
    )

    try {
      const [nextDefinitions, permissions] = await Promise.all([
        adminApi.listModulePermissions(),
        adminApi.listUserModulePermissions(userToEdit.id),
      ])
      setDefinitions(nextDefinitions)
      setPermissionKeys(new Set(permissions.permissionKeys))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '加载失败')
    } finally {
      setIsLoading(false)
    }
  }

  function close() {
    if (isSaving) return
    setUser(null)
    setError('')
  }

  function toggle(key: string, checked: boolean) {
    setPermissionKeys((current) => togglePermissionKey(current, key, checked))
  }

  async function save() {
    if (!user) return

    setError('')
    setIsSaving(true)
    try {
      const result = await adminApi.replaceUserModulePermissions(
        user.id,
        [...permissionKeys]
      )
      setPermissionKeys(new Set(result.permissionKeys))
      toast.success('模块权限已保存')
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setUser(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '保存失败')
    } finally {
      setIsSaving(false)
    }
  }

  return {
    user,
    definitions,
    permissionKeys,
    isLoading,
    isSaving,
    error,
    isOpen: user !== null,
    close,
    open,
    retry: () => {
      if (user) void open(user)
    },
    save,
    toggle,
  }
}
