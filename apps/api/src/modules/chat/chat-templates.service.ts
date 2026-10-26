import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ProjectsService } from '../projects/projects.service';
import { StorageService } from '../landings/storage.service';
import { VideoProcessingService } from '../channels/video-processing.service';
import { ChatOutgoingFile } from '../channels/providers/telegram.provider';
import { ChatService } from './chat.service';
import { chatResourceKey, chatResourceKind } from './chat-resource.util';

const execFileAsync = promisify(execFile);

export const TEMPLATE_MEDIA_KINDS = ['photo', 'video', 'document', 'voice', 'video_note'] as const;
export type TemplateMediaKind = (typeof TEMPLATE_MEDIA_KINDS)[number];
const CODE_PATTERN = /^[\p{L}\p{N}_-]{1,32}$/u;
const COMPANY_WIDE_ROLES: UserRole[] = [UserRole.OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN];

// Сообщение цепочки шаблона из формы: id — существующее сообщение (чтобы сохранить его файл при
// keepMedia), fileField — имя поля multipart с новым файлом.
export interface TemplateMessageInput {
  id?: string;
  text?: string | null;
  mediaKind?: TemplateMediaKind | '' | null;
  keepMedia?: boolean;
  fileField?: string;
}

export interface TemplateInput {
  folderId?: string;
  code?: string;
  title?: string;
  messages?: TemplateMessageInput[];
}

const MAX_MESSAGES = 10;
// Пауза между сообщениями цепочки — чтобы в Telegram они пришли по порядку и не упёрлись в лимиты.
export const CHAIN_DELAY_MS = 600;

interface TemplatePart {
  id: string;
  text: string | null;
  mediaKind: string | null;
  mediaKey: string | null;
  mediaFileName: string | null;
  mediaMime: string | null;
}

type TemplateWithMessages = Prisma.ChatTemplateGetPayload<{ include: { messages: true } }>;

// Сообщения шаблона по порядку. Запасной вариант — старый формат «одно сообщение в самом
// шаблоне» (шаблон, созданный до цепочек и не попавший в перенос миграцией).
function partsOf(t: TemplateWithMessages): TemplatePart[] {
  if (t.messages.length) return [...t.messages].sort((a, b) => a.sortOrder - b.sortOrder);
  if (t.text || t.mediaKey) return [{ id: `legacy-${t.id}`, text: t.text, mediaKind: t.mediaKind, mediaKey: t.mediaKey, mediaFileName: t.mediaFileName, mediaMime: t.mediaMime }];
  return [];
}

const LEGACY_EMPTY = { text: null, mediaKind: null, mediaKey: null, mediaFileName: null, mediaMime: null };

// Шаблоны ответов в чате (2026-10-25, как в Chatterfy): папки → шаблоны с кодом для вызова «#код»
// прямо в поле ввода, текстом и медиа (фото, видео, документ, голосовое, кружок). Пользуются все,
// кто видит чаты проекта; менять — тимлид проекта (папки проекта), админ и владелец (любые, в том
// числе общие для всей компании). Голосовое заранее перекодируется в ogg/opus, кружок — в
// квадратное mp4, чтобы при отправке Telegram принял файл без обработки.
@Injectable()
export class ChatTemplatesService {
  constructor(
    private prisma: PrismaService,
    private projectsService: ProjectsService,
    private storage: StorageService,
    private videoProcessing: VideoProcessingService,
    private chatService: ChatService,
  ) {}

  private async canManageFolder(projectId: string | null, companyId: string, user: AuthUser): Promise<boolean> {
    if (COMPANY_WIDE_ROLES.includes(user.role)) return true;
    if (!projectId) return false;
    try {
      await this.projectsService.assertCanManageProjectOperators(projectId, companyId, user.userId, user.role);
      return true;
    } catch {
      return false;
    }
  }

  private async assertManageFolder(projectId: string | null, companyId: string, user: AuthUser) {
    if (!(await this.canManageFolder(projectId, companyId, user))) {
      throw new ForbiddenException(projectId ? 'Шаблоны проекта меняет тимлид или админ' : 'Общие шаблоны компании меняет админ или владелец');
    }
  }

  // Папки и шаблоны ресурса (бот/личка — свои, 2026-10-25): папки этого ресурса проекта + общие
  // папки компании для этого вида ресурса (любой бот / любая личка).
  async list(projectId: string, resource: string, companyId: string, user: AuthUser) {
    if (!(await this.chatService.canSeeProjectChats(companyId, user, projectId))) throw new NotFoundException('Проект не найден');
    const folders = await this.prisma.chatTemplateFolder.findMany({
      where: { companyId, OR: [{ projectId: null, resource: chatResourceKind(resource) }, { projectId, resource }] },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { templates: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], include: { messages: true } } },
    });
    const canManageProject = await this.canManageFolder(projectId, companyId, user);
    const canManageCompany = COMPANY_WIDE_ROLES.includes(user.role);
    return {
      canManageProject,
      canManageCompany,
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        projectId: f.projectId,
        canEdit: f.projectId ? canManageProject : canManageCompany,
        templates: f.templates.map((t) => {
          const parts = partsOf(t);
          const firstMedia = parts.find((p) => p.mediaKind);
          return {
            id: t.id,
            folderId: t.folderId,
            code: t.code,
            title: t.title,
            // Краткая сводка для поиска и подсказок «#код» — первое сообщение цепочки.
            text: parts[0]?.text ?? null,
            mediaKind: firstMedia?.mediaKind ?? null,
            mediaFileName: firstMedia?.mediaFileName ?? null,
            messages: parts.map((p) => ({ id: p.id, text: p.text, mediaKind: p.mediaKind, mediaFileName: p.mediaFileName })),
          };
        }),
      })),
    };
  }

  async createFolder(companyId: string, user: AuthUser, name: string, projectId: string | null, resource: string) {
    if (projectId) await this.projectsService.findOne(projectId, companyId);
    await this.assertManageFolder(projectId, companyId, user);
    const clean = name.trim();
    if (!clean) throw new BadRequestException('Введите название папки');
    return this.prisma.chatTemplateFolder.create({ data: { companyId, projectId, resource: projectId ? resource : chatResourceKind(resource), name: clean } });
  }

  private async loadFolder(folderId: string, companyId: string, user: AuthUser) {
    const folder = await this.prisma.chatTemplateFolder.findFirst({ where: { id: folderId, companyId } });
    if (!folder) throw new NotFoundException('Папка не найдена');
    await this.assertManageFolder(folder.projectId, companyId, user);
    return folder;
  }

  async renameFolder(folderId: string, companyId: string, user: AuthUser, name: string) {
    await this.loadFolder(folderId, companyId, user);
    const clean = name.trim();
    if (!clean) throw new BadRequestException('Введите название папки');
    return this.prisma.chatTemplateFolder.update({ where: { id: folderId }, data: { name: clean } });
  }

  // Шаблоны папки удаляются вместе с ней (onDelete: Cascade), их файлы — из хранилища.
  async deleteFolder(folderId: string, companyId: string, user: AuthUser) {
    await this.loadFolder(folderId, companyId, user);
    const templates = await this.prisma.chatTemplate.findMany({ where: { folderId }, include: { messages: true } });
    await this.prisma.chatTemplateFolder.delete({ where: { id: folderId } });
    await this.removeKeys(templates.flatMap((t) => this.keysOf(t)));
    return { ok: true };
  }

  async createTemplate(companyId: string, user: AuthUser, input: TemplateInput, files: Express.Multer.File[] = []) {
    if (!input.folderId) throw new BadRequestException('Не выбрана папка');
    await this.loadFolder(input.folderId, companyId, user);
    const code = this.cleanCode(input.code);
    const title = input.title?.trim() || code;
    const id = randomUUID();
    const { parts, newKeys } = await this.buildParts(companyId, id, input.messages, files, []);
    try {
      return await this.prisma.chatTemplate.create({
        data: {
          companyId,
          folderId: input.folderId,
          code,
          title,
          createdById: user.userId,
          messages: { create: parts.map((p, i) => ({ ...p, sortOrder: i })) },
        },
      });
    } catch (error) {
      await this.removeKeys(newKeys);
      throw this.mapUniqueError(error);
    }
  }

  async updateTemplate(templateId: string, companyId: string, user: AuthUser, input: TemplateInput, files: Express.Multer.File[] = []) {
    const template = await this.prisma.chatTemplate.findFirst({ where: { id: templateId, companyId }, include: { messages: true } });
    if (!template) throw new NotFoundException('Шаблон не найден');
    await this.loadFolder(template.folderId, companyId, user);
    if (input.folderId && input.folderId !== template.folderId) await this.loadFolder(input.folderId, companyId, user);

    const oldKeys = this.keysOf(template);
    const { parts, newKeys } = await this.buildParts(companyId, template.id, input.messages, files, partsOf(template));
    try {
      const [, updated] = await this.prisma.$transaction([
        this.prisma.chatTemplateMessage.deleteMany({ where: { templateId } }),
        this.prisma.chatTemplate.update({
          where: { id: templateId },
          data: {
            ...(input.folderId ? { folderId: input.folderId } : {}),
            ...(input.code !== undefined ? { code: this.cleanCode(input.code) } : {}),
            ...(input.title !== undefined ? { title: input.title.trim() || template.code } : {}),
            // Содержимое теперь только в цепочке — старые колонки очищаем, файл при этом не теряется:
            // если он перенесён в сообщение, его ключ остаётся в используемых.
            ...LEGACY_EMPTY,
            messages: { create: parts.map((p, i) => ({ ...p, sortOrder: i })) },
          },
        }),
      ]);
      const used = new Set(parts.map((p) => p.mediaKey).filter(Boolean));
      await this.removeKeys(oldKeys.filter((k) => !used.has(k)));
      return updated;
    } catch (error) {
      await this.removeKeys(newKeys);
      throw this.mapUniqueError(error);
    }
  }

  async deleteTemplate(templateId: string, companyId: string, user: AuthUser) {
    const template = await this.prisma.chatTemplate.findFirst({ where: { id: templateId, companyId }, include: { messages: true } });
    if (!template) throw new NotFoundException('Шаблон не найден');
    await this.loadFolder(template.folderId, companyId, user);
    await this.prisma.chatTemplate.delete({ where: { id: templateId } });
    await this.removeKeys(this.keysOf(template));
    return { ok: true };
  }

  // Шаблон, доступный в чатах проекта (общий или этого проекта) — для отправки и предпросмотра.
  // resource — ресурс диалога/рассылки: шаблон должен быть из папки этого ресурса (или общей того же вида).
  async loadUsable(templateId: string, companyId: string, user: AuthUser, projectId?: string, resource?: string) {
    const template = await this.prisma.chatTemplate.findFirst({ where: { id: templateId, companyId }, include: { folder: true, messages: true } });
    if (!template) throw new NotFoundException('Шаблон не найден');
    if (projectId && template.folder.projectId && template.folder.projectId !== projectId) throw new NotFoundException('Шаблон не найден');
    if (resource) {
      const fits = template.folder.projectId ? template.folder.resource === resource : template.folder.resource === chatResourceKind(resource);
      if (!fits) throw new NotFoundException('Шаблон относится к другому боту/личке');
    }
    const scopeProject = template.folder.projectId ?? projectId;
    if (scopeProject && !(await this.chatService.canSeeProjectChats(companyId, user, scopeProject))) throw new NotFoundException('Шаблон не найден');
    return template;
  }

  // Файл одного сообщения цепочки (id из list().messages; «legacy-<id>» — старый формат).
  async getMessageMedia(messageId: string, companyId: string, user: AuthUser) {
    let part: TemplatePart | undefined;
    if (messageId.startsWith('legacy-')) {
      const template = await this.loadUsable(messageId.slice('legacy-'.length), companyId, user);
      part = partsOf(template)[0];
    } else {
      const message = await this.prisma.chatTemplateMessage.findUnique({ where: { id: messageId } });
      if (!message) throw new NotFoundException('Файл не найден');
      await this.loadUsable(message.templateId, companyId, user);
      part = message;
    }
    if (!part?.mediaKey) throw new NotFoundException('У сообщения нет файла');
    return { stream: await this.storage.getObjectStream(part.mediaKey), mime: part.mediaMime ?? 'application/octet-stream', fileName: part.mediaFileName };
  }

  // Прежний адрес файла шаблона — файл первого сообщения с медиа.
  async getMedia(templateId: string, companyId: string, user: AuthUser) {
    const template = await this.loadUsable(templateId, companyId, user);
    const part = partsOf(template).find((p) => p.mediaKey);
    if (!part) throw new NotFoundException('У шаблона нет файла');
    return this.getMessageMedia(part.id, companyId, user);
  }

  // Отправка шаблона в диалог. Одно сообщение — как раньше: текст из поля ввода (если оператор его
  // поправил) или текст шаблона + файл шаблона. Цепочка — сначала текст из поля ввода, если он
  // есть, затем все сообщения шаблона по порядку; на первой ошибке останавливаемся.
  async sendTemplate(conversationId: string, companyId: string, user: AuthUser, templateId: string, composerText?: string, replyToId?: string) {
    const conversation = await this.chatService.loadConversation(conversationId, companyId, user, true);
    const template = await this.loadUsable(templateId, companyId, user, conversation.projectId, chatResourceKey(conversation));
    const parts = partsOf(template);
    if (parts.length === 0) throw new BadRequestException('Шаблон пустой');
    const typed = composerText?.trim() || undefined;

    if (parts.length === 1) {
      return this.chatService.send(conversationId, companyId, user, { text: typed ?? parts[0].text ?? undefined, attachment: await this.attachmentOf(parts[0]), replyToId });
    }

    // Ответом (reply) уходит только первое сообщение цепочки.
    let last = typed ? await this.chatService.send(conversationId, companyId, user, { text: typed, replyToId }) : null;
    for (const part of parts) {
      if (last?.error) return last;
      if (last) await new Promise((r) => setTimeout(r, CHAIN_DELAY_MS));
      last = await this.chatService.send(conversationId, companyId, user, { text: part.text ?? undefined, attachment: await this.attachmentOf(part), replyToId: last ? undefined : replyToId });
    }
    return last!;
  }

  async attachmentOf(part: Pick<TemplatePart, 'mediaKey' | 'mediaKind' | 'mediaFileName' | 'mediaMime'>): Promise<ChatOutgoingFile | undefined> {
    if (!part.mediaKey) return undefined;
    const buffer = await this.storage.getObjectBuffer(part.mediaKey);
    const kind = part.mediaKind === 'voice' || part.mediaKind === 'video_note' ? part.mediaKind : undefined;
    return { buffer, filename: part.mediaFileName ?? 'file', mimetype: part.mediaMime ?? 'application/octet-stream', kind };
  }

  // Сообщения цепочки из формы: новые файлы загружаем, у сохранённых сообщений с keepMedia
  // переиспользуем прежний файл. newKeys — загруженное сейчас (удалить при ошибке сохранения).
  private async buildParts(companyId: string, templateId: string, inputs: TemplateMessageInput[] | undefined, files: Express.Multer.File[], existing: TemplatePart[]) {
    if (!inputs?.length) throw new BadRequestException('Добавьте хотя бы одно сообщение');
    if (inputs.length > MAX_MESSAGES) throw new BadRequestException(`Не больше ${MAX_MESSAGES} сообщений в шаблоне`);
    const parts: Omit<TemplatePart, 'id'>[] = [];
    const newKeys: string[] = [];
    try {
      for (const [i, input] of inputs.entries()) {
        const text = typeof input.text === 'string' ? input.text.trim() || null : null;
        if (text && text.length > 4096) throw new BadRequestException(`Сообщение ${i + 1}: текст длиннее 4096 символов`);
        const file = input.fileField ? files.find((f) => f.fieldname === input.fileField) : undefined;
        let media: Pick<TemplatePart, 'mediaKind' | 'mediaKey' | 'mediaFileName' | 'mediaMime'> = { mediaKind: null, mediaKey: null, mediaFileName: null, mediaMime: null };
        if (file) {
          const kind = input.mediaKind && (TEMPLATE_MEDIA_KINDS as readonly string[]).includes(input.mediaKind) ? (input.mediaKind as TemplateMediaKind) : null;
          media = await this.storeMedia(companyId, templateId, file, kind);
          newKeys.push(media.mediaKey!);
        } else if (input.keepMedia && input.id) {
          const prev = existing.find((p) => p.id === input.id);
          if (prev?.mediaKey) media = { mediaKind: prev.mediaKind, mediaKey: prev.mediaKey, mediaFileName: prev.mediaFileName, mediaMime: prev.mediaMime };
        }
        if (!text && !media.mediaKey) throw new BadRequestException(`Сообщение ${i + 1}: нужен текст или файл`);
        parts.push({ text, ...media });
      }
    } catch (error) {
      await this.removeKeys(newKeys);
      throw error;
    }
    return { parts, newKeys };
  }

  private keysOf(t: TemplateWithMessages): string[] {
    return Array.from(new Set([t.mediaKey, ...t.messages.map((m) => m.mediaKey)].filter((k): k is string => !!k)));
  }

  private async removeKeys(keys: string[]) {
    await Promise.all(keys.map((k) => this.storage.removeObject(k).catch(() => {})));
  }

  private cleanCode(raw?: string): string {
    const code = (raw ?? '').trim().replace(/^#/, '');
    if (!CODE_PATTERN.test(code)) throw new BadRequestException('Код шаблона — до 32 букв, цифр, «-» или «_», без пробелов');
    return code;
  }

  private mapUniqueError(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return new ConflictException('Шаблон с таким кодом уже есть');
    return error;
  }

  // Тип медиа: голосовое и кружок — только по явному выбору, иначе по типу файла.
  // keyPrefix — папка в хранилище: шаблоны или медиа рассылок (2026-10-26).
  async storeMedia(companyId: string, templateId: string, file: Express.Multer.File, requested: TemplateMediaKind | null, keyPrefix = 'chat-templates') {
    let kind: TemplateMediaKind = requested ?? (/^image\/(jpeg|png|webp)$/.test(file.mimetype) ? 'photo' : file.mimetype === 'video/mp4' ? 'video' : 'document');
    let buffer = file.buffer;
    let mime = file.mimetype || 'application/octet-stream';
    let fileName = file.originalname || 'file';
    if (kind === 'voice') {
      buffer = await this.toVoice(buffer);
      mime = 'audio/ogg';
      fileName = 'voice.ogg';
    } else if (kind === 'video_note') {
      buffer = await this.videoProcessing.ensureSquareVideoNote(buffer);
      mime = 'video/mp4';
      fileName = 'video_note.mp4';
    } else if (kind === 'photo' && !/^image\/(jpeg|png|webp)$/.test(mime)) {
      kind = 'document';
    }
    const ext = path.extname(fileName) || '';
    const mediaKey = `${keyPrefix}/${companyId}/${templateId}-${randomUUID().slice(0, 8)}${ext}`;
    await this.storage.uploadBuffer(mediaKey, buffer, mime);
    return { mediaKind: kind, mediaKey, mediaFileName: fileName, mediaMime: mime };
  }

  // Голосовое Telegram — ogg/opus; любой аудио/видеофайл перекодируем, чтобы и бот, и личный
  // аккаунт отправили его именно голосовым, а не файлом.
  private async toVoice(buffer: Buffer): Promise<Buffer> {
    const input = path.join(os.tmpdir(), `voice-in-${randomUUID()}`);
    const output = path.join(os.tmpdir(), `voice-out-${randomUUID()}.ogg`);
    try {
      await fs.writeFile(input, buffer);
      await execFileAsync('ffmpeg', ['-y', '-i', input, '-vn', '-ac', '1', '-c:a', 'libopus', '-b:a', '48k', output], { timeout: 60_000 });
      return await fs.readFile(output);
    } catch {
      throw new BadRequestException('Не удалось сделать голосовое из этого файла — загрузите аудиофайл (mp3, ogg, m4a, wav)');
    } finally {
      await fs.rm(input, { force: true });
      await fs.rm(output, { force: true });
    }
  }
}
