import {
  contentStoreSkillMaxFileBytes,
  contentStoreSkillMaxTotalBytes,
  type ContentStoreFileDto,
} from '@synapse/shared'
import type { SkillEditorFile } from './content-store-editor-types'

const skillEntryPath = 'SKILL.md'
const textMimeTypes = new Set([
  'application/json',
  'application/javascript',
  'application/typescript',
  'application/xml',
  'application/x-yaml',
])
const textExtensions = new Set([
  '.css',
  '.csv',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mdx',
  '.mjs',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
])
const windowsReservedPathNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu
const windowsHostilePathSegmentChars = /[<>:"|?*\u0000-\u001f]/u

export function normalizeSkillFilePath(input: string): string {
  const value = input.trim().split('\\').join('/')
  if (!value || value.startsWith('/') || value.includes('//')) {
    throw new Error('文件路径无效')
  }
  const segments = value.split('/')
  if (segments.some(isInvalidSkillPathSegment)) {
    throw new Error('文件路径无效')
  }
  return segments.join('/')
}

function isInvalidSkillPathSegment(segment: string): boolean {
  return !segment ||
    segment === '.' ||
    segment === '..' ||
    windowsHostilePathSegmentChars.test(segment) ||
    windowsReservedPathNames.test(segment) ||
    segment.endsWith('.') ||
    segment.endsWith(' ')
}

export async function createInitialSkillFiles(): Promise<SkillEditorFile[]> {
  return [await createTextFile(skillEntryPath, '# Skill\n', 'text/markdown')]
}

export function skillHasEntryFile(files: readonly SkillEditorFile[]): boolean {
  return files.some((file) => file.path === skillEntryPath)
}

export async function addSkillTextFile(
  files: readonly SkillEditorFile[],
  pathInput: string
): Promise<SkillEditorFile[]> {
  return (await addSkillTextFileWithPath(files, pathInput)).files
}

export async function addSkillTextFileWithPath(
  files: readonly SkillEditorFile[],
  pathInput: string
): Promise<{ files: SkillEditorFile[]; path: string }> {
  const path = normalizeSkillFilePath(pathInput)
  assertUniquePath(files, path)
  return {
    files: sortSkillFiles([...files, await createTextFile(path, '')]),
    path,
  }
}

export async function updateSkillTextFile(
  files: readonly SkillEditorFile[],
  pathInput: string,
  text: string
): Promise<SkillEditorFile[]> {
  const path = normalizeSkillFilePath(pathInput)
  const next = await Promise.all(files.map(async (file) => {
    if (file.path !== path) return file
    if (file.kind !== 'text') throw new Error('二进制文件不能编辑')
    return createTextFile(file.path, text, file.mimeType)
  }))
  return sortSkillFiles(next)
}

export function renameSkillFile(
  files: readonly SkillEditorFile[],
  fromInput: string,
  toInput: string
): SkillEditorFile[] {
  const from = normalizeSkillFilePath(fromInput)
  const to = normalizeSkillFilePath(toInput)
  if (from === skillEntryPath) throw new Error('不能重命名 SKILL.md')
  assertUniquePath(files.filter((file) => file.path !== from), to)
  return sortSkillFiles(files.map((file) => file.path === from ? { ...file, path: to } : file))
}

export function deleteSkillFile(
  files: readonly SkillEditorFile[],
  pathInput: string
): SkillEditorFile[] {
  const path = normalizeSkillFilePath(pathInput)
  if (path === skillEntryPath) throw new Error('不能删除 SKILL.md')
  const next = files.filter((file) => file.path !== path)
  if (!skillHasEntryFile(next)) throw new Error('必须保留 SKILL.md')
  return sortSkillFiles(next)
}

export async function replaceSkillFileFromUpload(
  files: readonly SkillEditorFile[],
  upload: File,
  pathInput = upload.name
): Promise<SkillEditorFile[]> {
  const path = normalizeSkillFilePath(pathInput)
  const withoutExisting = files.filter((file) => file.path !== path)
  assertUniquePath(withoutExisting, path)
  assertUploadedSkillFileSize(withoutExisting, upload.size)
  const uploaded = await fileToSkillEditorFile(upload, path)
  return sortSkillFiles([...withoutExisting, uploaded])
}

export async function filesFromDraftDtos(
  files: readonly ContentStoreFileDto[]
): Promise<SkillEditorFile[]> {
  const mapped = await Promise.all(files.map(async (file) => {
    if (file.kind === 'text') {
      return createTextFile(file.path, file.text ?? '', file.mimeType, file.sha256)
    }
    return {
      path: file.path,
      kind: 'binary' as const,
      text: '',
      bytesBase64: '',
      size: file.size,
      mimeType: file.mimeType,
      sha256: file.sha256,
    }
  }))
  return sortSkillFiles(mapped)
}

export async function createTextFile(
  pathInput: string,
  text: string,
  mimeType: string | null = null,
  knownSha256?: string
): Promise<SkillEditorFile> {
  const path = normalizeSkillFilePath(pathInput)
  const bytes = new TextEncoder().encode(text)
  const bytesBase64 = bytesToBase64(bytes)
  return {
    path,
    kind: 'text',
    text,
    bytesBase64,
    size: bytes.byteLength,
    mimeType: mimeType ?? inferMimeType(path),
    sha256: knownSha256 ?? await sha256Hex(bytes),
  }
}

function assertUniquePath(files: readonly SkillEditorFile[], path: string) {
  const key = pathKey(path)
  if (files.some((file) => pathKey(file.path) === key)) throw new Error('文件已存在')
}

function assertUploadedSkillFileSize(files: readonly SkillEditorFile[], uploadSize: number) {
  if (uploadSize > contentStoreSkillMaxFileBytes) throw new Error('Skill 单文件超过 20MB。')
  const totalSize = files.reduce((total, file) => total + file.size, uploadSize)
  if (totalSize > contentStoreSkillMaxTotalBytes) throw new Error('Skill 文件总大小超过 50MB。')
}

function pathKey(path: string): string {
  return path.toLowerCase()
}

async function fileToSkillEditorFile(upload: File, path: string): Promise<SkillEditorFile> {
  const bytes = new Uint8Array(await upload.arrayBuffer())
  const mimeType = upload.type || inferMimeType(path)
  const text = decodeTextFile(bytes, path, mimeType)
  const bytesBase64 = bytesToBase64(bytes)
  return {
    path,
    kind: text === null ? 'binary' : 'text',
    text: text ?? '',
    bytesBase64,
    size: bytes.byteLength,
    mimeType,
    sha256: await sha256Hex(bytes),
  }
}

function decodeTextFile(
  bytes: Uint8Array,
  path: string,
  mimeType: string | null
): string | null {
  const likelyText =
    mimeType?.startsWith('text/') ||
    (mimeType ? textMimeTypes.has(mimeType) : false) ||
    textExtensions.has(extensionOf(path))
  if (!likelyText) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function inferMimeType(path: string): string | null {
  const extension = extensionOf(path)
  if (extension === '.md' || extension === '.mdx') return 'text/markdown'
  if (extension === '.json') return 'application/json'
  if (extension === '.yaml' || extension === '.yml') return 'application/x-yaml'
  if (extension === '.txt') return 'text/plain'
  if (extension === '.ts' || extension === '.tsx') return 'application/typescript'
  if (extension === '.js' || extension === '.jsx' || extension === '.mjs') return 'application/javascript'
  return null
}

function extensionOf(path: string): string {
  const index = path.lastIndexOf('.')
  return index >= 0 ? path.slice(index).toLowerCase() : ''
}

function sortSkillFiles(files: readonly SkillEditorFile[]): SkillEditorFile[] {
  return [...files].sort((left, right) => {
    if (left.path === skillEntryPath) return -1
    if (right.path === skillEntryPath) return 1
    return left.path.localeCompare(right.path)
  })
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize))
  }
  return btoa(binary)
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
