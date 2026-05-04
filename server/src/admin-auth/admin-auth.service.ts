import { Injectable, UnauthorizedException } from "@nestjs/common"
import { JwtService } from "@nestjs/jwt"
import bcrypt from "bcryptjs"

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly email: string,
    private readonly passwordHash: string,
  ) {}

  getEmail(): string {
    return this.email
  }

  async login(email: string, password: string): Promise<{ email: string; token: string }> {
    const normalizedEmail = email.trim().toLowerCase()
    const passwordMatches = await bcrypt.compare(password, this.passwordHash)
    if (normalizedEmail !== this.email || !passwordMatches) {
      throw new UnauthorizedException("管理员账号或密码错误。")
    }

    const token = this.jwt.sign({ sub: this.email })
    return { email: this.email, token }
  }

  verify(token: string): boolean {
    try {
      this.jwt.verify(token)
      return true
    } catch {
      return false
    }
  }
}
