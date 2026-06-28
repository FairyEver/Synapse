import path from "node:path"

const PATH_OUTSIDE_BINDING_MESSAGE = "同步路径超出绑定目录。"

export function normalizeLocalPath(input: string): string {
  return path.resolve(input)
}

export function assertInsideBindingRoot(rootPath: string, targetPath: string): string {
  const root = normalizeLocalPath(rootPath)
  const target = normalizeLocalPath(targetPath)
  const relative = path.relative(root, target)
  if (relative === "") return target
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(PATH_OUTSIDE_BINDING_MESSAGE)
  }
  return target
}

export function toDriveSyncRelativePath(rootPath: string, targetPath: string): string {
  const root = normalizeLocalPath(rootPath)
  const target = assertInsideBindingRoot(root, targetPath)
  const relative = path.relative(root, target)
  return toPosixPath(relative)
}

export function resolveBindingChildPath(rootPath: string, relativePath: string): string {
  assertSafeRelativePath(relativePath)
  return assertInsideBindingRoot(rootPath, path.join(rootPath, relativePath))
}

export function pathCollisionKey(relativePath: string): string {
  return toPosixPath(relativePath).toLowerCase()
}

function assertSafeRelativePath(relativePath: string): void {
  if (relativePath === "") return
  if (path.isAbsolute(relativePath) || /^[A-Za-z]:[\\/]/u.test(relativePath)) {
    throw new Error(PATH_OUTSIDE_BINDING_MESSAGE)
  }
  const segments = relativePath.split(/[\\/]+/u)
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(PATH_OUTSIDE_BINDING_MESSAGE)
  }
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/")
}
