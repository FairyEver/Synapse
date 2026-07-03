import { skillRepositoryRootFilePath, type SkillRepositoryDetailDto, type SkillRepositoryFileDto } from '@synapse/shared'
import { buildFileBrowserTree, type FileBrowserSourceFile, type FileBrowserTree } from '../file-browser/finder/file-browser-model'

export type SkillRepositoryBrowser = {
  readonly repository: SkillRepositoryDetailDto
  readonly tree: FileBrowserTree
}

export function buildSkillRepositoryBrowser(
  repository: SkillRepositoryDetailDto,
  currentPath: string,
): SkillRepositoryBrowser {
  return {
    repository,
    tree: buildFileBrowserTree(repository.files.map(toBrowserFile), currentPath, {
      priorityFilePath: skillRepositoryRootFilePath,
    }),
  }
}

export function getSkillRepositoryDisplayOwner(repository: SkillRepositoryDetailDto): string {
  return repository.owner.handle || repository.owner.id
}

export function isProtectedSkillRepositoryPath(path: string): boolean {
  return path.replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '').toLowerCase() === skillRepositoryRootFilePath.toLowerCase()
}

function toBrowserFile(file: SkillRepositoryFileDto): FileBrowserSourceFile {
  return {
    id: file.id,
    path: file.path,
    size: file.size,
    sha256: file.sha256,
    updatedAt: file.updatedAt,
    kind: file.kind,
    mimeType: file.mimeType,
  }
}
