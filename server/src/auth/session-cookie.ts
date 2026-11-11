/** __Host- cookies cannot be planted by sibling applications through a parent Domain. */
export function sessionCookieName(baseName: string): string {
  return process.env.NODE_ENV === "production" ? `__Host-${baseName}` : baseName
}
