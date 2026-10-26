import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { EncryptionService } from '../../../common/encryption.service';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { AuthService } from '../auth.service';
import { findOrBindAccount } from './telegram-accounts.util';

const USERNAME_PATTERN = /^[a-z0-9_]{5,32}$/;
// Данные мини-аппа старше суток не принимаем — их могли перехватить и повторить.
const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;
const LINK_TTL_MS = 15 * 60 * 1000;
const MAX_ACCOUNTS = 10;

// Вход в CRM из мини-аппа Telegram (2026-10-26: «открывать свой проект прямо в Telegram, логин
// автоматический по личке»). Мини-апп открывается кнопкой в боте оповещений компании; Telegram
// подписывает данные о том, кто открыл, токеном этого бота — подделать их нельзя. Кто это — ищем
// среди Telegram-аккаунтов, привязанных сотрудниками этой компании.
@Injectable()
export class TelegramLoginService {
  private readonly logger = new Logger(TelegramLoginService.name);

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private config: ConfigService,
    private auth: AuthService,
  ) {}

  async login(notificationBotId: string, initData: string) {
    const bot = await this.prisma.notificationBot.findUnique({ where: { id: notificationBotId } });
    if (!bot) throw new UnauthorizedException('Бот не найден — откройте CRM из бота оповещений компании');
    const who = this.verifyInitData(initData, this.encryption.decrypt(bot.tokenEncrypted));
    const account = await findOrBindAccount(this.prisma, bot.companyId, who);
    if (!account) {
      throw new ForbiddenException(
        'Этот Telegram не привязан к профилю CRM. Войдите в CRM на сайте → меню профиля → «Вход через Telegram» и привяжите аккаунт.',
      );
    }
    await this.prisma.userTelegramAccount.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
    return this.auth.loginAsUser(account.userId);
  }

  // Проверка подписи initData по правилам Telegram: HMAC-SHA256 от отсортированных полей, ключ —
  // HMAC-SHA256("WebAppData", токен бота).
  private verifyInitData(initData: string, botToken: string) {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash || !/^[0-9a-f]{64}$/.test(hash)) throw new UnauthorizedException('Откройте CRM из Telegram');
    params.delete('hash');
    const dataCheck = Array.from(params.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calc = createHmac('sha256', secret).update(dataCheck).digest();
    if (!timingSafeEqual(calc, Buffer.from(hash, 'hex'))) throw new UnauthorizedException('Подпись Telegram не сходится — откройте CRM заново из бота');
    const authDate = Number(params.get('auth_date'));
    if (!authDate || Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE_SEC) throw new UnauthorizedException('Данные входа устарели — закройте и откройте CRM в боте заново');
    let user: { id?: number; username?: string; first_name?: string } = {};
    try {
      user = JSON.parse(params.get('user') ?? '{}');
    } catch {
      // ниже — общий отказ
    }
    if (!user.id) throw new UnauthorizedException('Telegram не передал, кто открыл CRM');
    return { tgUserId: String(user.id), username: user.username ? user.username.toLowerCase() : null, firstName: user.first_name ?? null };
  }

  // ---- управление своими Telegram-аккаунтами (меню профиля) ----

  async list(user: AuthUser) {
    const bot = await this.prisma.notificationBot.findUnique({ where: { companyId: user.companyId }, select: { tgBotUsername: true, isActive: true } });
    const accounts = await this.prisma.userTelegramAccount.findMany({
      where: { userId: user.userId, companyId: user.companyId, OR: [{ linkToken: null }, { linkTokenExpiresAt: { gt: new Date() } }] },
      orderBy: { createdAt: 'asc' },
    });
    return {
      bot: bot ? { username: bot.tgBotUsername, active: bot.isActive } : null,
      accounts: accounts
        .filter((a) => !a.linkToken)
        .map((a) => ({ id: a.id, username: a.username, firstName: a.tgFirstName, linked: !!a.tgUserId, linkedAt: a.linkedAt, lastLoginAt: a.lastLoginAt })),
    };
  }

  async addByUsername(user: AuthUser, raw: string) {
    await this.requireBot(user.companyId);
    const username = raw.trim().replace(/^@/, '').toLowerCase();
    if (!USERNAME_PATTERN.test(username)) throw new BadRequestException('Тег Telegram — 5–32 символа: латиница, цифры и подчёркивание');
    await this.assertRoom(user);
    const clash = await this.prisma.userTelegramAccount.findFirst({ where: { companyId: user.companyId, username }, select: { userId: true } });
    if (clash) {
      throw new ConflictException(clash.userId === user.userId ? `@${username} уже добавлен` : `@${username} уже привязан к другому сотруднику компании`);
    }
    await this.prisma.userTelegramAccount.create({ data: { companyId: user.companyId, userId: user.userId, username } });
    return this.list(user);
  }

  // Ссылка на бота с одноразовым кодом: человек открывает её в нужном Telegram-аккаунте и жмёт «Старт».
  async createLink(user: AuthUser) {
    const bot = await this.requireBot(user.companyId);
    await this.assertRoom(user);
    // Старые неиспользованные ссылки этого сотрудника больше не нужны.
    await this.prisma.userTelegramAccount.deleteMany({ where: { userId: user.userId, linkToken: { not: null } } });
    const token = randomBytes(18).toString('base64url');
    await this.prisma.userTelegramAccount.create({
      data: { companyId: user.companyId, userId: user.userId, linkToken: token, linkTokenExpiresAt: new Date(Date.now() + LINK_TTL_MS) },
    });
    return { url: `https://t.me/${bot.tgBotUsername}?start=link_${token}`, expiresInMin: LINK_TTL_MS / 60000 };
  }

  async remove(user: AuthUser, id: string) {
    const row = await this.prisma.userTelegramAccount.findFirst({ where: { id, userId: user.userId } });
    if (!row) throw new NotFoundException('Аккаунт не найден');
    await this.prisma.userTelegramAccount.delete({ where: { id } });
    return this.list(user);
  }

  private async requireBot(companyId: string) {
    const bot = await this.prisma.notificationBot.findUnique({ where: { companyId } });
    if (!bot) throw new BadRequestException('У компании не подключён бот оповещений — владелец подключает его в Настройки → Оповещения');
    return bot;
  }

  private async assertRoom(user: AuthUser) {
    const n = await this.prisma.userTelegramAccount.count({ where: { userId: user.userId, linkToken: null } });
    if (n >= MAX_ACCOUNTS) throw new BadRequestException(`Не больше ${MAX_ACCOUNTS} Telegram-аккаунтов на профиль`);
  }
}
