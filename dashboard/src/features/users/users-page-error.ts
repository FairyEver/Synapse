export function getUsersTableError(
  isUsersError: boolean,
  usersError: unknown
): unknown | null {
  if (isUsersError) return usersError
  return null
}

export function getUsersTableLoading(input: {
  isUsersError: boolean
  isUsersLoading: boolean
}): boolean {
  if (input.isUsersError) return false
  return input.isUsersLoading
}
