import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Readable } from 'stream';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { ChatFieldType, ChatStageTrigger, ChatStatus, ConversationSource } from '@prisma/client';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { CHAT_TABS, ChatService, ChatTab, ConversationListFilters } from './chat.service';
import { ChatAccessService } from './chat-access.service';
import { ChatAssignmentService } from './chat-assignment.service';
import { ChatOrganizeService } from './chat-organize.service';
import { ChatTemplatesService, TEMPLATE_MEDIA_KINDS, TemplateInput, TemplateMediaKind, TemplateMessageInput } from './chat-templates.service';
import { ChatScheduledService } from './chat-scheduled.service';
import { ChatFieldsService } from './chat-fields.service';
import { ChatStagesService } from './chat-stages.service';
import { ChatBroadcastService } from './chat-broadcast.service';
import { ChatSettingsCopyService } from './chat-settings-copy.service';
import { normalizeChatResource } from './chat-resource.util';
import { TRANSLATION_LANGUAGES } from '../translation/translation.service';

// Telegram Bot API принимает от бота файлы до 50 МБ, но держать такие в памяти процесса ради
// ответа в чате незачем — 20 МБ покрывают фото, видео с телефона и документы.
const MAX_CHAT_FILE_SIZE = 20 * 1024 * 1024;

class SendChatMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  text?: string;

  // Шаблон ответа (2026-10-25) — его файл уходит вместе с текстом из поля ввода.
  @IsOptional()
  @IsString()
  templateId?: string;
}

class CreateTemplateFolderDto {
  // Ресурс чата: 'BOT' | 'BOT:<id>' | 'PERSONAL' (2026-10-25: у бота и лички свои настройки).
  @IsOptional()
  @IsString()
  @MaxLength(64)
  resource?: string;

  @IsString()
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsString()
  projectId?: string;
}

class RenameTemplateFolderDto {
  @IsString()
  @MaxLength(60)
  name!: string;
}

// multipart — все поля строками.
class TemplateFormDto {
  @IsOptional()
  @IsString()
  folderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(33)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;

  // Цепочка сообщений (2026-10-25) — JSON-массив TemplateMessageInput; файлы — поля file_<n>.
  @IsOptional()
  @IsString()
  @MaxLength(60000)
  messages?: string;
}

class CreateChatFieldDto {
  // Ресурс чата: 'BOT' | 'BOT:<id>' | 'PERSONAL' (2026-10-25: у бота и лички свои настройки).
  @IsOptional()
  @IsString()
  @MaxLength(64)
  resource?: string;

  @IsString()
  @MaxLength(60)
  name!: string;

  @IsEnum(ChatFieldType)
  type!: ChatFieldType;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  options?: string[];
}

class UpdateChatFieldDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  options?: string[];
}

class SetFieldValuesDto {
  @IsObject()
  values!: Record<string, unknown>;
}

class ScheduleMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  text?: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsString()
  sendAt!: string;
}

class OpenChatDto {
  @IsString()
  projectId!: string;

  @IsString()
  clientId!: string;

  @IsOptional()
  @IsEnum(ConversationSource)
  source?: ConversationSource;
}

class TranslateMessageDto {
  @IsIn(Object.keys(TRANSLATION_LANGUAGES))
  lang!: string;
}

class TranslateDraftDto extends TranslateMessageDto {
  @IsString()
  @MaxLength(4096)
  text!: string;
}

class CreateChatTagDto {
  // Ресурс чата: 'BOT' | 'BOT:<id>' | 'PERSONAL' (2026-10-25: у бота и лички свои настройки).
  @IsOptional()
  @IsString()
  @MaxLength(64)
  resource?: string;

  @IsString()
  @MaxLength(40)
  name!: string;

  @Matches(/^#[0-9a-fA-F]{6}$/)
  color!: string;
}

class UpdateChatTagDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  color?: string;
}

class SetConversationTagsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  tagIds!: string[];
}

class SetConversationStatusDto {
  @IsEnum(ChatStatus)
  status!: ChatStatus;
}

// folderId: null/не задан — убрать проект из папки.
class SetProjectFolderDto {
  @IsOptional()
  @IsString()
  folderId?: string | null;
}

class StageOperatorDto {
  @IsString()
  userId!: string;

  @IsInt()
  @Min(0)
  @Max(100)
  weight!: number;
}

class SaveStageDto {
  // Ресурс чата: 'BOT' | 'BOT:<id>' | 'PERSONAL' (2026-10-25: у бота и лички свои настройки).
  @IsOptional()
  @IsString()
  @MaxLength(64)
  resource?: string;

  @IsString()
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  color?: string;

  @IsEnum(ChatStageTrigger)
  trigger!: ChatStageTrigger;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(100)
  purchaseNumber?: number | null;

  @IsOptional()
  @IsString()
  tagId?: string | null;

  @IsOptional()
  @IsString()
  fieldId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  fieldValue?: string | null;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => StageOperatorDto)
  operators!: StageOperatorDto[];
}

class StageOperatorsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => StageOperatorDto)
  operators!: StageOperatorDto[];
}

class ReorderStagesDto {
  // Ресурс чата: 'BOT' | 'BOT:<id>' | 'PERSONAL' (2026-10-25: у бота и лички свои настройки).
  @IsOptional()
  @IsString()
  @MaxLength(64)
  resource?: string;

  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  ids!: string[];
}

class SetConversationStageDto {
  @IsOptional()
  @IsString()
  stageId?: string | null;
}

function parseTraffic(v?: string): 'FB' | 'TT' | 'none' | undefined {
  return v === 'FB' || v === 'TT' || v === 'none' ? v : undefined;
}

// Фильтр списка диалогов в том же виде, что и в адресе запроса списка (строки).
class BroadcastFilterDto {
  @IsString()
  projectId!: string;

  @IsOptional() @IsIn(['BOT', 'PERSONAL']) source?: 'BOT' | 'PERSONAL';
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() @MaxLength(64) assignee?: string;
  @IsOptional() @IsString() @MaxLength(32) tab?: string;
  @IsOptional() @IsString() @MaxLength(2000) tags?: string;
  @IsOptional() @IsString() @MaxLength(40) from?: string;
  @IsOptional() @IsString() @MaxLength(40) to?: string;
  @IsOptional() @IsIn(['yes', 'no', '']) purchase?: string;
  @IsOptional() @IsIn(['FB', 'TT', 'none', '']) traffic?: string;
  @IsOptional() @IsString() @MaxLength(64) field?: string;
  @IsOptional() @IsString() @MaxLength(200) fieldValue?: string;
  @IsOptional() @IsString() @MaxLength(64) stage?: string;
}

class BroadcastTargetDto {
  @ValidateNested()
  @Type(() => BroadcastFilterDto)
  filter!: BroadcastFilterDto;

  // Выбранные вручную диалоги; не задано — все по фильтру.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20000)
  @IsString({ each: true })
  conversationIds?: string[];
}

class BroadcastPartDto {
  @IsOptional() @IsString() @MaxLength(4096) text?: string;
  @IsOptional() @IsIn(['photo', 'video', 'document', 'voice', 'video_note']) mediaKind?: 'photo' | 'video' | 'document' | 'voice' | 'video_note';
  @IsOptional() @IsString() @MaxLength(300) mediaKey?: string;
  @IsOptional() @IsString() @MaxLength(200) mediaFileName?: string;
  @IsOptional() @IsString() @MaxLength(100) mediaMime?: string;
}

class BroadcastVariantDto {
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  text?: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  // Свои сообщения с файлами (2026-10-26).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => BroadcastPartDto)
  parts?: BroadcastPartDto[];
}

class CreateBroadcastDto extends BroadcastTargetDto {
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  text?: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  // Варианты сообщения — получатели получают их по очереди (2026-10-25).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => BroadcastVariantDto)
  variants?: BroadcastVariantDto[];

  // Пауза между отправками, секунды.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600)
  delayMinSec?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600)
  delayMaxSec?: number;

  @IsOptional()
  @IsString()
  sendAt?: string;
}

class CopySettingsDto {
  @IsString() fromProjectId!: string;
  @IsString() @MaxLength(64) fromResource!: string;
  @IsString() toProjectId!: string;
  @IsString() @MaxLength(64) toResource!: string;
  @IsOptional() @IsBoolean() tags?: boolean;
  @IsOptional() @IsBoolean() fields?: boolean;
  @IsOptional() @IsBoolean() stages?: boolean;
  @IsOptional() @IsBoolean() templates?: boolean;
  @IsOptional() @IsBoolean() distribution?: boolean;
}

class SetNoteDto {
  @IsString()
  @MaxLength(4000)
  note!: string;
}

class SetPinnedDto {
  @IsBoolean()
  pinned!: boolean;
}

class SetFavoriteDto {
  @IsBoolean()
  favorite!: boolean;
}

// userId: null/не задан — снять ответственного (у оператора — вернуть чат тимлиду).
class AssignConversationDto {
  @IsOptional()
  @IsString()
  userId?: string | null;
}

class BulkAssignDto extends AssignConversationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids!: string[];
}

class TransferTargetDto {
  @IsString() userId!: string;
  @IsInt() @Min(1) @Max(100) weight!: number;
}

class TransferChatsDto {
  @IsString() fromUserId!: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsIn(['BOT', 'PERSONAL']) source?: 'BOT' | 'PERSONAL';
  // Пусто — снять ответственного.
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TransferTargetDto)
  targets!: TransferTargetDto[];
}

class AutoAssignRuleDto {
  @IsString()
  userId!: string;

  @IsInt()
  @Min(0)
  @Max(100)
  weight!: number;
}

class SetAutoAssignDto {
  @IsString()
  @MaxLength(64)
  resource!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AutoAssignRuleDto)
  rules!: AutoAssignRuleDto[];
}

class SetChatAccessDto {
  @IsString()
  @MaxLength(64)
  resource!: string;

  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  userIds!: string[];
}

@Controller('chat')
export class ChatController {
  constructor(
    private chatService: ChatService,
    private chatAccess: ChatAccessService,
    private chatAssignment: ChatAssignmentService,
    private chatOrganize: ChatOrganizeService,
    private chatTemplates: ChatTemplatesService,
    private chatScheduled: ChatScheduledService,
    private chatFields: ChatFieldsService,
    private chatStages: ChatStagesService,
    private chatBroadcasts: ChatBroadcastService,
    private chatSettingsCopy: ChatSettingsCopyService,
  ) {}

  // Перенос настроек чата между проектами и ресурсами (2026-10-25).
  @Post('settings/copy')
  copySettings(@Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: CopySettingsDto) {
    return this.chatSettingsCopy.copy(
      companyId,
      user,
      { projectId: dto.fromProjectId, resource: normalizeChatResource(dto.fromResource) },
      { projectId: dto.toProjectId, resource: normalizeChatResource(dto.toResource) },
      { tags: dto.tags, fields: dto.fields, stages: dto.stages, templates: dto.templates, distribution: dto.distribution },
    );
  }

  // ---- рассылка из чата (2026-10-25) ----

  @Post('broadcasts/count')
  broadcastCount(@Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: BroadcastTargetDto) {
    return this.chatBroadcasts.count(companyId, user, this.broadcastFilters(dto.filter), dto.conversationIds);
  }

  @Post('broadcast-media')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_CHAT_FILE_SIZE } }))
  uploadBroadcastMedia(
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body('projectId') projectId: string,
    @Body('mediaKind') mediaKind: string | undefined,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.chatBroadcasts.uploadMedia(companyId, user, projectId, file, mediaKind);
  }

  @Post('broadcasts')
  createBroadcast(@Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateBroadcastDto) {
    return this.chatBroadcasts.create(companyId, user, {
      filters: this.broadcastFilters(dto.filter),
      conversationIds: dto.conversationIds,
      text: dto.text,
      templateId: dto.templateId,
      variants: dto.variants,
      delayMinSec: dto.delayMinSec,
      delayMaxSec: dto.delayMaxSec,
      filterSnapshot: { ...dto.filter },
      sendAt: dto.sendAt,
    });
  }

  @Get('projects/:projectId/broadcasts')
  listBroadcasts(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Query('source') source?: string) {
    return this.chatBroadcasts.list(projectId, companyId, user, source === 'BOT' || source === 'PERSONAL' ? source : undefined);
  }

  @Post('broadcasts/:id/cancel')
  cancelBroadcast(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.chatBroadcasts.cancel(id, companyId, user);
  }

  private broadcastFilters(f: BroadcastFilterDto): ConversationListFilters {
    return {
      projectId: f.projectId,
      source: f.source,
      search: f.search,
      assignee: f.assignee,
      tab: CHAT_TABS.includes(f.tab as ChatTab) ? (f.tab as ChatTab) : undefined,
      tagIds: f.tags ? f.tags.split(',').filter(Boolean) : undefined,
      from: f.from,
      to: f.to,
      purchase: f.purchase === 'yes' || f.purchase === 'no' ? f.purchase : undefined,
      traffic: parseTraffic(f.traffic),
      fieldId: f.field,
      fieldValue: f.fieldValue,
      stage: f.stage,
    };
  }

  // ---- папки и избранные проекты (2026-10-25) ----

  @Get('project-folders')
  listProjectFolders(@Company() companyId: string) {
    return this.chatOrganize.listFolders(companyId);
  }

  @Post('project-folders')
  createProjectFolder(@Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: RenameTemplateFolderDto) {
    return this.chatOrganize.createFolder(companyId, user, dto.name);
  }

  @Patch('project-folders/:id')
  renameProjectFolder(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: RenameTemplateFolderDto) {
    return this.chatOrganize.renameFolder(id, companyId, user, dto.name);
  }

  @Delete('project-folders/:id')
  deleteProjectFolder(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.chatOrganize.deleteFolder(id, companyId, user);
  }

  @Put('projects/:projectId/folder')
  setProjectFolder(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: SetProjectFolderDto) {
    return this.chatOrganize.setProjectFolder(projectId, dto.folderId ?? null, companyId, user);
  }

  @Put('projects/:projectId/favorite')
  setProjectFavorite(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: SetFavoriteDto) {
    return this.chatOrganize.setProjectFavorite(projectId, dto.favorite, companyId, user);
  }

  // ---- свои поля лида (2026-10-25) ----

  @Get('projects/:projectId/fields')
  listFields(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Query('resource') resource?: string) {
    return this.chatFields.list(projectId, normalizeChatResource(resource), companyId, user);
  }

  @Post('projects/:projectId/fields')
  createField(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateChatFieldDto) {
    return this.chatFields.create(projectId, normalizeChatResource(dto.resource), companyId, user, dto);
  }

  @Patch('projects/:projectId/fields/:fieldId')
  updateField(
    @Param('projectId') projectId: string,
    @Param('fieldId') fieldId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateChatFieldDto,
  ) {
    return this.chatFields.update(projectId, fieldId, companyId, user, dto);
  }

  @Delete('projects/:projectId/fields/:fieldId')
  deleteField(@Param('projectId') projectId: string, @Param('fieldId') fieldId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.chatFields.remove(projectId, fieldId, companyId, user);
  }

  @Put('conversations/:id/fields')
  setFieldValues(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: SetFieldValuesDto) {
    return this.chatFields.setValues(id, companyId, user, dto.values);
  }

  // ---- шаблоны ответов (2026-10-25) ----

  @Get('templates')
  listTemplates(@Company() companyId: string, @CurrentUser() user: AuthUser, @Query('projectId') projectId: string, @Query('resource') resource?: string) {
    return this.chatTemplates.list(projectId, normalizeChatResource(resource), companyId, user);
  }

  @Post('template-folders')
  createFolder(@Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateTemplateFolderDto) {
    return this.chatTemplates.createFolder(companyId, user, dto.name, dto.projectId || null, normalizeChatResource(dto.resource));
  }

  @Patch('template-folders/:id')
  renameFolder(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: RenameTemplateFolderDto) {
    return this.chatTemplates.renameFolder(id, companyId, user, dto.name);
  }

  @Delete('template-folders/:id')
  deleteFolder(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.chatTemplates.deleteFolder(id, companyId, user);
  }

  @Post('templates')
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_CHAT_FILE_SIZE, files: 10 } }))
  createTemplate(@Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: TemplateFormDto, @UploadedFiles() files?: Express.Multer.File[]) {
    return this.chatTemplates.createTemplate(companyId, user, this.templateInput(dto), files ?? []);
  }

  @Patch('templates/:id')
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_CHAT_FILE_SIZE, files: 10 } }))
  updateTemplate(
    @Param('id') id: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: TemplateFormDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.chatTemplates.updateTemplate(id, companyId, user, this.templateInput(dto), files ?? []);
  }

  @Get('template-messages/:id/media')
  async templateMessageMedia(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const media = await this.chatTemplates.getMessageMedia(id, companyId, user);
    res.type(media.mime);
    if (media.fileName) res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(media.fileName)}`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    media.stream.pipe(res);
  }

  @Delete('templates/:id')
  deleteTemplate(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.chatTemplates.deleteTemplate(id, companyId, user);
  }

  @Get('templates/:id/media')
  async templateMedia(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const media = await this.chatTemplates.getMedia(id, companyId, user);
    res.type(media.mime);
    if (media.fileName) res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(media.fileName)}`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    media.stream.pipe(res);
  }

  private templateInput(dto: TemplateFormDto): TemplateInput {
    let messages: TemplateMessageInput[] | undefined;
    if (dto.messages !== undefined) {
      try {
        const parsed: unknown = JSON.parse(dto.messages);
        if (!Array.isArray(parsed)) throw new Error();
        messages = parsed.map((m: Record<string, unknown>) => ({
          id: typeof m.id === 'string' ? m.id : undefined,
          text: typeof m.text === 'string' ? m.text : null,
          mediaKind: typeof m.mediaKind === 'string' && (TEMPLATE_MEDIA_KINDS as readonly string[]).includes(m.mediaKind) ? (m.mediaKind as TemplateMediaKind) : null,
          keepMedia: m.keepMedia === true,
          fileField: typeof m.fileField === 'string' ? m.fileField : undefined,
        }));
      } catch {
        throw new BadRequestException('Неверный формат сообщений шаблона');
      }
    }
    return { folderId: dto.folderId, code: dto.code, title: dto.title, messages };
  }

  // ---- отложенные сообщения (2026-10-25) ----

  @Get('conversations/:id/scheduled')
  listScheduled(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.chatScheduled.list(id, companyId, user);
  }

  @Post('conversations/:id/scheduled')
  schedule(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: ScheduleMessageDto) {
    return this.chatScheduled.create(id, companyId, user, dto);
  }

  @Delete('scheduled/:id')
  cancelScheduled(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.chatScheduled.cancel(id, companyId, user);
  }

  // Теги лидов проекта (2026-10-25).
  @Get('projects/:projectId/tags')
  listTags(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Query('resource') resource?: string) {
    return this.chatOrganize.listTags(projectId, normalizeChatResource(resource), companyId, user);
  }

  @Post('projects/:projectId/tags')
  createTag(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateChatTagDto) {
    return this.chatOrganize.createTag(projectId, normalizeChatResource(dto.resource), companyId, user, dto.name, dto.color);
  }

  @Patch('projects/:projectId/tags/:tagId')
  updateTag(
    @Param('projectId') projectId: string,
    @Param('tagId') tagId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateChatTagDto,
  ) {
    return this.chatOrganize.updateTag(projectId, tagId, companyId, user, dto);
  }

  @Delete('projects/:projectId/tags/:tagId')
  deleteTag(@Param('projectId') projectId: string, @Param('tagId') tagId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.chatOrganize.deleteTag(projectId, tagId, companyId, user);
  }

  // Счётчики вкладок. Объявлен до 'conversations/:id'.
  @Get('conversations/counts')
  counts(
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
    @Query('source') source?: string,
    @Query('assignee') assignee?: string,
    @Query('tags') tags?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('purchase') purchase?: string,
    @Query('traffic') traffic?: string,
    @Query('field') fieldId?: string,
    @Query('fieldValue') fieldValue?: string,
    @Query('stage') stage?: string,
  ) {
    return this.chatService.tabCounts(companyId, user, {
      fieldId,
      fieldValue,
      stage,
      projectId,
      source: source === 'BOT' || source === 'PERSONAL' ? source : undefined,
      assignee,
      tagIds: tags ? tags.split(',').filter(Boolean) : undefined,
      from,
      to,
      purchase: purchase === 'yes' || purchase === 'no' ? purchase : undefined,
      traffic: parseTraffic(traffic),
    });
  }

  @Put('conversations/:id/tags')
  setTags(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: SetConversationTagsDto) {
    return this.chatOrganize.setTags(id, dto.tagIds, companyId, user);
  }

  @Put('conversations/:id/status')
  setStatus(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: SetConversationStatusDto) {
    return this.chatOrganize.setStatus(id, dto.status, companyId, user);
  }

  // ---- этапы лида (2026-10-25) ----

  @Get('projects/:projectId/stages')
  listStages(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Query('resource') resource?: string) {
    return this.chatStages.list(projectId, normalizeChatResource(resource), companyId, user);
  }

  @Post('projects/:projectId/stages')
  createStage(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: SaveStageDto) {
    return this.chatStages.create(projectId, normalizeChatResource(dto.resource), companyId, user, dto);
  }

  // Объявлен до 'projects/:projectId/stages/:stageId'.
  @Put('projects/:projectId/stages-order')
  reorderStages(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: ReorderStagesDto) {
    return this.chatStages.reorder(projectId, normalizeChatResource(dto.resource), companyId, user, dto.ids);
  }

  @Put('projects/:projectId/stages/:stageId')
  updateStage(
    @Param('projectId') projectId: string,
    @Param('stageId') stageId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: SaveStageDto,
  ) {
    return this.chatStages.update(projectId, stageId, companyId, user, dto);
  }

  @Delete('projects/:projectId/stages/:stageId')
  deleteStage(@Param('projectId') projectId: string, @Param('stageId') stageId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.chatStages.remove(projectId, stageId, companyId, user);
  }

  // Полоса «Кто ведёт лидов» над чатами (2026-10-25).
  @Get('projects/:projectId/distribution')
  distribution(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Query('source') source?: string) {
    return this.chatStages.distribution(projectId, companyId, user, source === 'PERSONAL' ? 'PERSONAL' : 'BOT');
  }

  @Put('projects/:projectId/stages/:stageId/operators')
  setStageOperators(
    @Param('projectId') projectId: string,
    @Param('stageId') stageId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: StageOperatorsDto,
  ) {
    return this.chatStages.setStageOperators(projectId, stageId, companyId, user, dto.operators);
  }

  @Post('projects/:projectId/stages/:stageId/apply')
  applyStage(@Param('projectId') projectId: string, @Param('stageId') stageId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.chatStages.apply(projectId, stageId, companyId, user);
  }

  @Put('conversations/:id/stage')
  setStage(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: SetConversationStageDto) {
    return this.chatStages.setConversationStage(id, dto.stageId ?? null, companyId, user);
  }

  @Put('conversations/:id/note')
  setNote(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: SetNoteDto) {
    return this.chatOrganize.setNote(id, dto.note, companyId, user);
  }

  @Put('conversations/:id/pin')
  setPinned(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: SetPinnedDto) {
    return this.chatOrganize.setPinned(id, dto.pinned, companyId, user);
  }

  @Put('conversations/:id/favorite')
  setFavorite(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: SetFavoriteDto) {
    return this.chatOrganize.setFavorite(id, dto.favorite, companyId, user);
  }

  // Авто-распределение новых диалогов ресурса между операторами (2026-10-25).
  @Put('projects/:projectId/auto-assign')
  setAutoAssign(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: SetAutoAssignDto) {
    return this.chatAccess.setAutoAssign(projectId, companyId, user, dto.resource, dto.rules);
  }

  // Все диалоги оператора разом (2026-10-26) — в т.ч. удалённого/заблокированного.
  @Get('transfer/:userId/summary')
  transferSummary(@Param('userId') userId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.chatAssignment.transferSummary(userId, companyId, user);
  }

  @Post('transfer')
  transferAll(@Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: TransferChatsDto) {
    return this.chatAssignment.transferAll(companyId, user, dto);
  }

  // Передать диалоги оператору пачкой. Объявлен до 'conversations/:id'.
  @Post('conversations/assign')
  bulkAssign(@Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: BulkAssignDto) {
    return this.chatAssignment.assign(dto.ids, dto.userId ?? null, companyId, user);
  }

  @Put('conversations/:id/assignee')
  assign(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: AssignConversationDto) {
    return this.chatAssignment.assign([id], dto.userId ?? null, companyId, user);
  }

  // Операторы на чатах ресурсов проекта (2026-10-24) — см. ChatAccessService.
  @Get('projects/:projectId/access')
  getAccess(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.chatAccess.get(projectId, companyId, user);
  }

  @Put('projects/:projectId/access')
  setAccess(@Param('projectId') projectId: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: SetChatAccessDto) {
    return this.chatAccess.set(projectId, companyId, user, dto.resource, dto.userIds);
  }

  // Перевод (2026-10-24) — см. TranslationService.
  @Get('translate/status')
  translateStatus() {
    return this.chatService.translationStatus();
  }

  @Post('translate')
  translateDraft(@Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: TranslateDraftDto) {
    return this.chatService.translateDraft(dto.text, dto.lang, companyId, user);
  }

  @Post('messages/:id/translate')
  translateMessage(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: TranslateMessageDto) {
    return this.chatService.translateMessage(id, dto.lang, companyId, user);
  }

  @Get('conversations')
  list(
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
    @Query('source') source?: string,
    @Query('unread') unread?: string,
    @Query('search') search?: string,
    @Query('before') before?: string,
    @Query('assignee') assignee?: string,
    @Query('tab') tab?: string,
    @Query('tags') tags?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('purchase') purchase?: string,
    @Query('traffic') traffic?: string,
    @Query('field') fieldId?: string,
    @Query('fieldValue') fieldValue?: string,
    @Query('stage') stage?: string,
  ) {
    const validSource = source === 'BOT' || source === 'PERSONAL' ? source : undefined;
    return this.chatService.listConversations(companyId, user, {
      projectId,
      source: validSource,
      unread: unread === 'true',
      search,
      before,
      assignee,
      tab: CHAT_TABS.includes(tab as ChatTab) ? (tab as ChatTab) : undefined,
      tagIds: tags ? tags.split(',').filter(Boolean) : undefined,
      from,
      to,
      purchase: purchase === 'yes' || purchase === 'no' ? purchase : undefined,
      traffic: parseTraffic(traffic),
      fieldId,
      fieldValue,
      stage,
    });
  }

  @Get('projects')
  projects(@Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.chatService.listProjects(companyId, user);
  }

  @Get('unread-count')
  async unreadCount(@Company() companyId: string, @CurrentUser() user: AuthUser) {
    return { count: await this.chatService.unreadCount(companyId, user) };
  }

  // Объявлен до 'conversations/:id' — иначе 'open' ушёл бы в него как id.
  @Post('conversations/open')
  open(@Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: OpenChatDto) {
    return this.chatService.openForClient(dto.projectId, dto.clientId, companyId, user, dto.source);
  }

  @Get('conversations/:id')
  async get(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    const conversation = await this.chatService.getConversation(id, companyId, user);
    return { ...conversation, canAssign: await this.chatAssignment.canAssignIn(conversation.projectId, companyId, user) };
  }

  @Get('conversations/:id/messages')
  messages(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Query('before') before?: string) {
    return this.chatService.listMessages(id, companyId, user, before);
  }

  @Post('conversations/:id/read')
  read(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.chatService.markRead(id, companyId, user);
  }

  @Post('conversations/:id/messages')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_CHAT_FILE_SIZE } }))
  async send(
    @Param('id') id: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: SendChatMessageDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (dto.templateId && !file) return this.chatTemplates.sendTemplate(id, companyId, user, dto.templateId, dto.text);
    return this.chatService.send(id, companyId, user, { text: dto.text, file });
  }

  @Get('messages/:id/media')
  async media(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const file = await this.chatService.getMedia(id, companyId, user);
    if (file.fileName) res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    if (file.kind === 'buffer') {
      res.type(file.mimeType);
      res.send(file.buffer);
      return;
    }
    if (file.contentType) res.type(file.contentType);
    // Telegram отдаёт часть файлов как application/octet-stream — браузеру нужен тип, чтобы
    // показать картинку/видео/голосовое, а не предложить скачать.
    else res.type(file.filePath.split('.').pop() || 'bin');
    Readable.fromWeb(file.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
  }
}
