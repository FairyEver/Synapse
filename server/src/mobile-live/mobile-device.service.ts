import { Injectable } from "@nestjs/common"
import { PrismaService } from "../prisma/prisma.service"

export type MobilePushRegistration = {
  readonly userId: string
  readonly clientInstanceId: string
  readonly token: string
  readonly platform: string
  readonly deviceName: string
  readonly appVersion: string
}

export type MobilePushTarget = {
  readonly userId: string
  readonly clientInstanceId: string
  readonly token: string
}

/**
 * Stores where to reach a phone for notifications.
 *
 * Deliberately reuses `UserDevice` rather than introducing a mobile-specific
 * table: a phone is a Synapse client like any other, so it inherits the existing
 * device list, and the user can already see and manage it from the dashboard.
 */
@Injectable()
export class MobileDeviceService {
  constructor(private readonly prisma: PrismaService) {}

  async registerPush(input: MobilePushRegistration): Promise<void> {
    const now = new Date()
    await this.prisma.userDevice.upsert({
      where: {
        userId_clientInstanceId: {
          userId: input.userId,
          clientInstanceId: input.clientInstanceId,
        },
      },
      create: {
        userId: input.userId,
        clientInstanceId: input.clientInstanceId,
        deviceName: input.deviceName,
        platform: input.platform,
        appVersion: input.appVersion,
        lastSeenAt: now,
        pushToken: input.token,
        pushPlatform: input.platform,
      },
      update: {
        deviceName: input.deviceName,
        platform: input.platform,
        appVersion: input.appVersion,
        lastSeenAt: now,
        pushToken: input.token,
        pushPlatform: input.platform,
      },
    })
  }

  /** Clears the token so nothing is sent to a device that unregistered or logged out. */
  async unregisterPush(userId: string, clientInstanceId: string): Promise<number> {
    const result = await this.prisma.userDevice.updateMany({
      where: { userId, clientInstanceId, pushToken: { not: null } },
      data: { pushToken: null, pushPlatform: null },
    })
    return result.count
  }

  async listPushTargets(userId: string): Promise<MobilePushTarget[]> {
    const rows = await this.prisma.userDevice.findMany({
      where: { userId, pushToken: { not: null } },
      select: { clientInstanceId: true, pushToken: true },
    })
    return rows
      .filter((row): row is { clientInstanceId: string; pushToken: string } => Boolean(row.pushToken))
      .map((row) => ({ userId, clientInstanceId: row.clientInstanceId, token: row.pushToken }))
  }

  async recordPushAttempt(clientInstanceId: string, userId: string): Promise<void> {
    await this.prisma.userDevice.updateMany({
      where: { userId, clientInstanceId },
      data: { lastPushAt: new Date() },
    })
  }

  /**
   * Drops a token Apple has told us is gone. Registration tokens are reissued on
   * reinstall and can be invalidated at any time, so a stale one is deleted
   * rather than retried forever.
   */
  async dropPushToken(token: string): Promise<void> {
    await this.prisma.userDevice.updateMany({
      where: { pushToken: token },
      data: { pushToken: null, pushPlatform: null },
    })
  }
}
