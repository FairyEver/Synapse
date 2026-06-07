export function getUsersTableError(
  isUsersError: boolean,
  usersError: unknown,
  isModulePermissionDefinitionsError = false,
  modulePermissionDefinitionsError: unknown = null
): unknown | null {
  if (isUsersError) return usersError
  return isModulePermissionDefinitionsError ? modulePermissionDefinitionsError : null
}

export function getUsersTableLoading(input: {
  isUsersError: boolean
  isUsersLoading: boolean
  isModulePermissionDefinitionsLoading: boolean
}): boolean {
  if (input.isUsersError) return false
  return input.isUsersLoading || input.isModulePermissionDefinitionsLoading
}
