export function getUsersTableError(isUsersError: boolean, usersError: unknown): unknown | null {
  return isUsersError ? usersError : null
}

export function getUsersTableLoading(input: {
  isUsersError: boolean
  isUsersLoading: boolean
  isModulePermissionDefinitionsLoading: boolean
}): boolean {
  if (input.isUsersError) return false
  return input.isUsersLoading || input.isModulePermissionDefinitionsLoading
}
