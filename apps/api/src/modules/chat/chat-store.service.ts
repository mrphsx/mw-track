import { Injectable, Logger } from '@nestjs/common';
import { Channel, ChatSenderType, Conversation, ConversationSource } from '@prisma/client';
import type { Message } from 'grammy/types';
import { PrismaService } from '../../prisma/prisma.service';
import { formatUserName } from '../../common/user-name.util';
import { ChatStagesEngine } from './chat-stages.engine';
import { chatResourceKey } from './chat-resource.util';

// Запись переписки во встроенный чат (запрос пользователя 2026-10-23). Отдельный сервис только
// на PrismaService — его вызывает TelegramProvider (ChannelsModule) на каждое входящее сообщение
// бота, а сам чат (ChatModule) импортирует ChannelsModule для отправки ответов; держать запись
// в ChatModule значило бы замкнуть ChannelsModule ↔ ChatModule в цикл.
//
// Все методы best-effort: сбой записи в чат никогда не должен ронять обработку вебхука бота.

export interface ChatMedia {
  type: string;
  fileId: string;
  fileName?: string;
}

const MEDIA_PREVIEW: Record<string, string> = {
  photo: 'Фото',
  video: 'Видео',
  voice: 'Голосовое сообщение',
  video_note: 'Видеосообщение',
  audio: 'Аудио',
  document: 'Файл',
  sticker: 'Стикер',
  animation: 'GIF',
};

const PREVIEW_LENGTH = 140;

// Ключи ресурса вынесены в chat-resource.util.ts (иначе цикл импорта с ChatStagesEngine);
// реэкспорт — для старых импортов.
export { chatResourceKey, normalizeChatResource, chatResourceKind } from './chat-resource.util';

export function chatPreview(text: string | null | undefined, mediaType?: string | null): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (clean) return clean.length > PREVIEW_LENGTH ? `${clean.slice(0, PREVIEW_LENGTH - 1)}…` : clean;
  return mediaType ? `[${MEDIA_PREVIEW[mediaType] ?? 'Вложение'}]` : '';
}

// Самое крупное фото из набора размеров, остальные типы — как есть. Стикер хранится как
// медиа: в чате он показывается картинкой (у анимированных .tgs — подписью-эмодзи).
// От кого переслано (Bot API forward_origin, 2026-10-26): человек, скрытый отправитель, чат или канал.
export function forwardOriginName(message: Message): string | null {
  const o = message.forward_origin;
  if (!o) return null;
  switch (o.type) {
    case 'user':
      return [o.sender_user.first_name, o.sender_user.last_name].filter(Boolean).join(' ') || (o.sender_user.username ? `@${o.sender_user.username}` : 'пользователь');
    case 'hidden_user':
      return o.sender_user_name || 'скрытый пользователь';
    case 'chat':
      return o.sender_chat.title ?? 'чат';
    case 'channel':
      return o.chat.title ?? 'канал';
    default:
      return 'пересланное';
  }
}

export function extractTelegramMedia(message: Message): ChatMedia | null {
  if (message.photo?.length) return { type: 'photo', fileId: message.photo[message.photo.length - 1].file_id };
  if (message.video) return { type: 'video', fileId: message.video.file_id, fileName: message.video.file_name };
  if (message.animation) return { type: 'animation', fileId: message.animation.file_id };
  if (message.voice) return { type: 'voice', fileId: message.voice.file_id };
  if (message.video_note) return { type: 'video_note', fileId: message.video_note.file_id };
  if (message.audio) return { type: 'audio', fileId: message.audio.file_id, fileName: message.audio.file_name };
  if (message.document) return { type: 'document', fileId: message.document.file_id, fileName: message.document.file_name };
  if (message.sticker) return { type: 'sticker', fileId: message.sticker.file_id, fileName: message.sticker.emoji };
  return null;
}

// Сообщения сценариев уходят в Telegram с HTML-разметкой — в чат пишем читаемый текст.
function stripTelegramHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/​/g, '')
    .trim();
}

@Injectable()
export class ChatStoreService {
  private readonly logger = new Logger(ChatStoreService.name);
  // companyId канала не меняется — без кэша каждое входящее сообщение тянуло бы лишний запрос.
  private readonly companyByProject = new Map<string, string>();

  constructor(
    private prisma: PrismaService,
    private stages: ChatStagesEngine,
  ) {}

  private async companyIdFor(projectId: string): Promise<string | null> {
    const cached = this.companyByProject.get(projectId);
    if (cached) return cached;
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { companyId: true } });
    if (project) this.companyByProject.set(projectId, project.companyId);
    return project?.companyId ?? null;
  }

  // botKey — '' для основного бота проекта, id ProjectBot для дополнительного (2026-10-24).
  async recordIncomingBotMessage(channel: Channel, message: Message, botKey = ''): Promise<void> {
    const from = message.from;
    if (!from || from.is_bot || message.chat.type !== 'private') return;
    const rawText = message.text ?? message.caption ?? null;
    await this.recordIncoming(channel, 'BOT', {
      peerId: String(from.id),
      firstName: from.first_name,
      lastName: from.last_name,
      username: from.username,
      // Хвост /start — служебный код ссылки/лендинга, оператору он ни к чему.
      text: rawText && /^\/start(\s|$)/.test(rawText) ? '/start' : rawText,
      media: extractTelegramMedia(message),
      externalId: String(message.message_id),
      sentAt: new Date(message.date * 1000),
      replyToExternalId: message.reply_to_message ? String(message.reply_to_message.message_id) : null,
      forwardedFrom: forwardOriginName(message),
    }, botKey);
  }

  // Клиент отредактировал сообщение боту (edited_message, 2026-10-26).
  async recordEditedBotMessage(channel: Channel, message: Message, botKey = ''): Promise<void> {
    if (!message.from || message.from.is_bot || message.chat.type !== 'private') return;
    await this.recordEdit(channel, 'BOT', botKey, String(message.from.id), String(message.message_id), message.text ?? message.caption ?? null, message.edit_date);
  }

  // Удалено в Telegram мимо CRM (личка): помечаем без автора — «удалено в Telegram». Если удалили
  // из CRM, ChatService.deleteMessage сам проставит deletedById (его запись идёт после этой).
  async recordDeletedPersonal(channel: Channel, externalIds: string[]): Promise<void> {
    try {
      await this.prisma.chatMessage.updateMany({
        where: { externalId: { in: externalIds }, deletedAt: null, conversation: { channelId: channel.id, source: 'PERSONAL' } },
        data: { deletedAt: new Date() },
      });
    } catch (error) {
      this.logger.warn(`recordDeletedPersonal failed for channel ${channel.id}: ${(error as Error).message}`);
    }
  }

  // Правка сообщения в Telegram (клиентом или оператором с телефона): текст в CRM обновляется,
  // исходный остаётся в originalText — видно, что было до правки. Сообщения, которого в CRM нет, —
  // пропускаем.
  async recordEdit(channel: Channel, source: ConversationSource, botKey: string, peerId: string, externalId: string, text: string | null, editDate?: number): Promise<void> {
    try {
      const conversation = await this.prisma.conversation.findUnique({
        where: { channelId_source_botKey_peerId: { channelId: channel.id, source, botKey, peerId } },
        select: { id: true },
      });
      if (!conversation) return;
      const message = await this.prisma.chatMessage.findFirst({ where: { conversationId: conversation.id, externalId }, orderBy: { createdAt: 'desc' } });
      if (!message || message.text === text) return;
      await this.prisma.chatMessage.update({
        where: { id: message.id },
        data: { text, originalText: message.originalText ?? message.text, editedAt: editDate ? new Date(editDate * 1000) : new Date() },
      });
    } catch (error) {
      this.logger.warn(`recordEdit (${source}) failed for channel ${channel.id}: ${(error as Error).message}`);
    }
  }

  // Общая запись входящего для бота и личного аккаунта (TelegramPersonalService). У лички медиа
  // без file_id Bot API — файл достаётся по externalId (id сообщения) через MTProto.
  async recordIncoming(
    channel: Channel,
    source: ConversationSource,
    data: {
      peerId: string;
      firstName?: string | null;
      lastName?: string | null;
      username?: string | null;
      text: string | null;
      media: { type: string; fileId?: string; fileName?: string } | null;
      externalId: string;
      sentAt: Date;
      replyToExternalId?: string | null;
      forwardedFrom?: string | null;
    },
    botKey = '',
  ): Promise<void> {
    try {
      if (!data.text && !data.media) return; // служебные апдейты (закреп, смена фото и т.п.) в чат не пишем
      const companyId = await this.companyIdFor(channel.projectId);
      if (!companyId) return;

      const preview = chatPreview(data.text, data.media?.type);
      // Привязка к клиенту CRM — по ней работают карточка клиента в чате и «только свои клиенты»
      // баера. На самом первом /start клиента ещё нет (его создаёт обработчик ниже по цепочке) —
      // тогда привязывает linkClient из handleStart.
      const client = await this.prisma.client.findFirst({
        where: { projectId: channel.projectId, tgUserId: data.peerId, deletedAt: null },
        select: { id: true },
      });

      const conversation = await this.prisma.conversation.upsert({
        where: { channelId_source_botKey_peerId: { channelId: channel.id, source, botKey, peerId: data.peerId } },
        create: {
          companyId,
          projectId: channel.projectId,
          channelId: channel.id,
          source,
          botKey,
          peerId: data.peerId,
          clientId: client?.id,
          peerFirstName: data.firstName,
          peerLastName: data.lastName,
          peerUsername: data.username,
          lastMessageAt: data.sentAt,
          lastMessageText: preview,
          lastMessageDirection: 'IN',
          lastIncomingAt: data.sentAt,
          unreadCount: 1,
        },
        update: {
          ...(client ? { clientId: client.id } : {}),
          ...(data.firstName ? { peerFirstName: data.firstName, peerLastName: data.lastName ?? null } : {}),
          ...(data.username !== undefined ? { peerUsername: data.username ?? null } : {}),
          lastMessageAt: data.sentAt,
          lastMessageText: preview,
          lastMessageDirection: 'IN',
          lastIncomingAt: data.sentAt,
          unreadCount: { increment: 1 },
          lastError: null,
          deletedAt: null,
          // Лид написал снова — диалог возвращается из «Ждём ответа»/«Завершён» в работу.
          status: 'OPEN',
        },
      });

      await this.prisma.chatMessage.create({
        data: {
          conversationId: conversation.id,
          direction: 'IN',
          senderType: 'CLIENT',
          text: data.text,
          mediaType: data.media?.type,
          mediaFileId: data.media?.fileId,
          mediaFileName: data.media?.fileName,
          externalId: data.externalId,
          replyToId: await this.messageIdByExternal(conversation.id, data.replyToExternalId),
          forwardedFrom: data.forwardedFrom?.slice(0, 200) || null,
          createdAt: data.sentAt,
        },
      });

      // Авто-распределение (2026-10-25) — только диалогам, которым ответственного ещё ни разу не
      // назначали: возвращённый оператором тимлиду чат снова сам по себе не раздаётся.
      // Этап «Новый диалог» (2026-10-25), если он настроен у проекта, сам назначает оператора этапа.
      if (!conversation.assignedUserId && !conversation.assignedAt && !conversation.stageId) {
        if (!(await this.stages.onNewConversation(conversation))) await this.autoAssign(conversation);
      }
    } catch (error) {
      this.logger.warn(`recordIncoming (${source}) failed for channel ${channel.id}: ${(error as Error).message}`);
    }
  }

  // Выбор оператора по долям ChatAutoAssignRule ресурса диалога. Участвуют только действующие
  // операторы с доступом к проекту — уволенный или убранный из проекта оператор новых чатов не
  // получает, даже если его строка правила осталась.
  private async autoAssign(conversation: Conversation): Promise<void> {
    const rules = await this.prisma.chatAutoAssignRule.findMany({
      where: { projectId: conversation.projectId, resource: chatResourceKey(conversation), weight: { gt: 0 } },
      select: { userId: true, weight: true },
    });
    if (rules.length === 0) return;
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: rules.map((r) => r.userId) },
        companyId: conversation.companyId,
        deletedAt: null,
        isActive: true,
        role: 'OPERATOR',
        projectAccess: { some: { projectId: conversation.projectId } },
      },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    const pool = rules.filter((r) => users.some((u) => u.id === r.userId));
    const total = pool.reduce((sum, r) => sum + r.weight, 0);
    if (total <= 0) return;
    let roll = Math.random() * total;
    const picked = pool.find((r) => (roll -= r.weight) < 0) ?? pool[pool.length - 1];

    // Условный апдейт — два почти одновременных входящих не назначат диалог дважды.
    const updated = await this.prisma.conversation.updateMany({
      where: { id: conversation.id, assignedUserId: null, assignedAt: null },
      data: { assignedUserId: picked.userId, assignedAt: new Date() },
    });
    if (updated.count === 0) return;
    const user = users.find((u) => u.id === picked.userId)!;
    await this.appendSystemNote(conversation.id, `Чат автоматически назначен оператору ${formatUserName(user) || user.email}`);
  }

  // Служебная запись в ленте переписки (назначение/передача/возврат чата). В Telegram не уходит и
  // не трогает lastMessage*/unreadCount диалога — это не сообщение собеседнику.
  async appendSystemNote(conversationId: string, text: string, actorUserId?: string): Promise<void> {
    await this.prisma.chatMessage.create({
      data: { conversationId, direction: 'OUT', senderType: 'SYSTEM', senderUserId: actorUserId, text },
    });
  }

  // Исходящее с личного аккаунта, отправленное мимо CRM — оператор пишет с телефона. Только в
  // уже существующий диалог: личка — рабочий аккаунт, но переписку, которую начал не клиент,
  // в CRM не тянем. Ответы, отправленные из самого чата CRM, приходят сюда же событием
  // Telegram — их отсекает проверка externalId (sendChatMessage сохраняет его до этого события
  // или почти одновременно, поэтому проверка с небольшой задержкой — см. вызов).
  // Наш id сообщения по его id в Telegram — для ответов (reply).
  async messageIdByExternal(conversationId: string, externalId?: string | null): Promise<string | null> {
    if (!externalId) return null;
    const m = await this.prisma.chatMessage.findFirst({ where: { conversationId, externalId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    return m?.id ?? null;
  }

  async recordOutgoingPersonal(
    channel: Channel,
    data: { peerId: string; text: string | null; media: { type: string; fileName?: string } | null; externalId: string; sentAt: Date; replyToExternalId?: string | null; forwardedFrom?: string | null },
  ): Promise<void> {
    try {
      if (!data.text && !data.media) return;
      const conversation = await this.prisma.conversation.findUnique({
        where: { channelId_source_botKey_peerId: { channelId: channel.id, source: 'PERSONAL', botKey: '', peerId: data.peerId } },
        select: { id: true },
      });
      if (!conversation) return;
      const duplicate = await this.prisma.chatMessage.findFirst({
        where: { conversationId: conversation.id, direction: 'OUT', externalId: data.externalId },
        select: { id: true },
      });
      if (duplicate) return;
      await this.appendOutgoing(conversation.id, {
        senderType: 'OPERATOR',
        text: data.text,
        mediaType: data.media?.type,
        mediaFileName: data.media?.fileName,
        externalId: data.externalId,
        replyToId: await this.messageIdByExternal(conversation.id, data.replyToExternalId),
        forwardedFrom: data.forwardedFrom,
      });
      // Оператор ответил с телефона — всё, что было до ответа, прочитано.
      await this.prisma.conversation.update({ where: { id: conversation.id }, data: { unreadCount: 0 } });
    } catch (error) {
      this.logger.warn(`recordOutgoingPersonal failed for channel ${channel.id}: ${(error as Error).message}`);
    }
  }

  async linkClient(channel: Channel, peerId: string): Promise<void> {
    try {
      const client = await this.prisma.client.findFirst({
        where: { projectId: channel.projectId, tgUserId: peerId, deletedAt: null },
        select: { id: true },
      });
      if (!client) return;
      await this.prisma.conversation.updateMany({
        where: { channelId: channel.id, source: 'BOT', botKey: '', peerId, clientId: null },
        data: { clientId: client.id },
      });
    } catch (error) {
      this.logger.warn(`linkClient failed for channel ${channel.id}: ${(error as Error).message}`);
    }
  }

  // Ответ бота по сценарию — только в уже существующий диалог (см. комментарий у Conversation
  // в schema.prisma), без увеличения unreadCount: это не то, на что должен реагировать оператор.
  async recordBotMessage(channel: Channel, peerId: string, html: string, mediaType?: string, botKey = ''): Promise<void> {
    try {
      const conversation = await this.prisma.conversation.findUnique({
        where: { channelId_source_botKey_peerId: { channelId: channel.id, source: 'BOT', botKey, peerId } },
        select: { id: true },
      });
      if (!conversation) return;
      const text = stripTelegramHtml(html) || null;
      await this.appendOutgoing(conversation.id, { senderType: 'BOT', text, mediaType });
    } catch (error) {
      this.logger.warn(`recordBotMessage failed for channel ${channel.id}: ${(error as Error).message}`);
    }
  }

  async appendOutgoing(
    conversationId: string,
    data: {
      senderType: ChatSenderType;
      senderUserId?: string;
      text?: string | null;
      mediaType?: string | null;
      mediaFileId?: string | null;
      mediaFileName?: string | null;
      externalId?: string | null;
      error?: string | null;
      replyToId?: string | null;
      forwardedFrom?: string | null;
    },
  ) {
    const now = new Date();
    const [message] = await this.prisma.$transaction([
      this.prisma.chatMessage.create({
        data: {
          conversationId,
          direction: 'OUT',
          senderType: data.senderType,
          senderUserId: data.senderUserId,
          text: data.text,
          mediaType: data.mediaType,
          mediaFileId: data.mediaFileId,
          mediaFileName: data.mediaFileName,
          externalId: data.externalId,
          error: data.error,
          replyToId: data.replyToId ?? null,
          forwardedFrom: data.forwardedFrom?.slice(0, 200) || null,
          createdAt: now,
        },
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: now,
          lastMessageText: chatPreview(data.text, data.mediaType),
          lastMessageDirection: 'OUT',
          lastError: data.error ?? null,
        },
      }),
    ]);
    return message;
  }

  // Диалог, начатый оператором из карточки клиента: через бота — человек уже запускал бота, но
  // сам ещё не писал; через личку — аккаунт может написать первым.
  async findOrCreateConversation(
    channel: Channel,
    source: ConversationSource,
    client: { id: string; tgUserId: string; tgFirstName: string | null; tgLastName: string | null; tgUsername: string | null },
    botKey = '',
  ): Promise<Conversation | null> {
    const companyId = await this.companyIdFor(channel.projectId);
    if (!companyId) return null;
    return this.prisma.conversation.upsert({
      where: { channelId_source_botKey_peerId: { channelId: channel.id, source, botKey, peerId: client.tgUserId } },
      create: {
        companyId,
        projectId: channel.projectId,
        channelId: channel.id,
        source,
        botKey,
        peerId: client.tgUserId,
        clientId: client.id,
        peerFirstName: client.tgFirstName,
        peerLastName: client.tgLastName,
        peerUsername: client.tgUsername,
      },
      update: { clientId: client.id, deletedAt: null },
    });
  }
}
