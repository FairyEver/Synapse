import { z } from "zod"
import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { GitBranchService } from "../../services/git-client/git-branch-service"
import type { GitCloneService } from "../../services/git-client/git-clone-service"
import type { GitCommitService } from "../../services/git-client/git-commit-service"
import type { GitAccessService } from "../../services/git-client/git-access-service"
import type { GitEnvironmentService } from "../../services/git-client/git-environment-service"
import type { GitHistoryService } from "../../services/git-client/git-history-service"
import type { GitRepositoryRegistry } from "../../services/git-client/git-repository-registry"
import type { GitStatusService } from "../../services/git-client/git-status-service"
import type { GitSyncService } from "../../services/git-client/git-sync-service"
import type { SynapseGitRepository } from "../../../src/types/git"
import { createMainLogger } from "../../services/log-store"

const logger = createMainLogger("ipc.git")

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
  checkedAt: z.string(),
  platform: z.string(),
  homeDir: z.string(),
  gitAvailable: z.boolean(),
  gitVersion: z.string().nullable(),
  gitPath: z.string().nullable(),
  processPath: z.string(),
  shellPath: z.string().nullable(),
  effectivePath: z.string(),
  processGitPath: z.string().nullable(),
  shellGitPath: z.string().nullable(),
  effectiveGitPath: z.string().nullable(),
  sshAvailable: z.boolean(),
  userName: z.string().nullable(),
  userEmail: z.string().nullable(),
  userNameSource: z.string().nullable(),
  userEmailSource: z.string().nullable(),
  commonSshKeyExists: z.boolean(),
  sshPublicKeyPath: z.string().nullable(),
  sshPublicKeyType: z.string().nullable(),
  sshPublicKeyComment: z.string().nullable(),
  sshPublicKeyFingerprint: z.string().nullable(),
  installHint: z.string().nullable(),
})

const sshPublicKeySchema = z.object({
  path: z.string(),
  content: z.string(),
})

const protocolSchema = z.enum(["https", "ssh", "file", "unknown"])

const providerSchema = z.enum(["github", "gitee", "gitlab", "generic"])

const providerLinksSchema = z.object({
  credentialHelpUrl: z.string().nullable(),
  sshKeysUrl: z.string().nullable(),
  tokenUrl: z.string().nullable(),
})

const userFacingFailureSchema = z.object({
  category: z.enum([
    "git-missing",
    "missing-identity",
    "https-auth",
    "github-auth",
    "ssh-auth",
    "credential-helper-missing",
    "repository-not-found",
    "network",
    "path",
    "dirty",
    "conflict",
    "non-fast-forward",
    "timeout",
    "not-git-repository",
    "unknown",
  ]),
  detail: z.string().nullable(),
  host: z.string().nullable(),
  message: z.string(),
  primaryAction: z.enum([
    "install-git",
    "set-identity",
    "login-host",
    "handle-github-auth",
    "handle-ssh",
    "configure-credential-helper",
    "retry",
    "choose-directory",
    "open-workbench",
    "copy-diagnostics",
  ]).nullable(),
  protocol: protocolSchema,
  title: z.string(),
})

const checkAccessSchema = z.object({
  hosts: z.array(z.object({
    host: z.string(),
    protocol: protocolSchema,
    provider: providerSchema,
  }).strict()).optional(),
}).strict()

const credentialHelperSchema = z.object({
  helper: z.string().nullable(),
  safe: z.boolean(),
  source: z.string().nullable(),
})

const accessStateSchema = z.object({
  checkedAt: z.string(),
  credentialHelper: credentialHelperSchema,
  hosts: z.array(z.object({
    host: z.string(),
    lastFailure: userFacingFailureSchema.nullable(),
    protocol: protocolSchema,
    provider: providerSchema,
  })),
  providerLinks: z.record(providerSchema, providerLinksSchema),
  ssh: z.object({
    available: z.boolean(),
    publicKeyComment: z.string().nullable(),
    publicKeyFingerprint: z.string().nullable(),
    publicKeyPath: z.string().nullable(),
    publicKeyType: z.string().nullable(),
  }),
})

const configureCredentialHelperSchema = z.object({
  helper: z.string(),
}).strict()

const saveHttpsCredentialSchema = z.object({
  host: z.string(),
  password: z.string(),
  protocol: z.literal("https"),
  username: z.string(),
}).strict()

const clearHttpsCredentialSchema = z.object({
  host: z.string(),
  protocol: z.literal("https"),
  username: z.string().nullable().optional(),
}).strict()

const generateSshKeySchema = z.object({
  email: z.string(),
}).strict()

const testSshConnectionSchema = z.object({
  host: z.string(),
  provider: providerSchema.optional(),
}).strict()

const sshTestResultSchema = z.object({
  detail: z.string().nullable(),
  host: z.string(),
  ok: z.boolean(),
  title: z.string(),
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

const removeRepositorySchema = repositoryIdSchema.extend({
  mode: z.enum(["keep-local", "trash-local"]),
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

const repositorySummarySchema = z.object({
  repository: repositorySchema,
  snapshot: snapshotSchema.nullable(),
  error: z.string().nullable(),
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
type RemoveRepositoryRequest = z.infer<typeof removeRepositorySchema>
type DiffRequest = z.infer<typeof diffRequestSchema>
type CommitRequest = z.infer<typeof commitRequestSchema>
type BranchRequest = z.infer<typeof branchRequestSchema>
type HistoryListRequest = z.infer<typeof historyListRequestSchema>
type CommitDetailRequest = z.infer<typeof commitDetailRequestSchema>
type CheckAccessRequest = z.infer<typeof checkAccessSchema>
type ConfigureCredentialHelperRequest = z.infer<typeof configureCredentialHelperSchema>
type SaveHttpsCredentialRequest = z.infer<typeof saveHttpsCredentialSchema>
type ClearHttpsCredentialRequest = z.infer<typeof clearHttpsCredentialSchema>
type GenerateSshKeyRequest = z.infer<typeof generateSshKeySchema>
type TestSshConnectionRequest = z.infer<typeof testSshConnectionSchema>

async function resolveRepository(ctx: IpcHandlerContext, repositoryId: string): Promise<SynapseGitRepository> {
  const registry = ctx.resolve<GitRepositoryRegistry>("git.repository-registry")
  const repositories = await registry.list()
  const repository = repositories.find((item) => item.id === repositoryId)
  if (!repository) {
    logger.warn("Git IPC repository lookup failed.", {
      operation: "git.ipc.resolveRepository",
      repoId: repositoryId,
    })
    throw new Error("找不到对应的 Git 仓库。")
  }
  return repository
}

export const gitIpcModule: IpcModule = {
  id: "git",
  methods: {
    checkEnvironment: {
      operationId: "app.git.environment.check",
      kind: "invoke",
      request: z.void(),
      response: environmentStateSchema,
      handler: async (ctx) => ctx.resolve<GitEnvironmentService>("git.environment-service").check(),
    },
    configureIdentity: {
      operationId: "app.git.environment.configure_identity",
      kind: "invoke",
      request: configureIdentitySchema,
      response: z.void(),
      handler: async (ctx, input: ConfigureIdentityRequest) => ctx.resolve<GitEnvironmentService>("git.environment-service").configureIdentity(input),
    },
    getSshPublicKey: {
      operationId: "app.git.environment.get_ssh_public_key",
      kind: "invoke",
      request: z.void(),
      response: sshPublicKeySchema.nullable(),
      handler: async (ctx) => ctx.resolve<GitEnvironmentService>("git.environment-service").getSshPublicKey(),
    },
    checkAccess: {
      operationId: "app.git.access.check",
      kind: "invoke",
      request: checkAccessSchema,
      response: accessStateSchema,
      handler: async (ctx, input: CheckAccessRequest) => ctx.resolve<GitAccessService>("git.access-service").check(input),
    },
    configureCredentialHelper: {
      operationId: "app.git.access.configure_credential_helper",
      kind: "invoke",
      request: configureCredentialHelperSchema,
      response: z.void(),
      handler: async (ctx, input: ConfigureCredentialHelperRequest) => ctx.resolve<GitAccessService>("git.access-service").configureCredentialHelper(input),
    },
    saveHttpsCredential: {
      operationId: "app.git.access.save_https_credential",
      kind: "invoke",
      request: saveHttpsCredentialSchema,
      response: z.void(),
      handler: async (ctx, input: SaveHttpsCredentialRequest) => ctx.resolve<GitAccessService>("git.access-service").saveHttpsCredential(input),
    },
    clearHttpsCredential: {
      operationId: "app.git.access.clear_https_credential",
      kind: "invoke",
      request: clearHttpsCredentialSchema,
      response: z.void(),
      handler: async (ctx, input: ClearHttpsCredentialRequest) => ctx.resolve<GitAccessService>("git.access-service").clearHttpsCredential(input),
    },
    generateSshKey: {
      operationId: "app.git.access.generate_ssh_key",
      kind: "invoke",
      request: generateSshKeySchema,
      response: z.void(),
      handler: async (ctx, input: GenerateSshKeyRequest) => ctx.resolve<GitAccessService>("git.access-service").generateSshKey(input),
    },
    testSshConnection: {
      operationId: "app.git.access.test_ssh_connection",
      kind: "invoke",
      request: testSshConnectionSchema,
      response: sshTestResultSchema,
      handler: async (ctx, input: TestSshConnectionRequest) => ctx.resolve<GitAccessService>("git.access-service").testSshConnection(input),
    },
    listRepositories: {
      operationId: "app.git.repositories.list",
      kind: "invoke",
      request: z.void(),
      response: z.array(repositorySchema),
      handler: async (ctx) => ctx.resolve<GitRepositoryRegistry>("git.repository-registry").list(),
    },
    listRepositorySummaries: {
      operationId: "app.git.repositories.list_summaries",
      kind: "invoke",
      request: z.void(),
      response: z.array(repositorySummarySchema),
      handler: async (ctx) => {
        const registry = ctx.resolve<GitRepositoryRegistry>("git.repository-registry")
        const statusService = ctx.resolve<GitStatusService>("git.status-service")
        return statusService.listSummaries(await registry.list())
      },
    },
    addLocalRepository: {
      operationId: "app.git.repositories.add_local",
      kind: "invoke",
      request: addLocalRepositorySchema,
      response: repositorySchema,
      handler: async (ctx, input: AddLocalRepositoryRequest) => ctx.resolve<GitRepositoryRegistry>("git.repository-registry").addLocal(input),
    },
    removeRepository: {
      operationId: "app.git.repositories.remove",
      kind: "invoke",
      request: removeRepositorySchema,
      response: z.void(),
      handler: async (ctx, input: RemoveRepositoryRequest) => ctx.resolve<GitRepositoryRegistry>("git.repository-registry").remove(input),
    },
    cloneRepository: {
      operationId: "app.git.repositories.clone",
      kind: "invoke",
      request: cloneRepositorySchema,
      response: cloneResultSchema,
      handler: async (ctx, input: CloneRepositoryRequest) => ctx.resolve<GitCloneService>("git.clone-service").clone(input),
    },
    getSnapshot: {
      operationId: "app.git.status.get_snapshot",
      kind: "invoke",
      request: repositoryIdSchema,
      response: snapshotSchema,
      handler: async (ctx, input: RepositoryIdRequest) => ctx.resolve<GitStatusService>("git.status-service").getSnapshot(await resolveRepository(ctx, input.repositoryId)),
    },
    getDiff: {
      operationId: "app.git.status.get_diff",
      kind: "invoke",
      request: diffRequestSchema,
      response: diffResultSchema,
      handler: async (ctx, input: DiffRequest) => ctx.resolve<GitStatusService>("git.status-service").getDiff(await resolveRepository(ctx, input.repositoryId), input),
    },
    commit: {
      operationId: "app.git.commit.create",
      kind: "invoke",
      request: commitRequestSchema,
      response: operationResultSchema,
      handler: async (ctx, input: CommitRequest) => ctx.resolve<GitCommitService>("git.commit-service").commit(await resolveRepository(ctx, input.repositoryId), input),
    },
    fetch: {
      operationId: "app.git.sync.fetch",
      kind: "invoke",
      request: repositoryIdSchema,
      response: operationResultSchema,
      handler: async (ctx, input: RepositoryIdRequest) => ctx.resolve<GitSyncService>("git.sync-service").fetch(await resolveRepository(ctx, input.repositoryId)),
    },
    pull: {
      operationId: "app.git.sync.pull",
      kind: "invoke",
      request: repositoryIdSchema,
      response: operationResultSchema,
      handler: async (ctx, input: RepositoryIdRequest) => ctx.resolve<GitSyncService>("git.sync-service").pull(await resolveRepository(ctx, input.repositoryId)),
    },
    push: {
      operationId: "app.git.sync.push",
      kind: "invoke",
      request: repositoryIdSchema,
      response: operationResultSchema,
      handler: async (ctx, input: RepositoryIdRequest) => ctx.resolve<GitSyncService>("git.sync-service").push(await resolveRepository(ctx, input.repositoryId)),
    },
    sync: {
      operationId: "app.git.sync.sync",
      kind: "invoke",
      request: repositoryIdSchema,
      response: operationResultSchema,
      handler: async (ctx, input: RepositoryIdRequest) => ctx.resolve<GitSyncService>("git.sync-service").sync(await resolveRepository(ctx, input.repositoryId)),
    },
    listBranches: {
      operationId: "app.git.branches.list",
      kind: "invoke",
      request: repositoryIdSchema,
      response: z.array(branchSchema),
      handler: async (ctx, input: RepositoryIdRequest) => ctx.resolve<GitBranchService>("git.branch-service").list(await resolveRepository(ctx, input.repositoryId)),
    },
    checkoutBranch: {
      operationId: "app.git.branches.checkout",
      kind: "invoke",
      request: branchRequestSchema,
      response: z.void(),
      handler: async (ctx, input: BranchRequest) => ctx.resolve<GitBranchService>("git.branch-service").checkout(await resolveRepository(ctx, input.repositoryId), input.branchName),
    },
    createBranch: {
      operationId: "app.git.branches.create",
      kind: "invoke",
      request: branchRequestSchema,
      response: z.void(),
      handler: async (ctx, input: BranchRequest) => ctx.resolve<GitBranchService>("git.branch-service").create(await resolveRepository(ctx, input.repositoryId), input.branchName),
    },
    listHistory: {
      operationId: "app.git.history.list",
      kind: "invoke",
      request: historyListRequestSchema,
      response: z.array(commitSummarySchema),
      handler: async (ctx, input: HistoryListRequest) => ctx.resolve<GitHistoryService>("git.history-service").list(await resolveRepository(ctx, input.repositoryId), input),
    },
    getCommit: {
      operationId: "app.git.history.get_commit",
      kind: "invoke",
      request: commitDetailRequestSchema,
      response: commitDetailSchema,
      handler: async (ctx, input: CommitDetailRequest) => ctx.resolve<GitHistoryService>("git.history-service").getCommit(await resolveRepository(ctx, input.repositoryId), input.hash),
    },
  },
  events: {},
}
