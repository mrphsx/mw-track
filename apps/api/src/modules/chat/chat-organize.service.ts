import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ChatStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ProjectsService } from '../projects/projects.service';
import { ChatService, MAX_PINS } from './chat.service';
import { ChatStagesEngine } from './chat-stages.engine';
import { chatResourceKey } from './chat-resource.util';

// Организация диалогов, как в Chatterfy (2026-10-25): статус (в работе / ждём ответа / завершён),
// избранное (у каждого сотрудника своё) и теги лидов. Ставить теги и статус может любой, кто видит
// диалог; создавать теги — любой, кто видит чаты проекта; менять и удалять теги из справочника —
// тимлид, админ, владелец (те же права, что на операторов проекта).
@Injectable()
export class ChatOrganizeService {
  constructor(
    private prisma: PrismaService,
    private chatService: ChatService,
    private projectsService: ProjectsService,
    private stages: ChatStagesEngine,
  ) {}

  private async assertProjectChats(projectId: string, companyId: string, user: AuthUser) {
    if (!(await this.chatService.canSeeProjectChats(companyId, user, projectId))) throw new NotFoundException('Проект не найден');
  }

  // Теги ресурса (бот/личка — у каждого свои, 2026-10-25).
  async listTags(projectId: string, resource: string, companyId: string, user: AuthUser) {
    await this.assertProjectChats(projectId, companyId, user);
    const tags = await this.prisma.chatTag.findMany({
      where: { projectId, companyId, resource },
      select: { id: true, name: true, color: true, _count: { select: { conversations: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return tags.map(({ _count, ...t }) => ({ ...t, count: _count.conversations }));
  }

  async createTag(projectId: string, resource: string, companyId: string, user: AuthUser, name: string, color: string) {
    await this.assertProjectChats(projectId, companyId, user);
    const clean = name.trim();
    if (!clean) throw new BadRequestException('Введите название тега');
    try {
      return await this.prisma.chatTag.create({ data: { companyId, projectId, resource, name: clean, color }, select: { id: true, name: true, color: true } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Такой тег уже есть');
      throw error;
    }
  }

  private async loadTag(tagId: string, projectId: string, companyId: string, user: AuthUser) {
    try {
      await this.projectsService.assertCanManageProjectOperators(projectId, companyId, user.userId, user.role);
    } catch {
      throw new ForbiddenException('Менять и удалять теги может тимлид или админ');
    }
    const tag = await this.prisma.chatTag.findFirst({ where: { id: tagId, projectId, companyId } });
    if (!tag) throw new NotFoundException('Тег не найден');
    return tag;
  }

  async updateTag(projectId: string, tagId: string, companyId: string, user: AuthUser, data: { name?: string; color?: string }) {
    await this.loadTag(tagId, projectId, companyId, user);
    try {
      return await this.prisma.chatTag.update({
        where: { id: tagId },
        data: { ...(data.name?.trim() ? { name: data.name.trim() } : {}), ...(data.color ? { color: data.color } : {}) },
        select: { id: true, name: true, color: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Такой тег уже есть');
      throw error;
    }
  }

  // Удаление тега снимает его со всех диалогов (onDelete: Cascade у ConversationTag).
  async deleteTag(projectId: string, tagId: string, companyId: string, user: AuthUser) {
    await this.loadTag(tagId, projectId, companyId, user);
    await this.prisma.chatTag.delete({ where: { id: tagId } });
    return { ok: true };
  }

  // Точный набор тегов диалога: кого нет в tagIds — снимается.
  async setTags(conversationId: string, tagIds: string[], companyId: string, user: AuthUser) {
    const conversation = await this.chatService.loadConversation(conversationId, companyId, user);
    const ids = Array.from(new Set(tagIds));
    const valid = await this.prisma.chatTag.count({ where: { id: { in: ids }, projectId: conversation.projectId, companyId, resource: chatResourceKey(conversation) } });
    if (valid !== ids.length) throw new BadRequestException('Теги должны быть из этого бота/лички');
    const before = new Set((await this.prisma.conversationTag.findMany({ where: { conversationId }, select: { tagId: true } })).map((t) => t.tagId));
    await this.prisma.$transaction([
      this.prisma.conversationTag.deleteMany({ where: { conversationId, tagId: { notIn: ids } } }),
      this.prisma.conversationTag.createMany({ data: ids.map((tagId) => ({ conversationId, tagId })), skipDuplicates: true }),
    ]);
    // Этап по тегу (2026-10-25) — только на новые теги диалога.
    await this.stages.onTagsAdded(conversation, ids.filter((id) => !before.has(id)));
    return this.prisma.conversationTag
      .findMany({ where: { conversationId }, select: { tag: { select: { id: true, name: true, color: true } } } })
      .then((rows) => rows.map((r) => r.tag));
  }

  async setStatus(conversationId: string, status: ChatStatus, companyId: string, user: AuthUser) {
    await this.chatService.loadConversation(conversationId, companyId, user);
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { status } });
    return { status };
  }

  // ---- папки и избранные проекты (2026-10-25, как «спейсы» Chatterfy) ----

  private assertFolderAdmin(user: AuthUser) {
    if (!([UserRole.OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN] as UserRole[]).includes(user.role)) {
      throw new ForbiddenException('Папки проектов настраивает владелец или админ');
    }
  }

  listFolders(companyId: string) {
    return this.prisma.projectFolder.findMany({ where: { companyId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, name: true } });
  }

  async createFolder(companyId: string, user: AuthUser, name: string) {
    this.assertFolderAdmin(user);
    const clean = name.trim();
    if (!clean) throw new BadRequestException('Введите название папки');
    return this.prisma.projectFolder.create({ data: { companyId, name: clean }, select: { id: true, name: true } });
  }

  async renameFolder(folderId: string, companyId: string, user: AuthUser, name: string) {
    this.assertFolderAdmin(user);
    const clean = name.trim();
    if (!clean) throw new BadRequestException('Введите название папки');
    const updated = await this.prisma.projectFolder.updateMany({ where: { id: folderId, companyId }, data: { name: clean } });
    if (updated.count === 0) throw new NotFoundException('Папка не найдена');
    return { ok: true };
  }

  // Проекты удалённой папки остаются, просто без папки.
  async deleteFolder(folderId: string, companyId: string, user: AuthUser) {
    this.assertFolderAdmin(user);
    const folder = await this.prisma.projectFolder.findFirst({ where: { id: folderId, companyId } });
    if (!folder) throw new NotFoundException('Папка не найдена');
    await this.prisma.$transaction([
      this.prisma.project.updateMany({ where: { companyId, folderId }, data: { folderId: null } }),
      this.prisma.projectFolder.delete({ where: { id: folderId } }),
    ]);
    return { ok: true };
  }

  async setProjectFolder(projectId: string, folderId: string | null, companyId: string, user: AuthUser) {
    this.assertFolderAdmin(user);
    if (folderId && !(await this.prisma.projectFolder.findFirst({ where: { id: folderId, companyId } }))) throw new NotFoundException('Папка не найдена');
    const updated = await this.prisma.project.updateMany({ where: { id: projectId, companyId }, data: { folderId } });
    if (updated.count === 0) throw new NotFoundException('Проект не найден');
    return { folderId };
  }

  async setProjectFavorite(projectId: string, favorite: boolean, companyId: string, user: AuthUser) {
    await this.assertProjectChats(projectId, companyId, user);
    if (favorite) {
      await this.prisma.projectFavorite.upsert({
        where: { userId_projectId: { userId: user.userId, projectId } },
        create: { userId: user.userId, projectId },
        update: {},
      });
    } else {
      await this.prisma.projectFavorite.deleteMany({ where: { userId: user.userId, projectId } });
    }
    return { favorite };
  }

  // Заметка о лиде (2026-10-25) — общая для всех, кто ведёт диалог; пустая строка очищает.
  async setNote(conversationId: string, note: string, companyId: string, user: AuthUser) {
    await this.chatService.loadConversation(conversationId, companyId, user);
    const clean = note.trim() || null;
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { note: clean } });
    return { note: clean };
  }

  // Закрепить диалог наверху своего списка (2026-10-25).
  async setPinned(conversationId: string, pinned: boolean, companyId: string, user: AuthUser) {
    await this.chatService.loadConversation(conversationId, companyId, user);
    if (pinned) {
      const exists = await this.prisma.chatPin.findUnique({ where: { userId_conversationId: { userId: user.userId, conversationId } } });
      if (!exists && (await this.prisma.chatPin.count({ where: { userId: user.userId } })) >= MAX_PINS) {
        throw new BadRequestException(`Закрепить можно не больше ${MAX_PINS} диалогов — открепите какой-нибудь`);
      }
      await this.prisma.chatPin.upsert({
        where: { userId_conversationId: { userId: user.userId, conversationId } },
        create: { userId: user.userId, conversationId },
        update: {},
      });
    } else {
      await this.prisma.chatPin.deleteMany({ where: { userId: user.userId, conversationId } });
    }
    return { pinned };
  }

  async setFavorite(conversationId: string, favorite: boolean, companyId: string, user: AuthUser) {
    await this.chatService.loadConversation(conversationId, companyId, user);
    if (favorite) {
      await this.prisma.chatFavorite.upsert({
        where: { userId_conversationId: { userId: user.userId, conversationId } },
        create: { userId: user.userId, conversationId },
        update: {},
      });
    } else {
      await this.prisma.chatFavorite.deleteMany({ where: { userId: user.userId, conversationId } });
    }
    return { favorite };
  }
}
