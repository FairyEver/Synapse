import { BadRequestException } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import type { PrismaService } from "../prisma/prisma.service"
import { driveDefaultQuotaBytes } from "./drive.constants"

type DrivePrismaClient = PrismaService | Prisma.TransactionClient

export async function ensureDriveUsage(client: DrivePrismaClient, userId: string) {
  return client.driveUsage.upsert({
    where: { userId },
    create: { userId, usedBytes: 0n, reservedBytes: 0n, quotaBytes: driveDefaultQuotaBytes },
    update: {},
  })
}

export async function reserveDriveUsageBytes(client: DrivePrismaClient, userId: string, requestedBytes: bigint): Promise<void> {
  await ensureDriveUsage(client, userId)
  if (requestedBytes <= 0n) return
  const updated = await client.$executeRaw`
    UPDATE "DriveUsage"
    SET "reservedBytes" = "reservedBytes" + ${requestedBytes},
        "updatedAt" = NOW()
    WHERE "userId" = ${userId}
      AND "usedBytes" + "reservedBytes" + ${requestedBytes} <= "quotaBytes"
  `
  if (updated !== 1) throw new BadRequestException("云盘空间不足。")
}

export async function releaseDriveUsageReservation(client: DrivePrismaClient, userId: string, releasedBytes: bigint): Promise<void> {
  if (releasedBytes <= 0n) return
  await ensureDriveUsage(client, userId)
  await client.driveUsage.update({
    where: { userId },
    data: { reservedBytes: { decrement: releasedBytes } },
  })
}

export async function commitDriveUsageReservation(
  client: DrivePrismaClient,
  userId: string,
  input: { readonly reservedBytes: bigint; readonly usedBytes: bigint },
): Promise<void> {
  await ensureDriveUsage(client, userId)
  await client.driveUsage.update({
    where: { userId },
    data: {
      ...(input.reservedBytes > 0n ? { reservedBytes: { decrement: input.reservedBytes } } : {}),
      ...(input.usedBytes > 0n ? { usedBytes: { increment: input.usedBytes } } : {}),
    },
  })
}
