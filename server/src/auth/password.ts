import bcrypt from "bcryptjs"

const passwordHashRounds = 10

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, passwordHashRounds)
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}
