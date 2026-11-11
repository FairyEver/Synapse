import { Body, Controller, Delete, Get, Patch, Post, Put, Param, Query, Req, Res, UseGuards, BadRequestException } from "@nestjs/common"
import type { Request, Response } from "express"
import { z } from "zod"
import { TUNNEL_DEVICE_HEADER, TUNNEL_KEY_HEADER } from "@synapse/shared/tunnel-contracts"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { badRequestFromZodError } from "../common/zod-validation"
import { TunnelService } from "./tunnel.service"
import { TunnelDeviceService } from "./tunnel-device.service"
import { tunnelCreateSchema, tunnelDeleteSchema, tunnelEnableSchema, tunnelListSchema, tunnelUpdateSchema } from "./tunnel.schemas"
type UserRequest = Request & { user: { id: string } }
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw badRequestFromZodError(result.error, "穿透参数无效")
  return result.data
}
@Controller("/api/tunnels")
@UseGuards(UserAuthGuard)
export class TunnelController {
  constructor(private readonly service: TunnelService, private readonly devices: TunnelDeviceService) {}
  private proof(req: UserRequest) {
    const id = req.headers[TUNNEL_DEVICE_HEADER], key = req.headers[TUNNEL_KEY_HEADER]
    if (typeof id !== "string" || typeof key !== "string") throw new BadRequestException("缺少设备凭据")
    return { id, key }
  }
  private actor(req: UserRequest) { const { id, key } = this.proof(req); return this.devices.verify(req.user.id, id, key) }
  @Get() list(@Req() req: UserRequest, @Query() input: unknown) { return this.service.list(req.user.id, parse(tunnelListSchema, input)) }
  @Put("device") async register(@Req() req: UserRequest, @Res({ passthrough: true }) res: Response) {
    this.service.assertEnabled()
    const { id, key } = this.proof(req)
    await this.devices.register(req.user.id, id, key)
    res.setHeader("Cache-Control", "no-store")
    return { registered: true }
  }
  @Get("operations/:requestId") operation(@Req() req: UserRequest, @Param("requestId") requestId: string) {
    return this.service.operation(req.user.id, parse(z.uuid(), requestId))
  }
  @Get(":id") get(@Req() req: UserRequest, @Param("id") id: string) { return this.service.get(req.user.id, id) }
  @Post() async create(@Req() req: UserRequest, @Body() input: unknown) { return this.service.create(await this.actor(req), parse(tunnelCreateSchema, input)) }
  @Patch(":id") async update(@Req() req: UserRequest, @Param("id") id: string, @Body() input: unknown) { return this.service.update(await this.actor(req), id, parse(tunnelUpdateSchema, input)) }
  @Patch(":id/enabled") async enable(@Req() req: UserRequest, @Param("id") id: string, @Body() input: unknown) { return this.service.setEnabled(await this.actor(req), id, parse(tunnelEnableSchema, input)) }
  @Delete(":id") delete(@Req() req: UserRequest, @Param("id") id: string, @Body() input: unknown) { return this.service.delete(req.user.id, id, parse(tunnelDeleteSchema, input)) }
}
