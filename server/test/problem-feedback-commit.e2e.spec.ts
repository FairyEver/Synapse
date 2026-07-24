import type { NestExpressApplication } from "@nestjs/platform-express"
import { Test } from "@nestjs/testing"
import { PrismaClient } from "@prisma/client"
import { PROBLEM_FEEDBACK_POLICY_FIXTURES } from "@synapse/shared"
import type { NextFunction, Request, Response } from "express"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createProblemFeedbackCapabilityDispatcher } from "../../desktop/app-capabilities/problem-feedback/main/dispatcher"
import {
  ProblemFeedbackService as DesktopProblemFeedbackService,
} from "../../desktop/app-capabilities/problem-feedback/main/service"
import {
  PROBLEM_FEEDBACK_SUBMIT_CAPABILITY_ID,
} from "../../desktop/app-capabilities/problem-feedback/shared/capability"
import { registerHttpBodyParsers } from "../src/common/http-body-parser"
import { ProblemFeedbackController } from "../src/problem-feedback/problem-feedback.controller"
import { ProblemFeedbackDiagnostics } from "../src/problem-feedback/problem-feedback-diagnostics"
import { ProblemFeedbackRateLimiter } from "../src/problem-feedback/problem-feedback-rate-limiter"
import {
  ProblemFeedbackService as ServerProblemFeedbackService,
} from "../src/problem-feedback/problem-feedback.service"

const input = PROBLEM_FEEDBACK_POLICY_FIXTURES.valid[0]!.input

describe("problem feedback ambiguous COMMIT response", () => {
  let app: NestExpressApplication
  let prisma: PrismaClient
  let apiBaseUrl: string
  let postCount = 0

  beforeAll(async () => {
    if (!process.env.PROBLEM_FEEDBACK_E2E_DATABASE_URL) {
      throw new Error(
        "PROBLEM_FEEDBACK_E2E_DATABASE_URL is required for problem feedback e2e tests.",
      )
    }
    prisma = new PrismaClient({
      datasources: {
        db: { url: process.env.PROBLEM_FEEDBACK_E2E_DATABASE_URL },
      },
    })
    await prisma.$connect()
    await prisma.problemFeedback.deleteMany({
      where: { content: input.content },
    })

    const diagnostics = new ProblemFeedbackDiagnostics()
    const serverService = new ServerProblemFeedbackService(
      prisma as never,
      { recordWithClient: async () => undefined } as never,
      diagnostics,
    )
    const moduleRef = await Test.createTestingModule({
      controllers: [ProblemFeedbackController],
      providers: [
        { provide: ServerProblemFeedbackService, useValue: serverService },
        {
          provide: ProblemFeedbackRateLimiter,
          useValue: { tryAcquire: () => true },
        },
        { provide: ProblemFeedbackDiagnostics, useValue: diagnostics },
      ],
    }).compile()

    app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    })
    registerHttpBodyParsers(app)
    app.use(installCommittedResponseCut)
    await app.listen(0, "127.0.0.1")

    const address = app.getHttpServer().address()
    if (!address || typeof address === "string") {
      throw new Error("Problem feedback e2e server did not bind.")
    }
    apiBaseUrl = `http://127.0.0.1:${address.port}/api`
  })

  afterAll(async () => {
    await app?.close()
    if (prisma) {
      await prisma.problemFeedback.deleteMany({
        where: { content: input.content },
      })
      await prisma.$disconnect()
    }
  })

  it("commits one row, drops the response, and never retries the desktop POST", async () => {
    const desktopService = new DesktopProblemFeedbackService(apiBaseUrl, {
      allowDevelopmentLoopbackHttp: true,
    })
    const dispatcher = createProblemFeedbackCapabilityDispatcher({
      service: desktopService,
    })

    await expect(dispatcher.dispatch(
      PROBLEM_FEEDBACK_SUBMIT_CAPABILITY_ID,
      input,
      { source: "mcp-http" },
    )).resolves.toEqual({
      ok: false,
      code: "SUBMISSION_OUTCOME_UNKNOWN",
      error: "问题反馈提交结果未知，内容可能已经提交。",
    })

    expect(postCount).toBe(1)
    await expect(prisma.problemFeedback.findMany({
      select: { content: true },
    })).resolves.toEqual([{ content: input.content }])
  })

  function installCommittedResponseCut(
    request: Request,
    response: Response,
    next: NextFunction,
  ): void {
    if (request.method !== "POST" || request.path !== "/api/problem-feedback") {
      next()
      return
    }
    postCount += 1
    const send = response.send.bind(response)
    response.send = ((body?: unknown) => {
      if (body === '{"success":true}') {
        response.socket?.destroy()
        return response
      }
      return send(body)
    }) as Response["send"]
    next()
  }
})
