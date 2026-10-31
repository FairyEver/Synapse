import { dashboardApi as api } from '@/lib/api'

export const skillRepositoryApi = {
  listMine: api.listMySkillRepositories,
  listPublic: api.listPublicSkillRepositories,
  get: api.getSkillRepository,
  getByPath: api.getSkillRepositoryByPath,
  update: api.updateSkillRepository,
  remove: api.deleteSkillRepository,
  getFileContent: api.getSkillRepositoryFileContent,
  getFileContentByPath: api.getSkillRepositoryFileContentByPath,
  getFileDownloadUrl: api.getSkillRepositoryFileDownloadUrl,
  getFileDownloadUrlByPath: api.getSkillRepositoryFileDownloadUrlByPath,
  fork: api.forkSkillRepository,
  createInstallSession: api.createSkillRepositoryInstallSession,
  saveTextFile: api.saveSkillRepositoryTextFile,
  renameFile: api.renameSkillRepositoryFile,
  deleteFile: api.deleteSkillRepositoryFile,
}
