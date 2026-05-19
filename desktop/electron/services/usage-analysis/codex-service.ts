import type { DatabaseSync } from "node:sqlite"
import { parseCodexUsageFile } from "./codex-parser"
import { CcUsageAnalysisService, refreshUsageNamespace } from "./cc-service"
import type { UsageRefreshResult } from "./types"

interface UsageAnalysisServiceOptions {
  readonly db: DatabaseSync
  readonly roots: string[]
}

export class CodexUsageAnalysisService extends CcUsageAnalysisService {
  protected override readonly prefix = "cx"

  constructor(options: UsageAnalysisServiceOptions) {
    super(options)
  }

  override async refresh(): Promise<UsageRefreshResult> {
    return refreshUsageNamespace({
      db: this.db,
      prefix: this.prefix,
      roots: this.roots,
      parseFile: parseCodexUsageFile,
    })
  }
}
