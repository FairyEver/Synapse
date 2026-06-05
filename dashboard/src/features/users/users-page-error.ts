export function getUsersTableError(isUsersError: boolean, usersError: unknown): unknown | null {
  return isUsersError ? usersError : null
}
