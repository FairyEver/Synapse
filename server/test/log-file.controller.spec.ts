import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { INestApplication, CanActivate } from "@nestjs/common";
import request from "supertest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { LogFileController } from "../src/admin/log-file.controller";
import { LogFileService } from "../src/admin/log-file.service";
import { AdminAuthGuard } from "../src/admin-auth/admin-auth.guard";

const TEST_LOG_DIR = join(process.cwd(), "test-logs-ctrl");

class AlwaysAllowGuard implements CanActivate {
  canActivate() {
    return true;
  }
}

describe("LogFileController", () => {
  let app: INestApplication;

  beforeAll(async () => {
    mkdirSync(TEST_LOG_DIR, { recursive: true });
    writeFileSync(
      join(TEST_LOG_DIR, "server.2026-05-05.log"),
      [
        JSON.stringify({ time: Date.now(), level: 30, msg: "hello" }),
        JSON.stringify({ time: Date.now(), level: 50, msg: "oops" }),
      ].join("\n") + "\n",
    );

    const module = await Test.createTestingModule({
      controllers: [LogFileController],
      providers: [
        { provide: LogFileService, useValue: new LogFileService(TEST_LOG_DIR) },
      ],
    })
      .overrideGuard(AdminAuthGuard)
      .useClass(AlwaysAllowGuard)
      .compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_LOG_DIR, { recursive: true, force: true });
  });

  it("GET /admin/api/logs/files returns file list", async () => {
    const res = await request(app.getHttpServer()).get("/admin/api/logs/files");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("server.2026-05-05.log");
  });

  it("GET /admin/api/logs/recent returns entries", async () => {
    const res = await request(app.getHttpServer()).get("/admin/api/logs/recent?limit=10");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("GET /admin/api/logs/recent?level=error filters by level", async () => {
    const res = await request(app.getHttpServer()).get("/admin/api/logs/recent?level=error");
    expect(res.status).toBe(200);
    expect(res.body.every((e: { level: string }) => e.level === "error")).toBe(true);
  });

  it("GET /admin/api/logs/download returns zip", async () => {
    const res = await request(app.getHttpServer()).get("/admin/api/logs/download");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
  });
});


