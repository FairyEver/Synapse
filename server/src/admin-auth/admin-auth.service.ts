import { Injectable, UnauthorizedException } from "@nestjs/common"
import bcrypt from "bcryptjs"
import { createHmac, timingSafeEqual } from "node:crypto"

interface AdminAuthOptions {
  readonly email: string
  readonly password: string
  readonly jwtSecret: string
}

interface AdminSession {
  readonly email: string
  readonly token: string
}

@Injectable()
export class AdminAuthService {
  private constructor(
    private readonly email: string,
    private readonly passwordHash: string,
    private readonly jwtSecret: string,
  ) {}

  static async createForTest(options: AdminAuthOptions): Promise<AdminAuthService> {
    return new AdminAuthService(
      options.email.toLowerCase(),
      await bcrypt.hash(options.password, 10),
      options.jwtSecret,
    )
  }

  static async create(options: AdminAuthOptions): Promise<AdminAuthService> {
    return AdminAuthService.createForTest(options)
  }

  getEmail(): string {
    return this.email
  }

  async login(email: string, password: string): Promise<AdminSession> {
    const normalizedEmail = email.trim().toLowerCase()
    const passwordMatches = await bcrypt.compare(password, this.passwordHash)
    if (normalizedEmail !== this.email || !passwordMatches) {
      throw new UnauthorizedException("管理员账号或密码错误。")
    }

    return {
      email: this.email,
      token: this.sign({ email: this.email, issuedAt: new Date().toISOString() }),
    }
  }

  verify(token: string): boolean {
    const [payload, signature] = token.split(".")
    if (!payload || !signature) return false
    const expected = createHmac("sha256", this.jwtSecret).update(payload).digest("base64url")
    const actualBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expected)
    if (actualBuffer.length !== expectedBuffer.length) {
      return false
    }
    return timingSafeEqual(actualBuffer, expectedBuffer)
  }

  private sign(payload: Record<string, unknown>): string {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
    const signature = createHmac("sha256", this.jwtSecret).update(encoded).digest("base64url")
    return `${encoded}.${signature}`
  }
}
