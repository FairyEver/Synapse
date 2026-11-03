import { BadRequestException } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import { TODO_MAX_IMAGES } from "@synapse/shared/todo-contracts"

export async function todoImageIds(db: Pick<Prisma.TransactionClient, "todoImage">, userId: string, todoId: string): Promise<string[]> {
  const rows = await db.todoImage.findMany({
    where: { userId, todoId, ready: true },
    select: { id: true },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    take: TODO_MAX_IMAGES,
  })
  return rows.map(row => row.id)
}

export async function replaceTodoImages(tx: Prisma.TransactionClient, userId: string, todoId: string, ids: string[], now: Date) {
  // Claim in a stable order across concurrent edits of different items.
  const positions = new Map(ids.map((id, position) => [id, position]))
  for (const id of [...ids].sort()) {
    const updated = await tx.todoImage.updateMany({
      where: { id, userId, ready: true, OR: [{ todoId }, { todoId: null, expiresAt: { gt: now } }] },
      data: { todoId, expiresAt: null, position: positions.get(id)! },
    })
    if (updated.count !== 1) throw new BadRequestException({ code: "TODO_IMAGE_UNAVAILABLE", message: "图片已失效或无法访问，请重新添加" })
  }
  await tx.todoImage.updateMany({
    where: { userId, todoId, id: { notIn: ids } },
    data: { todoId: null, ready: false, expiresAt: now },
  })
}
