import { z } from "zod"
import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { GitBranchService } from "../../services/git-client/git-branch-service"
import type { GitCloneService } from "../../services/git-client/git-clone-service"
import type { GitCommitService } from "../../services/git-client/git-commit-service"
import type { GitEnvironmentService } from "../../services/git-client/git-environment-service"
import type { GitHistoryService } from "../../services/git-client/git-history-service"
import type { GitRepositoryRegistry } from "../../services/git-client/git-repository-registry"
import type { GitStatusService } from "../../services/git-client/git-status-service"
import type { GitSyncService } from "../../services/git-client/git-sync-service"
import type { SynapseGitRepository } from "../../../src/types/git"

const repositorySchema = z.object({
  id: z.string(),
  name: z.string(),
  localPath: z.string(),
  addedAt: z.string(),
  lastOpenedAt: z.string().nullable(),
})

const fileChangeSchema = z.object({
  path: z.string(),
  originalPath: z.string().nullable(),
  status: z.enum(["added", "modified", "deleted", "renamed", "untracked", "conflicted", "unknown"]),
  staged: z.boolean(),
  conflicted: z.boolean(),
})

const environmentStateSchema = z.object({
  gitAvailable: z.boolean(),
  gitVersion: z.string().nullable(),
  gitPath: z.string().nullable(),
  sshAvailable: z.boolean(),
  userName: z.string().nullable(),
  userEmail: z.string().nullable(),
  commonSshKeyExists: z.boolean(),
  installHint: z.string().nullable(),
})

const configureIdentitySchema = z.object({
  userName: z.string(),
  userEmail: z.string(),
}).strict()

const addLocalRepositorySchema = z.object({
  name: z.string(),
  localPath: z.string(),
}).strict()

const cloneRepositorySchema = z.object({
  remoteUrl: z.string(),
  targetPath: z.string(),
  name: z.string(),
}).strict()

const cloneResultSchema = z.object({
  repository: repositorySchema,
  remoteKind: z.enum(["https", "ssh", "unknown"]),
})

const repositoryIdSchema = z.object({
  repositoryId: z.string(),
}).strict()

const snapshotSchema = z.object({
  repositoryId: z.string(),
  pathExists: z.boolean(),
  isGitRepository: z.boolean(),
  currentBranch: z.string().nullable(),
  upstream: z.string().nullable(),
  ahead: z.number(),
  behind: z.number(),
  hasConflicts: z.boolean(),
  changes: z.array(fileChangeSchema),
})

const diffRequestSchema = repositoryIdSchema.extend({
  path: z.string(),
  originalPath: z.string().nullable().optional(),
  staged: z.boolean(),
}).strict()

const diffResultSchema = z.object({
  path: z.string(),
  originalPath: z.string().nullable(),
  binary: z.boolean(),
  text: z.string(),
})

const commitRequestSchema = repositoryIdSchema.extend({
  message: z.string(),
  paths: z.array(z.string()),
}).strict()

const operationResultSchema = z.object({
  completedAt: z.string(),
  message: z.string(),
})

const branchSchema = z.object({
  name: z.string(),
  current: z.boolean(),
})

const branchRequestSchema = repositoryIdSchema.extend({
  branchName: z.string(),
}).strict()

const commitSummarySchema = z.object({
  hash: z.string(),
  shortHash: z.string(),
  subject: z.string(),
  authorName: z.string(),
  authorEmail: z.string(),
  committedAt: z.string(),
})

const commitDetailSchema = commitSummarySchema.extend({
  files: z.array(fileChangeSchema),
  diff: z.string(),
})

const historyListRequestSchema = repositoryIdSchema.extend({
  limit: z.number(),
  offset: z.number(),
}).strict()

const commitDetailRequestSchema = repositoryIdSchema.extend({
  hash: z.string(),
}).strict()

type ConfigureIdentityRequest = z.infer<typeof configureIdentitySchema>
type AddLocalRepositoryRequest = z.infer<typeof addLocalRepositorySchema>
type CloneRepositoryRequest = z.infer<typeof cloneRepositorySchema>
type RepositoryIdRequest = z.infer<typeof repositoryIdSchema>
type DiffRequest = z.infer<typeof diffRequestSchema>
type CommitRequest = z.infer<typeof commitRequestSchema>
type BranchRequest = z.infer<typeof branchRequestSchema>
type HistoryListRequest = z.infer<typeof historyListRequestSchema>
type CommitDetailRequest = z.infer<typeof commitDetailRequestSchema>

async function resolveRepository(ctx: IpcHandlerContext, repositoryId: string): Promise<SynapseGitRepository> {
  const registry = ctx.resolve<GitRepositoryRegistry>("git.repository-registry")
  const repositories = await registry.list()
  const repository = repositories.find((item) => item.id === repositoryId)
  if (!repository) throw new Error("找不到对应的 Git 仓库。")
  return repository
}

export const gitIpcModule: IpcModule = {
  id: "git",
  methods: {
    checkEnvironment: {
      channel: "synapse:git:environment:check",
      kind: "invoke",
      request: z.void(),
      response: environmentStateSchema,
      handler: async (ctx) => ctx.resolve<GitEnvironmentService>("git.environment-service").check(),
    },
    configureIdentity: {
      channel: "synapse:git:environment:configure-identity",
      kind: "invoke",
      request: configureIdentitySchema,
      response: z.void(),
      handler: async (ctx, input: ConfigureIdentityRequest) => ctx.resolve<GitEnvironmentService>("git.environment-service").configureIdentity(input),
    },
    listRepositories: {
      channel: "synapse:git:repositories:list",
      kind: "invoke",
      request: z.void(),
      response: z.array(repositorySchema),
      handler: async (ctx) => ctx.resolve<GitRepositoryRegistry>("git.repository-registry").list(),
    },
    addLocalRepository: {
      channel: "synapse:git:repositories:add-local",
      kind: "invoke",
      request: addLocalRepositorySchema,
      response: repositorySchema,
      handler: async (ctx, input: AddLocalRepositoryRequest) => ctx.resolve<GitRepositoryRegistry>("git.repository-registry").addLocal(input),
    },
    removeRepository: {
      channel: "synapse:git:repositories:remove",
      kind: "invoke",
      request: repositoryIdSchema,
      response: z.void(),
      handler: async (ctx, input: RepositoryIdRequest) => ctx.resolve<GitRepositoryRegistry>("git.repository-registry").remove(input.repositoryId),
    },
    cloneRepository: {
      channel: "synapse:git:repositories:clone",
      kind: "invoke",
      request: cloneRepositorySchema,
      response: cloneResultSchema,
      handler: async (ctx, input: CloneRepositoryRequest) => ctx.resolve<GitCloneService>("git.clone-service").clone(input),
    },
    getSnapshot: {
      channel: "synapse:git:status:get-snapshot",
      kind: "invoke",
      request: repositoryIdSchema,
      response: snapshotSchema,
      handler: async (ctx, input: RepositoryIdRequest) => ctx.resolve<GitStatusService>("git.status-service").getSnapshot(await resolveRepository(ctx, input.repositoryId)),
    },
    getDiff: {
      channel: "synapse:git:status:get-diff",
      kind: "invoke",
      request: diffRequestSchema,
      response: diffResultSchema,
      handler: async (ctx, input: DiffRequest) => ctx.resolve<GitStatusService>("git.status-service").getDiff(await resolveRepository(ctx, input.repositoryId), input),
    },
    commit: {
      channel: "synapse:git:commit:create",
      kind: "invoke",
      request: commitRequestSchema,
      response: operationResultSchema,
      handler: async (ctx, input: CommitRequest) => ctx.resolve<GitCommitService>("git.commit-service").commit(await resolveRepository(ctx, input.repositoryId), input),
    },
    fetch: {
      channel: "synapse:git:sync:fetch",
      kind: "invoke",
      request: repositoryIdSchema,
      response: operationResultSchema,
      handler: async (ctx, input: RepositoryIdRequest) => ctx.resolve<GitSyncService>("git.sync-service").fetch(await resolveRepository(ctx, input.repositoryId)),
    },
    pull: {
      channel: "synapse:git:sync:pull",
      kind: "invoke",
      request: repositoryIdSchema,
      response: operationResultSchema,
      handler: async (ctx, input: RepositoryIdRequest) => ctx.resolve<GitSyncService>("git.sync-service").pull(await resolveRepository(ctx, input.repositoryId)),
    },
    push: {
      channel: "synapse:git:sync:push",
      kind: "invoke",
      request: repositoryIdSchema,
      response: operationResultSchema,
      handler: async (ctx, input: RepositoryIdRequest) => ctx.resolve<GitSyncService>("git.sync-service").push(await resolveRepository(ctx, input.repositoryId)),
    },
    sync: {
      channel: "synapse:git:sync:sync",
      kind: "invoke",
      request: repositoryIdSchema,
      response: operationResultSchema,
      handler: async (ctx, input: RepositoryIdRequest) => ctx.resolve<GitSyncService>("git.sync-service").sync(await resolveRepository(ctx, input.repositoryId)),
    },
    listBranches: {
      channel: "synapse:git:branches:list",
      kind: "invoke",
      request: repositoryIdSchema,
      response: z.array(branchSchema),
      handler: async (ctx, input: RepositoryIdRequest) => ctx.resolve<GitBranchService>("git.branch-service").list(await resolveRepository(ctx, input.repositoryId)),
    },
    checkoutBranch: {
      channel: "synapse:git:branches:checkout",
      kind: "invoke",
      request: branchRequestSchema,
      response: z.void(),
      handler: async (ctx, input: BranchRequest) => ctx.resolve<GitBranchService>("git.branch-service").checkout(await resolveRepository(ctx, input.repositoryId), input.branchName),
    },
    createBranch: {
      channel: "synapse:git:branches:create",
      kind: "invoke",
      request: branchRequestSchema,
      response: z.void(),
      handler: async (ctx, input: BranchRequest) => ctx.resolve<GitBranchService>("git.branch-service").create(await resolveRepository(ctx, input.repositoryId), input.branchName),
    },
    listHistory: {
      channel: "synapse:git:history:list",
      kind: "invoke",
      request: historyListRequestSchema,
      response: z.array(commitSummarySchema),
      handler: async (ctx, input: HistoryListRequest) => ctx.resolve<GitHistoryService>("git.history-service").list(await resolveRepository(ctx, input.repositoryId), input),
    },
    getCommit: {
      channel: "synapse:git:history:get-commit",
      kind: "invoke",
      request: commitDetailRequestSchema,
      response: commitDetailSchema,
      handler: async (ctx, input: CommitDetailRequest) => ctx.resolve<GitHistoryService>("git.history-service").getCommit(await resolveRepository(ctx, input.repositoryId), input.hash),
    },
  },
  events: {},
}
