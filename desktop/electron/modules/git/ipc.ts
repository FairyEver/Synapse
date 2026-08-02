import { z } from "zod"
import path from "node:path"
import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { GitBranchService } from "../../services/git-client/git-branch-service"
import type { GitChangeSelectionService } from "../../services/git-client/git-change-selection-service"
import type { GitCloneService } from "../../services/git-client/git-clone-service"
import type { GitCommitService } from "../../services/git-client/git-commit-service"
import type { GitDiscardService } from "../../services/git-client/git-discard-service"
import type { GitAccessService } from "../../services/git-client/git-access-service"
import type { GitEnvironmentService } from "../../services/git-client/git-environment-service"
import type { GitHistoryService } from "../../services/git-client/git-history-service"
import type { GitOperationCoordinator } from "../../services/git-client/git-operation-coordinator"
import type { GitRepositoryRegistry } from "../../services/git-client/git-repository-registry"
import type { GitStatusService } from "../../services/git-client/git-status-service"
import type { GitSyncService } from "../../services/git-client/git-sync-service"
import type { SynapseGitRepository } from "../../../src/types/git"
import { createMainLogger } from "../../services/log-store"
import { createGitOperationId } from "../../services/git-client/git-logging"

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

const protocolSchema = z.enum(["http", "https", "ssh", "file", "unknown"])

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
  port: z.number().int().min(1).max(65535).nullable().optional(),
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
    port: z.number().int().min(1).max(65535).nullable().optional(),
    protocol: protocolSchema,
    provider: providerSchema,
  }).strict()).optional(),
}).strict()

const credentialHelperSchema = z.object({
  helpers: z.array(z.object({
    classification: z.enum(["safe", "plaintext", "custom"]),
    source: z.string().nullable(),
    value: z.string(),
  })),
  management: z.enum(["unconfigured", "synapse-supported", "insecure", "external"]),
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
    port: z.number().int().min(1).max(65535).nullable(),
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
  port: z.number().int().min(1).max(65535).nullable().optional(),
  protocol: z.enum(["http", "https"]),
  username: z.string(),
}).strict()

const clearHttpsCredentialSchema = z.object({
  host: z.string(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  protocol: z.enum(["http", "https"]),
  username: z.string().nullable().optional(),
}).strict()

const generateSshKeySchema = z.object({
  email: z.string(),
}).strict()

const testSshConnectionSchema = z.object({
  host: z.string(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  provider: providerSchema.optional(),
  username: z.string().nullable().optional(),
}).strict()

const sshTestResultSchema = z.object({
  detail: z.string().nullable(),
  host: z.string(),
  ok: z.boolean(),
  title: z.string(),
})

const sshHostKeyCandidateSchema = z.object({
  changed: z.boolean(),
  fingerprints: z.array(z.string()),
  host: z.string(),
  port: z.number().int(),
  trusted: z.boolean(),
})

const trustSshHostKeySchema = z.object({
  fingerprints: z.array(z.string()).min(1),
  host: z.string(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
}).strict()

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
  parentDirectory: z.string(),
  directoryName: z.string(),
  operationId: z.string().min(1).optional(),
}).strict()

const cloneResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("registered"),
    repository: repositorySchema,
    localPath: z.string(),
    remoteKind: z.enum(["http", "https", "ssh", "unknown"]),
    message: z.null(),
  }),
  z.object({
    status: z.literal("registration-failed"),
    repository: z.null(),
    localPath: z.string(),
    remoteKind: z.enum(["http", "https", "ssh", "unknown"]),
    message: z.string(),
  }),
])

const repositoryIdSchema = z.object({
  repositoryId: z.string(),
}).strict()

const repositoryOperationSchema = z.object({
  repositoryId: z.string(),
  operationId: z.string().min(1).optional(),
}).strict()

const removeRepositorySchema = repositoryIdSchema

const snapshotSchema = z.object({
  repositoryId: z.string(),
  pathExists: z.boolean(),
  isGitRepository: z.boolean(),
  currentBranch: z.string().nullable(),
  upstream: z.string().nullable(),
  trackingStatus: z.enum(["tracked", "untracked", "detached", "gone"]),
  ahead: z.number(),
  behind: z.number(),
  hasConflicts: z.boolean(),
  changeCount: z.number().int().nonnegative(),
  changesTruncated: z.boolean(),
  changes: z.array(fileChangeSchema),
})

const repositorySummarySchema = z.object({
  repository: repositorySchema,
  snapshot: snapshotSchema.nullable(),
  error: z.string().nullable(),
})

const diffRequestSchema = repositoryIdSchema.extend({
  path: z.string(),
}).strict()

const diffResultSchema = z.object({
  path: z.string(),
  originalPath: z.string().nullable(),
  binary: z.boolean(),
  truncated: z.boolean(),
  text: z.string(),
})

const prepareChangeSelectionRequestSchema = repositoryIdSchema.extend({
  paths: z.array(z.string()).min(1).max(10_000),
}).strict()

const changeSelectionSchema = z.object({
  selectionId: z.string(),
  repositoryId: z.string(),
  expiresAt: z.string(),
  changes: z.array(fileChangeSchema),
})

const commitRequestSchema = repositoryIdSchema.extend({
  message: z.string(),
  selectionId: z.string().min(1),
  operationId: z.string().min(1).optional(),
}).strict()

const discardChangesRequestSchema = repositoryIdSchema.extend({
  selectionId: z.string().min(1),
  operationId: z.string().min(1).optional(),
}).strict()

const discardChangesResultSchema = z.object({
  completedAt: z.string(),
  discardedCount: z.number().int().nonnegative(),
  restoredPaths: z.array(z.string()),
  trashedPaths: z.array(z.string()),
})

const operationResultSchema = z.object({
  completedAt: z.string(),
  message: z.string(),
})

const pushTargetSchema = z.object({
  name: z.string(),
  url: z.string(),
  preferred: z.boolean(),
})

const pushRequestSchema = repositoryIdSchema.extend({
  remoteName: z.string().optional(),
  operationId: z.string().min(1).optional(),
}).strict()

const branchSchema = z.object({
  name: z.string(),
  current: z.boolean(),
})

const branchRequestSchema = repositoryIdSchema.extend({
  branchName: z.string(),
  operationId: z.string().min(1).optional(),
}).strict()

const remoteBranchSchema = z.object({
  name: z.string(),
  fullName: z.string(),
})

const remoteBranchGroupSchema = z.object({
  remoteName: z.string(),
  branches: z.array(remoteBranchSchema),
})

const checkoutRemoteBranchRequestSchema = repositoryIdSchema.extend({
  remoteName: z.string().min(1),
  branchName: z.string().min(1),
  localBranchName: z.string().min(1),
  operationId: z.string().min(1).optional(),
}).strict()

const checkoutRemoteBranchResultSchema = z.object({
  created: z.boolean(),
  localBranchName: z.string(),
  remoteBranchName: z.string(),
})

const cancelOperationSchema = z.object({ operationId: z.string().min(1) }).strict()

const operationStatePayloadSchema = z.object({
  domain: z.literal("git"),
  type: z.literal("operation.changed"),
  payload: z.object({
    operationId: z.string(),
    operation: z.string(),
    repositoryId: z.string().nullable(),
    status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
    queuePosition: z.number(),
  }),
  timestamp: z.string(),
  scope: z.object({ repositoryId: z.string().optional() }).optional(),
})

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
  filesTruncated: z.boolean(),
  diffTruncated: z.boolean(),
  truncated: z.boolean(),
})

const historyListRequestSchema = repositoryIdSchema.extend({
  limit: z.number(),
  offset: z.number(),
}).strict()

const commitDetailRequestSchema = repositoryIdSchema.extend({
  hash: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i),
}).strict()

type ConfigureIdentityRequest = z.infer<typeof configureIdentitySchema>
type AddLocalRepositoryRequest = z.infer<typeof addLocalRepositorySchema>
type CloneRepositoryRequest = z.infer<typeof cloneRepositorySchema>
type RepositoryIdRequest = z.infer<typeof repositoryIdSchema>
type RepositoryOperationRequest = z.infer<typeof repositoryOperationSchema>
type PushRequest = z.infer<typeof pushRequestSchema>
type RemoveRepositoryRequest = z.infer<typeof removeRepositorySchema>
type DiffRequest = z.infer<typeof diffRequestSchema>
type PrepareChangeSelectionRequest = z.infer<typeof prepareChangeSelectionRequestSchema>
type CommitRequest = z.infer<typeof commitRequestSchema>
type DiscardChangesRequest = z.infer<typeof discardChangesRequestSchema>
type BranchRequest = z.infer<typeof branchRequestSchema>
type CheckoutRemoteBranchRequest = z.infer<typeof checkoutRemoteBranchRequestSchema>
type HistoryListRequest = z.infer<typeof historyListRequestSchema>
type CommitDetailRequest = z.infer<typeof commitDetailRequestSchema>
type CheckAccessRequest = z.infer<typeof checkAccessSchema>
type ConfigureCredentialHelperRequest = z.infer<typeof configureCredentialHelperSchema>
type SaveHttpsCredentialRequest = z.infer<typeof saveHttpsCredentialSchema>
type ClearHttpsCredentialRequest = z.infer<typeof clearHttpsCredentialSchema>
type GenerateSshKeyRequest = z.infer<typeof generateSshKeySchema>
type TestSshConnectionRequest = z.infer<typeof testSshConnectionSchema>
type TrustSshHostKeyRequest = z.infer<typeof trustSshHostKeySchema>
type CancelOperationRequest = z.infer<typeof cancelOperationSchema>

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

async function runRepositoryOperation<T>(
  ctx: IpcHandlerContext,
  repository: SynapseGitRepository,
  input: { readonly operationId?: string },
  operation: string,
  task: (signal: AbortSignal, operationId: string) => Promise<T>,
): Promise<T> {
  const operationId = input.operationId ?? createGitOperationId()
  return ctx.resolve<GitOperationCoordinator>("git.operation-coordinator").run({
    key: repository.localPath,
    operation,
    operationId,
    repositoryId: repository.id,
    task: (signal) => task(signal, operationId),
  })
}

async function runRepositoryRead<T>(
  ctx: IpcHandlerContext,
  repository: SynapseGitRepository,
  task: () => Promise<T>,
): Promise<T> {
  return ctx.resolve<GitOperationCoordinator>("git.operation-coordinator").read(repository.localPath, task)
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
    scanSshHostKey: {
      operationId: "app.git.access.scan_ssh_host_key",
      kind: "invoke",
      request: testSshConnectionSchema,
      response: sshHostKeyCandidateSchema,
      handler: async (ctx, input: TestSshConnectionRequest) => ctx.resolve<GitAccessService>("git.access-service").scanSshHostKey(input),
    },
    trustSshHostKey: {
      operationId: "app.git.access.trust_ssh_host_key",
      kind: "invoke",
      request: trustSshHostKeySchema,
      response: z.void(),
      handler: async (ctx, input: TrustSshHostKeyRequest) => ctx.resolve<GitAccessService>("git.access-service").trustSshHostKey(input),
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
        const repositories = await registry.list()
        return statusService.listSummaries(
          repositories,
          (repository) => runRepositoryRead(ctx, repository, () => statusService.getSnapshot(repository)),
        )
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
      handler: async (ctx, input: RemoveRepositoryRequest) => ctx.resolve<GitRepositoryRegistry>("git.repository-registry").remove(input.repositoryId),
    },
    cloneRepository: {
      operationId: "app.git.repositories.clone",
      kind: "invoke",
      request: cloneRepositorySchema,
      response: cloneResultSchema,
      handler: async (ctx, input: CloneRepositoryRequest) => {
        const operationId = input.operationId ?? createGitOperationId()
        return ctx.resolve<GitOperationCoordinator>("git.operation-coordinator").run({
          key: path.resolve(input.parentDirectory, input.directoryName),
          operation: "clone",
          operationId,
          task: (signal) => ctx.resolve<GitCloneService>("git.clone-service").clone(input, { operationId, signal }),
        })
      },
    },
    getSnapshot: {
      operationId: "app.git.status.get_snapshot",
      kind: "invoke",
      request: repositoryIdSchema,
      response: snapshotSchema,
      handler: async (ctx, input: RepositoryIdRequest) => {
        const repository = await resolveRepository(ctx, input.repositoryId)
        return runRepositoryRead(ctx, repository, () => ctx.resolve<GitStatusService>("git.status-service").getSnapshot(repository))
      },
    },
    getDiff: {
      operationId: "app.git.status.get_diff",
      kind: "invoke",
      request: diffRequestSchema,
      response: diffResultSchema,
      handler: async (ctx, input: DiffRequest) => {
        const repository = await resolveRepository(ctx, input.repositoryId)
        return runRepositoryRead(ctx, repository, () => ctx.resolve<GitStatusService>("git.status-service").getDiff(repository, input))
      },
    },
    prepareChangeSelection: {
      operationId: "app.git.changes.prepare",
      kind: "invoke",
      request: prepareChangeSelectionRequestSchema,
      response: changeSelectionSchema,
      handler: async (ctx, input: PrepareChangeSelectionRequest) => {
        const repository = await resolveRepository(ctx, input.repositoryId)
        return runRepositoryRead(ctx, repository, () => (
          ctx.resolve<GitChangeSelectionService>("git.change-selection-service").prepare(repository, input.paths)
        ))
      },
    },
    discardChanges: {
      operationId: "app.git.changes.discard",
      kind: "invoke",
      request: discardChangesRequestSchema,
      response: discardChangesResultSchema,
      handler: async (ctx, input: DiscardChangesRequest) => {
        const repository = await resolveRepository(ctx, input.repositoryId)
        return runRepositoryOperation(ctx, repository, input, "discard-changes", (signal, operationId) => (
          ctx.resolve<GitDiscardService>("git.discard-service").discard(repository, input, { operationId, signal })
        ))
      },
    },
    commit: {
      operationId: "app.git.commit.create",
      kind: "invoke",
      request: commitRequestSchema,
      response: operationResultSchema,
      handler: async (ctx, input: CommitRequest) => {
        const repository = await resolveRepository(ctx, input.repositoryId)
        return runRepositoryOperation(ctx, repository, input, "commit", (signal, operationId) => (
          ctx.resolve<GitCommitService>("git.commit-service").commit(repository, input, { operationId, signal })
        ))
      },
    },
    fetch: {
      operationId: "app.git.sync.fetch",
      kind: "invoke",
      request: repositoryOperationSchema,
      response: operationResultSchema,
      handler: async (ctx, input: RepositoryOperationRequest) => {
        const repository = await resolveRepository(ctx, input.repositoryId)
        return runRepositoryOperation(ctx, repository, input, "fetch", (signal, operationId) => (
          ctx.resolve<GitSyncService>("git.sync-service").fetch(repository, { operationId, signal })
        ))
      },
    },
    pull: {
      operationId: "app.git.sync.pull",
      kind: "invoke",
      request: repositoryOperationSchema,
      response: operationResultSchema,
      handler: async (ctx, input: RepositoryOperationRequest) => {
        const repository = await resolveRepository(ctx, input.repositoryId)
        return runRepositoryOperation(ctx, repository, input, "pull", (signal, operationId) => (
          ctx.resolve<GitSyncService>("git.sync-service").pull(repository, { operationId, signal })
        ))
      },
    },
    push: {
      operationId: "app.git.sync.push",
      kind: "invoke",
      request: pushRequestSchema,
      response: operationResultSchema,
      handler: async (ctx, input: PushRequest) => {
        const repository = await resolveRepository(ctx, input.repositoryId)
        return runRepositoryOperation(ctx, repository, input, "push", (signal, operationId) => (
          ctx.resolve<GitSyncService>("git.sync-service").push(repository, input.remoteName, { operationId, signal })
        ))
      },
    },
    listPushTargets: {
      operationId: "app.git.sync.list_push_targets",
      kind: "invoke",
      request: repositoryIdSchema,
      response: z.array(pushTargetSchema),
      handler: async (ctx, input: RepositoryIdRequest) => {
        const repository = await resolveRepository(ctx, input.repositoryId)
        return runRepositoryRead(ctx, repository, () => ctx.resolve<GitSyncService>("git.sync-service").listPushTargets(repository))
      },
    },
    sync: {
      operationId: "app.git.sync.sync",
      kind: "invoke",
      request: repositoryOperationSchema,
      response: operationResultSchema,
      handler: async (ctx, input: RepositoryOperationRequest) => {
        const repository = await resolveRepository(ctx, input.repositoryId)
        return runRepositoryOperation(ctx, repository, input, "sync", (signal, operationId) => (
          ctx.resolve<GitSyncService>("git.sync-service").sync(repository, { operationId, signal })
        ))
      },
    },
    listBranches: {
      operationId: "app.git.branches.list",
      kind: "invoke",
      request: repositoryIdSchema,
      response: z.array(branchSchema),
      handler: async (ctx, input: RepositoryIdRequest) => {
        const repository = await resolveRepository(ctx, input.repositoryId)
        return runRepositoryRead(ctx, repository, () => ctx.resolve<GitBranchService>("git.branch-service").list(repository))
      },
    },
    checkoutBranch: {
      operationId: "app.git.branches.checkout",
      kind: "invoke",
      request: branchRequestSchema,
      response: z.void(),
      handler: async (ctx, input: BranchRequest) => {
        const repository = await resolveRepository(ctx, input.repositoryId)
        return runRepositoryOperation(ctx, repository, input, "checkout", (signal, operationId) => (
          ctx.resolve<GitBranchService>("git.branch-service").checkout(repository, input.branchName, { operationId, signal })
        ))
      },
    },
    createBranch: {
      operationId: "app.git.branches.create",
      kind: "invoke",
      request: branchRequestSchema,
      response: z.void(),
      handler: async (ctx, input: BranchRequest) => {
        const repository = await resolveRepository(ctx, input.repositoryId)
        return runRepositoryOperation(ctx, repository, input, "create-branch", (signal, operationId) => (
          ctx.resolve<GitBranchService>("git.branch-service").create(repository, input.branchName, { operationId, signal })
        ))
      },
    },
    listRemoteBranches: {
      operationId: "app.git.branches.list_remote",
      kind: "invoke",
      request: repositoryIdSchema,
      response: z.array(remoteBranchGroupSchema),
      handler: async (ctx, input: RepositoryIdRequest) => {
        const repository = await resolveRepository(ctx, input.repositoryId)
        return runRepositoryRead(ctx, repository, () => ctx.resolve<GitBranchService>("git.branch-service").listRemote(repository))
      },
    },
    fetchRemoteBranches: {
      operationId: "app.git.branches.fetch_remote",
      kind: "invoke",
      request: repositoryOperationSchema,
      response: z.void(),
      handler: async (ctx, input: RepositoryOperationRequest) => {
        const repository = await resolveRepository(ctx, input.repositoryId)
        return runRepositoryOperation(ctx, repository, input, "fetch-remote-branches", (signal, operationId) => (
          ctx.resolve<GitBranchService>("git.branch-service").fetchRemote(repository, { operationId, signal })
        ))
      },
    },
    checkoutRemoteBranch: {
      operationId: "app.git.branches.checkout_remote",
      kind: "invoke",
      request: checkoutRemoteBranchRequestSchema,
      response: checkoutRemoteBranchResultSchema,
      handler: async (ctx, input: CheckoutRemoteBranchRequest) => {
        const repository = await resolveRepository(ctx, input.repositoryId)
        return runRepositoryOperation(ctx, repository, input, "checkout-remote", (signal, operationId) => (
          ctx.resolve<GitBranchService>("git.branch-service").checkoutRemote(repository, input, { operationId, signal })
        ))
      },
    },
    listHistory: {
      operationId: "app.git.history.list",
      kind: "invoke",
      request: historyListRequestSchema,
      response: z.array(commitSummarySchema),
      handler: async (ctx, input: HistoryListRequest) => {
        const repository = await resolveRepository(ctx, input.repositoryId)
        return runRepositoryRead(ctx, repository, () => ctx.resolve<GitHistoryService>("git.history-service").list(repository, input))
      },
    },
    getCommit: {
      operationId: "app.git.history.get_commit",
      kind: "invoke",
      request: commitDetailRequestSchema,
      response: commitDetailSchema,
      handler: async (ctx, input: CommitDetailRequest) => {
        const repository = await resolveRepository(ctx, input.repositoryId)
        return runRepositoryRead(ctx, repository, () => ctx.resolve<GitHistoryService>("git.history-service").getCommit(repository, input.hash))
      },
    },
    cancelOperation: {
      operationId: "app.git.operation.cancel",
      kind: "invoke",
      request: cancelOperationSchema,
      response: z.boolean(),
      handler: (ctx, input: CancelOperationRequest) => ctx.resolve<GitOperationCoordinator>("git.operation-coordinator").cancel(input.operationId),
    },
  },
  events: {
    operationChanged: {
      kind: "event",
      operationId: "app.git.operation.changed",
      payload: operationStatePayloadSchema,
    },
  },
}
