import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, Res, UseFilters, UseGuards } from "@nestjs/common"
import { SkipThrottle } from "@nestjs/throttler"
import type { Response } from "express"
import { CloudTableService } from "./cloud-table.service"
import { CloudTableGuard, type CloudRequest } from "./cloud-table-http"
import { OpenApiExceptionFilter } from "../open-api/open-api-exception.filter"
import { openApiRequestId, type OpenApiRequest } from "../open-api/open-api.types"
import { CLOUD_TABLE_BASE, deleteRecordSchema, recordUpdateSchema } from "./cloud-table-contract"
import { parseCloudTableInput } from "./cloud-table-validation"

@Controller([CLOUD_TABLE_BASE, "/api/console/tables"])
@SkipThrottle()
@UseGuards(CloudTableGuard)
@UseFilters(OpenApiExceptionFilter)
export class CloudTableController {
  constructor(@Inject(CloudTableService) private readonly service: CloudTableService) {}
  private async call(req: CloudRequest, res: Response, id: string | null, op: string, body: unknown = {}) {
    const abort = new AbortController(), close = () => { if (!res.writableEnded) abort.abort() }
    res.once("close", close)
    if (res.destroyed || req.aborted) abort.abort()
    const requestId = openApiRequestId(req as OpenApiRequest)
    res.setHeader("X-Request-Id", requestId); res.setHeader("Cache-Control", "no-store")
    try { return await this.service.execute(req.cloudActor, id, op, body, { requestId, idempotencyKey: req.headers["idempotency-key"] as string | undefined, signal: abort.signal }) }
    finally { res.removeListener("close", close) }
  }
  @Get() list(@Req() r: CloudRequest, @Res({ passthrough: true }) s: Response, @Query("cursor") cursor?: string) { return this.call(r,s,null,"table.list",{cursor}) }
  @Post() create(@Req() r: CloudRequest, @Res({ passthrough: true }) s: Response, @Body() b: unknown) { return this.call(r,s,null,"table.create",b) }
  @Get("trash") trash(@Req() r: CloudRequest, @Res({ passthrough: true }) s: Response, @Query("cursor") cursor?: string) { return this.call(r,s,null,"table.trash",{cursor}) }
  @Get(":id") get(@Req() r: CloudRequest, @Res({ passthrough: true }) s: Response, @Param("id") id: string) { return this.call(r,s,id,"table.get") }
  @Get(":id/schema") schema(@Req() r: CloudRequest, @Res({ passthrough: true }) s: Response, @Param("id") id: string) { return this.call(r,s,id,"schema") }
  @Get(":id/daily-summary") dailySummary(@Req() r: CloudRequest, @Res({ passthrough: true }) s: Response, @Param("id") id: string, @Query() query: Record<string, unknown>) { return this.call(r,s,id,"daily.summary",query) }
  @Patch(":id") update(@Req() r: CloudRequest, @Res({ passthrough: true }) s: Response, @Param("id") id: string, @Body() b: unknown) { return this.call(r,s,id,"table.update",b) }
  @Patch(":id/permissions") permissions(@Req() r: CloudRequest, @Res({ passthrough: true }) s: Response, @Param("id") id: string, @Body() b: unknown) { return this.call(r,s,id,"permissions",b) }
  @Post(":id/collaborators/resolve") resolve(@Req() r: CloudRequest, @Res({ passthrough: true }) s: Response, @Param("id") id: string, @Body() b: unknown) { return this.call(r,s,id,"member.resolve",b) }
  @Get(":id/collaborators/search") searchCollaborators(@Req() r: CloudRequest, @Res({ passthrough: true }) s: Response, @Param("id") id: string, @Query("query") query?: string) { return this.call(r,s,id,"member.search",{query}) }
  @Delete(":id") delete(@Req() r: CloudRequest, @Res({ passthrough: true }) s: Response, @Param("id") id: string, @Body() b: unknown) { return this.call(r,s,id,"table.delete",b) }
  @Post(":id/restore") restore(@Req() r: CloudRequest, @Res({ passthrough: true }) s: Response, @Param("id") id: string) { return this.call(r,s,id,"table.restore") }
  @Get(":id/logs") logs(@Req() r: CloudRequest, @Res({ passthrough: true }) s: Response, @Param("id") id: string, @Query("cursor") cursor?: string) { return this.call(r,s,id,"logs",{cursor}) }
  @Post(":id/records/query") query(@Req() r: CloudRequest, @Res({ passthrough: true }) s: Response, @Param("id") id: string, @Body() b: unknown) { return this.call(r,s,id,"records.query",b) }
  @Post(":id/records/count") count(@Req() r: CloudRequest, @Res({ passthrough: true }) s: Response, @Param("id") id: string, @Body() b: unknown) { return this.call(r,s,id,"records.count",b) }
  @Post(":id/records/exists") exists(@Req() r: CloudRequest, @Res({ passthrough: true }) s: Response, @Param("id") id: string, @Body() b: unknown) { return this.call(r,s,id,"records.exists",b) }
  @Post(":id/records/batch") batch(@Req() r: CloudRequest, @Res({ passthrough: true }) s: Response, @Param("id") id: string, @Body() b: unknown) { return this.call(r,s,id,"records.batch",b) }
  @Get(":id/records/trash") recordTrash(@Req() r: CloudRequest, @Res({ passthrough: true }) s: Response, @Param("id") id: string, @Query("cursor") cursor?: string) { return this.call(r,s,id,"records.trash",{cursor}) }
  @Post(":id/records") insert(@Req() r: CloudRequest, @Res({ passthrough: true }) s: Response, @Param("id") id: string, @Body() b: unknown) { return this.call(r,s,id,"records.create",b) }
  @Get(":id/records/:recordId") record(@Req() r: CloudRequest, @Res({ passthrough: true }) s: Response, @Param("id") id: string, @Param("recordId") recordId: string) { return this.call(r,s,id,"records.get",{id:recordId}) }
  @Patch(":id/records/:recordId") patch(@Req() r: CloudRequest, @Res({ passthrough: true }) s: Response, @Param("id") id: string, @Param("recordId") recordId: string, @Body() b: unknown) { return this.call(r,s,id,"records.update",{...parseCloudTableInput(recordUpdateSchema,b),id:recordId}) }
  @Delete(":id/records/:recordId") remove(@Req() r: CloudRequest, @Res({ passthrough: true }) s: Response, @Param("id") id: string, @Param("recordId") recordId: string, @Body() b: unknown) { return this.call(r,s,id,"records.delete",{...parseCloudTableInput(deleteRecordSchema,b),id:recordId}) }
  @Post(":id/records/:recordId/restore") restoreRecord(@Req() r: CloudRequest, @Res({ passthrough: true }) s: Response, @Param("id") id: string, @Param("recordId") recordId: string) { return this.call(r,s,id,"records.restore",{id:recordId}) }
}
