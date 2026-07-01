import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Company, SubscriptionPlan, User } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { addDays } from 'date-fns';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './types/jwt-payload.interface';

const bcrypt = require('bcryptjs');

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ForbiddenException('Email уже занят');
    }

    const company = await this.prisma.company.create({
      data: {
        name: dto.companyName,
        slug: await this.generateUniqueSlug(dto.companyName),
        plan: SubscriptionPlan.TRIAL,
        maxProjects: 1,
        maxClients: 1000,
        maxPushesPerMonth: 5,
        planExpiresAt: addDays(new Date(), 7), // 7 дней триала
      },
    });

    const user = await this.prisma.user.create({
      data: {
        companyId: company.id,
        email: dto.email,
        passwordHash: await bcrypt.hash(dto.password, 12),
        firstName: dto.firstName,
        role: 'OWNER',
      },
    });

    return this.issueTokens({ ...user, company });
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { company: true },
    });

    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    if (!user.isActive) {
      throw new ForbiddenException('Аккаунт заблокирован');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.issueTokens(user);
  }

  async refresh(userId: string, rawRefreshToken: string) {
    const match = await this.prisma.refreshToken.findUnique({
      where: { token: this.hashToken(rawRefreshToken) },
    });
    if (!match || match.userId !== userId || match.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token недействителен или истёк');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { company: true } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Пользователь не найден или заблокирован');
    }

    // Rotation — старый refresh token инвалидируется
    await this.prisma.refreshToken.delete({ where: { id: match.id } });

    return this.issueTokens(user);
  }

  async logout(userId: string, rawRefreshToken?: string) {
    if (rawRefreshToken) {
      const match = await this.prisma.refreshToken.findUnique({
        where: { token: this.hashToken(rawRefreshToken) },
      });
      if (match && match.userId === userId) {
        await this.prisma.refreshToken.delete({ where: { id: match.id } });
      }
      return { loggedOut: 'current-session' };
    }

    // Без конкретного токена — разлогинить все сессии пользователя
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
    return { loggedOut: 'all-sessions' };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { company: true },
    });
    return this.sanitizeUser(user);
  }

  // Refresh-токены — уже высокоэнтропийные JWT, а не пользовательские пароли,
  // поэтому bcrypt тут не нужен и даже опасен: bcrypt усекает вход до 72 байт,
  // а у токенов одного пользователя префикс (header + начало payload) совпадает —
  // bcrypt.compare ложно матчил бы любой токен этого пользователя.
  // SHA-256 + точный lookup по unique-полю — и корректно, и быстрее.
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async issueTokens(user: User & { company?: Company | null }) {
    const payload: JwtPayload = {
      sub: user.id,
      companyId: user.companyId,
      role: user.role,
    };

    const accessToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_SECRET'),
      expiresIn: '15m',
    });
    const refreshToken = this.jwt.sign(
      { ...payload, jti: randomUUID() },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: '30d',
      },
    );

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: this.hashToken(refreshToken),
        expiresAt: addDays(new Date(), 30),
      },
    });

    return { accessToken, refreshToken, user: this.sanitizeUser(user) };
  }

  private sanitizeUser(user: User & { company?: Company | null }) {
    const { passwordHash, ...safe } = user;
    return safe;
  }

  private async generateUniqueSlug(companyName: string): Promise<string> {
    const base = companyName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'company';

    let slug = base;
    let attempt = 0;
    while (await this.prisma.company.findUnique({ where: { slug } })) {
      attempt += 1;
      slug = `${base}-${attempt}`;
    }
    return slug;
  }
}
