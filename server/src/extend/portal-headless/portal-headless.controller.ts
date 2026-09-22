import { Body, Controller, Headers, HttpCode, Post, Req, UseGuards } from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import { z } from "zod"
import { UserAuthGuard, type AuthenticatedUserRequest } from "../../auth/user-auth.guard"
import { PortalHeadlessAccessService } from "./access.service"
import { catalogInput, describeInput, parseInput, portalHeaders, readInput } from "./contract"
import { PortalHeadlessService } from "./portal-headless.service"

@Controller("api/extend/portal-headless")
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class PortalHeadlessController {
  constructor(private readonly access: PortalHeadlessAccessService, private readonly portal: PortalHeadlessService) {}

  @Post("access")
  @HttpCode(200)
  @UseGuards(UserAuthGuard)
  issue(@Req() request: AuthenticatedUserRequest) {
    return this.access.issue(request.user!.id)
  }

  private async identity(headers: Record<string, string | string[] | undefined>) {
    const owner = await this.access.verify(typeof headers.authorization === "string" ? headers.authorization : undefined)
    const credential = parseInput(portalHeaders, {
      token: headers["x-portal-token"], tenantId: headers["x-portal-tenant-id"], language: headers["accept-language"],
    })
    return { owner, credential }
  }

  @Post("context")
  @HttpCode(200)
  async context(@Headers() headers: Record<string, string | string[] | undefined>, @Body() body: unknown) {
    const identity = await this.identity(headers)
    parseInput(z.object({}).strict(), body ?? {})
    return this.portal.run(identity, { op: "context" })
  }

  @Post("catalog")
  @HttpCode(200)
  async catalog(@Headers() headers: Record<string, string | string[] | undefined>, @Body() body: unknown) {
    return this.portal.run(await this.identity(headers), { op: "catalog", input: parseInput(catalogInput, body) })
  }

  @Post("describe")
  @HttpCode(200)
  async describe(@Headers() headers: Record<string, string | string[] | undefined>, @Body() body: unknown) {
    return this.portal.run(await this.identity(headers), { op: "describe", input: parseInput(describeInput, body) })
  }

  @Post("read")
  @HttpCode(200)
  async read(@Headers() headers: Record<string, string | string[] | undefined>, @Body() body: unknown) {
    return this.portal.run(await this.identity(headers), { op: "read", input: parseInput(readInput, body) })
  }
}
