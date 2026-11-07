import {
  CUSTOM_APPS_API_PATHS,
  customAppSnapshotSchema,
  type CustomAppCreateInput,
  type CustomAppDockOperation,
  type CustomAppId,
  type CustomAppSnapshotDto,
  type CustomAppUpdateInput,
} from "@synapse/shared/custom-apps-contracts"

import type { AccountService, AccountRequestScope } from "../account-service"
import type { SynapseAccountState } from "../../../src/types/account"

export interface CustomAppsAccountPort {
  getState(): ReturnType<AccountService["getState"]>
  onStateChanged(listener: (state: SynapseAccountState) => void): () => void
  captureAccountRequestScope(): (AccountRequestScope & { readonly accountId: string }) | null
  getApiBaseUrlForLive(): string
  fetchAuthenticated(
    pathOrUrl: string,
    init?: RequestInit,
    errorMessage?: string,
    accountScope?: AccountRequestScope,
  ): Promise<Response>
}

export interface CustomAppsApiPort {
  fetchSnapshot(): Promise<CustomAppSnapshotDto>
  create(input: CustomAppCreateInput): Promise<CustomAppSnapshotDto>
  update(id: CustomAppId, input: CustomAppUpdateInput): Promise<CustomAppSnapshotDto>
  delete(id: CustomAppId, operationId: string): Promise<CustomAppSnapshotDto>
  bootstrap(input: {
    readonly operationId: string
    readonly dockAppIds: string[]
    readonly dockMigrationIds: string[]
  }): Promise<CustomAppSnapshotDto>
  applyDockOperation(input: CustomAppDockOperation): Promise<CustomAppSnapshotDto>
}

export class CustomAppsHttpApi implements CustomAppsApiPort {
  constructor(private readonly account: CustomAppsAccountPort) {}

  fetchSnapshot(): Promise<CustomAppSnapshotDto> {
    return this.request(CUSTOM_APPS_API_PATHS.snapshot, { method: "GET" }, "自定义应用加载失败。")
  }

  create(input: CustomAppCreateInput): Promise<CustomAppSnapshotDto> {
    return this.request(CUSTOM_APPS_API_PATHS.apps, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }, "创建自定义应用失败。")
  }

  update(id: CustomAppId, input: CustomAppUpdateInput): Promise<CustomAppSnapshotDto> {
    return this.request(`${CUSTOM_APPS_API_PATHS.apps}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }, "保存自定义应用失败。")
  }

  delete(id: CustomAppId, operationId: string): Promise<CustomAppSnapshotDto> {
    return this.request(`${CUSTOM_APPS_API_PATHS.apps}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operationId }),
    }, "删除自定义应用失败。")
  }

  bootstrap(input: {
    readonly operationId: string
    readonly dockAppIds: string[]
    readonly dockMigrationIds: string[]
  }): Promise<CustomAppSnapshotDto> {
    return this.request(CUSTOM_APPS_API_PATHS.bootstrap, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }, "初始化 Dock 失败。")
  }

  applyDockOperation(input: CustomAppDockOperation): Promise<CustomAppSnapshotDto> {
    return this.request(CUSTOM_APPS_API_PATHS.dockOperations, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }, "保存 Dock 设置失败。")
  }

  private async request(
    path: string,
    init: RequestInit,
    errorMessage: string,
  ): Promise<CustomAppSnapshotDto> {
    const scope = this.account.captureAccountRequestScope()
    if (!scope) throw new CustomAppsAuthenticationError()
    const url = new URL(path, this.account.getApiBaseUrlForLive()).toString()
    const response = await this.account.fetchAuthenticated(url, init, errorMessage, scope)
    const json = await response.json()
    return withAbsoluteIconUrls(customAppSnapshotSchema.parse(json), this.account.getApiBaseUrlForLive())
  }
}

export class CustomAppsAuthenticationError extends Error {
  constructor() {
    super("Custom app configuration requires an authenticated online account.")
    this.name = "CustomAppsAuthenticationError"
  }
}

export function customAppsHttpStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null
  const record = error as { readonly status?: unknown; readonly statusCode?: unknown }
  const value = typeof record.status === "number" ? record.status : record.statusCode
  return typeof value === "number" ? value : null
}

function withAbsoluteIconUrls(
  snapshot: CustomAppSnapshotDto,
  apiBaseUrl: string,
): CustomAppSnapshotDto {
  return {
    ...snapshot,
    apps: snapshot.apps.map((app) => app.iconUrl && app.iconUrl.startsWith("/")
      ? { ...app, iconUrl: new URL(app.iconUrl, apiBaseUrl).toString() }
      : app),
  }
}
