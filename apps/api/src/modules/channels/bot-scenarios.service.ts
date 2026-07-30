import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AutomationEnrollmentStatus, BotScenario, BotScenarioStep, Prisma } from '@prisma/client';
import type { Readable } from 'stream';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../prisma/prisma.service';
import { ChannelsService } from './channels.service';
import { ChannelMediaService } from './channel-media.service';
import { VideoProcessingService } from './video-processing.service';
import {
  CreateBotScenarioDto,
  UpdateBotScenarioDto,
  assertValidCommand,
} from './dto/bot-scenario.dto';
import { CreateScenarioElementDto, UpdateScenarioElementDto } from './dto/bot-scenario-element.dto';
import { ScenarioStatsQueryDto } from './dto/bot-scenario-stats.dto';
import { UpdateScenarioAbTestWeightsDto } from './dto/scenario-ab-test.dto';

// "Элемент" сценария глазами API — см. подробный комментарий в dto/bot-scenario-element.dto.ts.
// headStepId/tailStepId — внутренние (не отдаются наружу), нужны только moveElement, чтобы
// переставлять группу из 1-2 реальных BotScenarioStep как одно целое.
export interface ScenarioElement {
  id: string;
  delaySeconds: number;
  messageText: string | null;
  messageMedia: Prisma.JsonValue;
  buttons: Prisma.JsonValue;
}

interface StepGroup extends ScenarioElement {
  headStepId: string;
  tailStepId: string;
}

// Тип содержимого элемента — на бэкенде отдельно не хранится (см. тот же приём на фронтенде,
// apps/web/src/lib/scenarios.ts:deriveContentType), выводится из messageMedia. Нужен здесь для
// превью-последовательности на карточке списка (запрос пользователя 2026-07-25: "какие там шаги
// (кружок -> текст -> аудио)").
export type ElementContentType = 'TEXT' | 'PHOTO' | 'VIDEO' | 'ALBUM' | 'VIDEO_NOTE' | 'VOICE';

export interface RunStatusCounts {
  active: number;
  completed: number;
  exited: number;
  failed: number;
}

const EMPTY_RUN_COUNTS: RunStatusCounts = { active: 0, completed: 0, exited: 0, failed: 0 };
const RUN_STATUS_TO_COUNT_KEY: Record<AutomationEnrollmentStatus, keyof RunStatusCounts> = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  EXITED: 'exited',
  FAILED: 'failed',
};

const MAX_STEP_MEDIA_SIZE = 50 * 1024 * 1024;
const MAX_VIDEO_NOTE_SIZE = 12 * 1024 * 1024; // ограничение самого Bot API у sendVideoNote
const DEFAULT_STATS_PAGE_SIZE = 50;

// Статистика одного варианта A/B-теста сценариев (запрос пользователя 2026-07-25) — все метрики,
// кроме received/resolvedCount, это СНИМОК ТЕКУЩЕГО состояния клиентов, получивших вариант, а
// не подтверждение прочтения конкретного сообщения (в проекте нет трекинга ответа на сообщения
// бота) — честный прокси, не точная конверсия. resolvedCount — знаменатель для процентов
// (получатели без реальной строки Client, холодные контакты, не могут иметь эти статусы вообще).
export interface AbTestVariantStat {
  scenarioId: string;
  isAbTestVariant: boolean;
  isActive: boolean;
  weight: number;
  received: number;
  resolvedCount: number;
  subscribed: number;
  subscribedPct: number;
  unsubscribed: number;
  unsubscribedPct: number;
  dialogued: number;
  dialoguedPct: number;
  activated: number;
  activatedPct: number;
  blocked: number;
  blockedPct: number;
  purchased: number;
  purchasedPct: number;
}

@Injectable()
export class BotScenariosService {
  constructor(
    private prisma: PrismaService,
    private channelsService: ChannelsService,
    private channelMedia: ChannelMediaService,
    private videoProcessing: VideoProcessingService,
    private config: ConfigService,
  ) {}

  async findAll(
    channelId: string,
    companyId: string,
  ): Promise<
    Array<
      BotScenario & {
        stepCount: number;
        runCount: number;
        runCounts: RunStatusCounts;
        elementTypes: ElementContentType[];
        abTestEndedAt: Date | null;
      }
    >
  > {
    await this.channelsService.findOne(channelId, companyId);
    // isAbTestVariant: false — варианты A/B-теста (запрос пользователя 2026-07-25) не
    // показываются отдельными карточками в списке, только через секцию A/B у "основного"
    // сценария (см. abTestGroupId в ответе ниже) — у них служебный command, отдельная карточка
    // выглядела бы бессмысленно. abTestGroup.endedAt — завершённые тесты фронтенд не должен
    // показывать как живые (запрос пользователя 2026-07-25, "завершенные тесты не показывай
    // так, на отдельной странице лучше" — тот же принцип, что уже есть у истории A/B лендингов).
    const scenarios = await this.prisma.botScenario.findMany({
      where: { channelId, companyId, deletedAt: null, isAbTestVariant: false },
      orderBy: [{ triggerType: 'asc' }, { command: 'asc' }],
      include: { _count: { select: { steps: true } }, abTestGroup: { select: { endedAt: true } } },
    });

    // Один groupBy на все сценарии сразу вместо N отдельных count() (было — только по ACTIVE)
    // — запрос пользователя 2026-07-25: карточка теперь показывает разбивку по всем 4 статусам
    // (успешно/в ожидании/прервано/ошибка), не только "сколько сейчас в процессе".
    const grouped = await this.prisma.botScenarioRun.groupBy({
      by: ['scenarioId', 'status'],
      where: { scenarioId: { in: scenarios.map((s) => s.id) } },
      _count: true,
    });
    const countsByScenario = new Map<string, RunStatusCounts>();
    for (const row of grouped) {
      const counts = countsByScenario.get(row.scenarioId) ?? { ...EMPTY_RUN_COUNTS };
      counts[RUN_STATUS_TO_COUNT_KEY[row.status]] = row._count;
      countsByScenario.set(row.scenarioId, counts);
    }

    return Promise.all(
      scenarios.map(async (s) => {
        const { abTestGroup, ...scenario } = s;
        const ordered = await this.walkOrderedSteps(s.id);
        const elementTypes = this.groupSteps(ordered).map((g) => this.deriveContentType(g.messageMedia));
        const runCounts = countsByScenario.get(s.id) ?? EMPTY_RUN_COUNTS;
        return {
          ...scenario,
          stepCount: s._count.steps,
          runCount: runCounts.active,
          runCounts,
          elementTypes,
          abTestEndedAt: abTestGroup?.endedAt ?? null,
        };
      }),
    );
  }

  // Список ВСЕХ A/B-групп сценариев канала (включая завершённые) — запрос пользователя
  // 2026-07-25: "завершенные тесты не показывай так, на отдельной странице лучше", тот же
  // принцип, что уже есть у истории A/B лендингов (/landings/history,
  // GET /projects/:projectId/ab-test-groups). primaryScenarioId/triggerType/command — от
  // "основного" сценария группы, нужны фронтенду для заголовка карточки в истории.
  async listAbTestGroups(channelId: string, companyId: string) {
    await this.channelsService.findOne(channelId, companyId);
    const groups = await this.prisma.scenarioAbTestGroup.findMany({
      where: { channelId, companyId },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      groups.map(async (g) => {
        const snapshot = g.resultsSnapshot as unknown as AbTestVariantStat[] | null;
        // Завершённые группы (endAbTest уже обнулил abTestGroupId у всех сценариев, см.
        // комментарий там) резолвим по id основного сценария, сохранённому В САМОМ снапшоте —
        // живой FK-поиск по abTestGroupId ничего бы уже не нашёл. Для ещё не завершённых
        // (снапшота нет) — обычный живой поиск.
        const primaryId = snapshot?.find((v) => !v.isAbTestVariant)?.scenarioId;
        const primary = primaryId
          ? await this.prisma.botScenario.findUnique({ where: { id: primaryId }, select: { id: true, triggerType: true, command: true } })
          : await this.prisma.botScenario.findFirst({
              where: { abTestGroupId: g.id, isAbTestVariant: false },
              select: { id: true, triggerType: true, command: true },
            });
        return {
          id: g.id,
          createdAt: g.createdAt,
          endedAt: g.endedAt,
          resultsSnapshot: snapshot,
          primaryScenarioId: primary?.id ?? null,
          triggerType: primary?.triggerType ?? null,
          command: primary?.command ?? null,
        };
      }),
    );
  }

  // Агрегированная статистика + постраничный список клиентов, прошедших через сценарий (запрос
  // пользователя 2026-07-25: "статистика сценария... список клиентов которые прошли, в
  // ожидании, ошибка + дата отправки"). clientId — мягкая ссылка (как buyerId/pixelId в других
  // местах проекта, см. схему), поэтому имя резолвится отдельным запросом, не через include.
  async getStats(id: string, companyId: string, query: ScenarioStatsQueryDto) {
    const scenario = await this.findOne(id, companyId);

    const grouped = await this.prisma.botScenarioRun.groupBy({
      by: ['status'],
      where: { scenarioId: scenario.id },
      _count: true,
    });
    const counts = { ...EMPTY_RUN_COUNTS };
    for (const row of grouped) counts[RUN_STATUS_TO_COUNT_KEY[row.status]] = row._count;

    const where: Prisma.BotScenarioRunWhereInput = { scenarioId: scenario.id, ...(query.status ? { status: query.status } : {}) };
    const limit = query.limit || DEFAULT_STATS_PAGE_SIZE;
    const offset = query.offset || 0;

    const [runs, total] = await Promise.all([
      this.prisma.botScenarioRun.findMany({ where, orderBy: { startedAt: 'desc' }, take: limit, skip: offset }),
      this.prisma.botScenarioRun.count({ where }),
    ]);

    const clientIds = runs.map((r) => r.clientId).filter((id): id is string => !!id);
    const clients = clientIds.length
      ? await this.prisma.client.findMany({
          where: { id: { in: clientIds } },
          select: { id: true, tgUsername: true, tgFirstName: true, tgLastName: true },
        })
      : [];
    const clientById = new Map(clients.map((c) => [c.id, c]));

    return {
      counts,
      total,
      runs: runs.map((r) => {
        const client = r.clientId ? clientById.get(r.clientId) : undefined;
        const clientName = client ? [client.tgFirstName, client.tgLastName].filter(Boolean).join(' ') || client.tgUsername || null : null;
        return {
          id: r.id,
          tgUserId: r.tgUserId,
          clientId: r.clientId,
          clientName,
          clientUsername: client?.tgUsername ?? null,
          status: r.status,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
        };
      }),
    };
  }

  private deriveContentType(messageMedia: Prisma.JsonValue): ElementContentType {
    const media = (messageMedia as { type?: string }[] | null) || [];
    if (!Array.isArray(media) || media.length === 0) return 'TEXT';
    if (media.length > 1) return 'ALBUM';
    const t = media[0]?.type;
    if (t === 'video_note') return 'VIDEO_NOTE';
    if (t === 'voice') return 'VOICE';
    if (t === 'video') return 'VIDEO';
    return 'PHOTO';
  }

  // Создаётся пустым (только триггер) — содержимое (шаги) добавляется потом на странице
  // редактора, тот же паттерн, что уже был у AutomationFlow (запрос пользователя 2026-07-22).
  async create(channelId: string, companyId: string, dto: CreateBotScenarioDto): Promise<BotScenario> {
    await this.channelsService.findOne(channelId, companyId);
    const command = assertValidCommand(dto.triggerType, dto.command);

    try {
      return await this.prisma.botScenario.create({
        data: { channelId, companyId, triggerType: dto.triggerType, command, isActive: dto.isActive ?? true },
      });
    } catch (error) {
      if ((error as Prisma.PrismaClientKnownRequestError).code === 'P2002') {
        throw new BadRequestException(
          dto.triggerType === 'COMMAND' ? 'Такая команда уже настроена' : 'Такой сценарий для этого канала уже существует — отредактируйте его',
        );
      }
      throw error;
    }
  }

  async update(id: string, companyId: string, dto: UpdateBotScenarioDto): Promise<BotScenario> {
    await this.findOne(id, companyId);
    return this.prisma.botScenario.update({ where: { id }, data: { isActive: dto.isActive } });
  }

  async remove(id: string, companyId: string): Promise<void> {
    await this.findOne(id, companyId);
    await this.prisma.$transaction([
      this.prisma.botScenario.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } }),
      this.prisma.botScenarioRun.updateMany({
        where: { scenarioId: id, status: 'ACTIVE' },
        data: { status: 'EXITED', completedAt: new Date() },
      }),
    ]);
  }

  async findOne(id: string, companyId: string): Promise<BotScenario> {
    const scenario = await this.prisma.botScenario.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!scenario) throw new NotFoundException('Сценарий не найден');
    return scenario;
  }

  async findOneWithElements(id: string, companyId: string) {
    const scenario = await this.findOne(id, companyId);
    const ordered = await this.walkOrderedSteps(scenario.id);
    const elements: ScenarioElement[] = this.groupSteps(ordered).map(({ headStepId, tailStepId, ...el }) => el);
    return { ...scenario, elements };
  }

  // --- A/B-тест (запрос пользователя 2026-07-25, "как мы сделали для груп лэндингов") — тот же
  // принцип, что AbTestGroup у лендингов (endedAt+resultsSnapshot вместо удаления при остановке),
  // но группа скрыта от списка сценариев целиком: варианты не показываются отдельными карточками
  // (findAll фильтрует isAbTestVariant:false), доступны только через "основной" сценарий. ---

  // Первый вызов создаёт группу и сразу выставляет вес 50/50 (тот же UX, что у "добавить вариант"
  // лендинга) — дальше веса можно поменять через updateAbTestWeights.
  async addAbTestVariant(scenarioId: string, companyId: string): Promise<BotScenario> {
    const primary = await this.findOne(scenarioId, companyId);
    if (primary.isAbTestVariant) {
      throw new BadRequestException('У варианта A/B-теста нельзя создать свой собственный вариант — откройте основной сценарий');
    }

    let groupId = primary.abTestGroupId;
    if (!groupId) {
      const group = await this.prisma.scenarioAbTestGroup.create({ data: { channelId: primary.channelId, companyId } });
      groupId = group.id;
      await this.prisma.botScenario.update({ where: { id: primary.id }, data: { abTestGroupId: groupId, abTestWeight: 50 } });
    }

    return this.prisma.botScenario.create({
      data: {
        channelId: primary.channelId,
        companyId,
        triggerType: primary.triggerType,
        // Служебное уникальное значение (см. комментарий у BotScenario.command в schema.prisma)
        // — реальная команда/триггер варианта берётся из группы (primary), не из этого поля.
        command: `__ab_${nanoid(12)}`,
        isActive: true,
        isAbTestVariant: true,
        abTestGroupId: groupId,
        abTestWeight: 50,
      },
    });
  }

  async updateAbTestWeights(scenarioId: string, companyId: string, dto: UpdateScenarioAbTestWeightsDto): Promise<void> {
    const scenario = await this.findOne(scenarioId, companyId);
    if (!scenario.abTestGroupId) throw new BadRequestException('У этого сценария нет A/B-теста');

    const members = await this.prisma.botScenario.findMany({ where: { abTestGroupId: scenario.abTestGroupId, deletedAt: null } });
    const memberIds = new Set(members.map((m) => m.id));
    const updates = dto.weights.filter((w) => memberIds.has(w.scenarioId));
    if (updates.length === 0) throw new BadRequestException('Не переданы веса для сценариев этой группы');

    await this.prisma.$transaction(
      updates.map((w) => this.prisma.botScenario.update({ where: { id: w.scenarioId }, data: { abTestWeight: w.weight } })),
    );
  }

  // Баг-репорт пользователя 2026-07-25: "после завершения теста в карточке сценария всё ещё
  // пишет A/B, а я не могу сделать ещё A/B тест" — раньше останавливали ТОЛЬКО группу
  // (endedAt+resultsSnapshot), а abTestGroupId/abTestWeight на самих сценариях никогда не
  // сбрасывались, так что: (1) карточка навсегда думала, что тест ещё живой (только endedAt
  // отличал состояния, а список сценариев кэшировался отдельно и не всегда успевал
  // перезапроситься), и (2) AbTestSection навсегда попадал в ветку "тест уже есть", там нет
  // кнопки "начать новый". Теперь очищаем связь у ВСЕХ участников группы (основной + варианты)
  // сразу при остановке — ровно тот же приём, что LandingsService.stopAbTestGroup уже делает
  // для лендингов (Landing.abTestGroupId/abTestWeight → null). Сама группа и её resultsSnapshot
  // остаются навсегда — история не теряется, просто сценарии перестают на неё ссылаться.
  async endAbTest(scenarioId: string, companyId: string): Promise<void> {
    const scenario = await this.findOne(scenarioId, companyId);
    if (!scenario.abTestGroupId) throw new BadRequestException('У этого сценария нет A/B-теста');

    const groupId = scenario.abTestGroupId;
    const variants = await this.computeAbTestStats(groupId);

    await this.prisma.$transaction([
      this.prisma.botScenario.updateMany({ where: { abTestGroupId: groupId }, data: { abTestGroupId: null, abTestWeight: null } }),
      this.prisma.scenarioAbTestGroup.update({
        where: { id: groupId },
        data: { endedAt: new Date(), resultsSnapshot: variants as unknown as Prisma.InputJsonValue },
      }),
    ]);
  }

  async getAbTestStats(scenarioId: string, companyId: string): Promise<{ groupId: string; endedAt: Date | null; variants: AbTestVariantStat[] }> {
    const scenario = await this.findOne(scenarioId, companyId);
    if (!scenario.abTestGroupId) throw new BadRequestException('У этого сценария нет A/B-теста');

    const group = await this.prisma.scenarioAbTestGroup.findUniqueOrThrow({ where: { id: scenario.abTestGroupId } });
    if (group.endedAt && group.resultsSnapshot) {
      return { groupId: group.id, endedAt: group.endedAt, variants: group.resultsSnapshot as unknown as AbTestVariantStat[] };
    }

    const variants = await this.computeAbTestStats(group.id);
    return { groupId: group.id, endedAt: null, variants };
  }

  // Живой расчёт метрик каждого варианта группы — за всё время жизни варианта (не окно теста),
  // тот же принцип, что и у live-статистики лендинга (в отличие от resultsSnapshot, который
  // застывает на момент остановки). Метрики клиента — снимок ТЕКУЩЕГО состояния (см. комментарий
  // у AbTestVariantStat), не историческая последовательность.
  private async computeAbTestStats(groupId: string): Promise<AbTestVariantStat[]> {
    const members = await this.prisma.botScenario.findMany({
      where: { abTestGroupId: groupId, deletedAt: null },
      orderBy: [{ isAbTestVariant: 'asc' }, { createdAt: 'asc' }],
    });

    return Promise.all(
      members.map(async (m) => {
        const runs = await this.prisma.botScenarioRun.findMany({ where: { scenarioId: m.id }, select: { clientId: true } });
        const clientIds = [...new Set(runs.map((r) => r.clientId).filter((id): id is string => !!id))];
        const received = runs.length;
        const resolvedCount = clientIds.length;

        let subscribed = 0;
        let unsubscribed = 0;
        let dialogued = 0;
        let activated = 0;
        let blocked = 0;
        let purchased = 0;
        if (resolvedCount > 0) {
          [subscribed, unsubscribed, dialogued, activated, blocked, purchased] = await Promise.all([
            this.prisma.client.count({ where: { id: { in: clientIds }, isSubscribed: true } }),
            this.prisma.client.count({ where: { id: { in: clientIds }, unsubscribedAt: { not: null } } }),
            this.prisma.client.count({ where: { id: { in: clientIds }, firstDialogueAt: { not: null } } }),
            this.prisma.client.count({ where: { id: { in: clientIds }, botActivatedAt: { not: null } } }),
            this.prisma.client.count({ where: { id: { in: clientIds }, isBotActive: false } }),
            this.prisma.client.count({ where: { id: { in: clientIds }, hasPurchase: true } }),
          ]);
        }

        const pct = (n: number) => (resolvedCount > 0 ? Math.round((n / resolvedCount) * 1000) / 10 : 0);

        return {
          scenarioId: m.id,
          isAbTestVariant: m.isAbTestVariant,
          isActive: m.isActive,
          weight: m.abTestWeight ?? 0,
          received,
          resolvedCount,
          subscribed,
          subscribedPct: pct(subscribed),
          unsubscribed,
          unsubscribedPct: pct(unsubscribed),
          dialogued,
          dialoguedPct: pct(dialogued),
          activated,
          activatedPct: pct(activated),
          blocked,
          blockedPct: pct(blocked),
          purchased,
          purchasedPct: pct(purchased),
        };
      }),
    );
  }

  // --- Элементы (редизайн 2026-07-25 — см. dto/bot-scenario-element.dto.ts). Каждый элемент —
  // один SEND_MESSAGE BotScenarioStep, опционально с одним DELAY-шагом прямо перед ним в
  // цепочке. groupSteps ниже — единственное место, которое знает про эту пару-под-капотом;
  // остальной код работает с элементами как с одной сущностью. ---

  async addElement(scenarioId: string, companyId: string, dto: CreateScenarioElementDto): Promise<ScenarioElement> {
    const scenario = await this.findOne(scenarioId, companyId);
    this.assertElementContentValid(dto);

    const ordered = await this.walkOrderedSteps(scenarioId);
    const last = ordered[ordered.length - 1];

    const sendStep = await this.prisma.botScenarioStep.create({
      data: {
        scenarioId,
        type: 'SEND_MESSAGE',
        messageText: dto.messageText,
        messageMedia: dto.messageMedia ? (dto.messageMedia as unknown as Prisma.InputJsonValue) : undefined,
        buttons: dto.buttons ? (dto.buttons as unknown as Prisma.InputJsonValue) : undefined,
      },
    });

    let headStepId = sendStep.id;
    if (dto.delaySeconds && dto.delaySeconds > 0) {
      const delayStep = await this.prisma.botScenarioStep.create({
        data: { scenarioId, type: 'DELAY', delaySeconds: dto.delaySeconds, onSuccessStepId: sendStep.id },
      });
      headStepId = delayStep.id;
    }

    if (last) {
      await this.prisma.botScenarioStep.update({ where: { id: last.id }, data: { onSuccessStepId: headStepId } });
    } else {
      await this.prisma.botScenario.update({ where: { id: scenario.id }, data: { firstStepId: headStepId } });
    }

    return {
      id: sendStep.id,
      delaySeconds: dto.delaySeconds || 0,
      messageText: sendStep.messageText,
      messageMedia: sendStep.messageMedia,
      buttons: sendStep.buttons,
    };
  }

  async updateElement(scenarioId: string, elementId: string, companyId: string, dto: UpdateScenarioElementDto): Promise<ScenarioElement> {
    await this.findOne(scenarioId, companyId);
    const sendStep = await this.assertStepInScenario(elementId, scenarioId);
    if (sendStep.type !== 'SEND_MESSAGE') throw new NotFoundException('Элемент не найден');
    this.assertElementContentValid(dto);

    const ordered = await this.walkOrderedSteps(scenarioId);
    const idx = ordered.findIndex((s) => s.id === elementId);
    const prev = idx > 0 ? ordered[idx - 1] : null;
    const existingDelayStep = prev && prev.type === 'DELAY' && prev.onSuccessStepId === elementId ? prev : null;
    const beforeDelay = existingDelayStep && idx > 1 ? ordered[idx - 2] : null;

    const newDelay = dto.delaySeconds || 0;

    if (newDelay > 0 && existingDelayStep) {
      await this.prisma.botScenarioStep.update({ where: { id: existingDelayStep.id }, data: { delaySeconds: newDelay } });
    } else if (newDelay > 0 && !existingDelayStep) {
      const delayStep = await this.prisma.botScenarioStep.create({
        data: { scenarioId, type: 'DELAY', delaySeconds: newDelay, onSuccessStepId: elementId },
      });
      if (prev) {
        await this.prisma.botScenarioStep.update({ where: { id: prev.id }, data: { onSuccessStepId: delayStep.id } });
      } else {
        await this.prisma.botScenario.update({ where: { id: scenarioId }, data: { firstStepId: delayStep.id } });
      }
    } else if (newDelay <= 0 && existingDelayStep) {
      if (beforeDelay) {
        await this.prisma.botScenarioStep.update({ where: { id: beforeDelay.id }, data: { onSuccessStepId: elementId } });
      } else {
        await this.prisma.botScenario.update({ where: { id: scenarioId }, data: { firstStepId: elementId } });
      }
      await this.prisma.botScenarioStep.delete({ where: { id: existingDelayStep.id } });
    }

    const updated = await this.prisma.botScenarioStep.update({
      where: { id: elementId },
      data: {
        messageText: dto.messageText,
        messageMedia: dto.messageMedia !== undefined ? (dto.messageMedia as unknown as Prisma.InputJsonValue) : undefined,
        buttons: dto.buttons !== undefined ? (dto.buttons as unknown as Prisma.InputJsonValue) : undefined,
      },
    });

    return {
      id: updated.id,
      delaySeconds: newDelay,
      messageText: updated.messageText,
      messageMedia: updated.messageMedia,
      buttons: updated.buttons,
    };
  }

  async removeElement(scenarioId: string, elementId: string, companyId: string): Promise<void> {
    const scenario = await this.findOne(scenarioId, companyId);
    const ordered = await this.walkOrderedSteps(scenarioId);
    const idx = ordered.findIndex((s) => s.id === elementId);
    if (idx === -1) throw new NotFoundException('Элемент не найден');

    const sendStep = ordered[idx];
    const prevInChain = idx > 0 ? ordered[idx - 1] : null;
    const delayStep = prevInChain && prevInChain.type === 'DELAY' && prevInChain.onSuccessStepId === elementId ? prevInChain : null;
    const beforeGroup = delayStep ? (idx > 1 ? ordered[idx - 2] : null) : prevInChain;
    const nextStepId = sendStep.onSuccessStepId;

    if (beforeGroup) {
      await this.prisma.botScenarioStep.update({ where: { id: beforeGroup.id }, data: { onSuccessStepId: nextStepId } });
    } else {
      await this.prisma.botScenario.update({ where: { id: scenario.id }, data: { firstStepId: nextStepId } });
    }

    await this.prisma.botScenarioStep.delete({ where: { id: sendStep.id } });
    if (delayStep) await this.prisma.botScenarioStep.delete({ where: { id: delayStep.id } });
  }

  // Перестановка целой группы (delay?+message) как единицы — тот же алгоритм, что раньше
  // переставлял одиночные шаги (swap с соседом через head/tail), только теперь head/tail
  // группы может быть двумя разными реальными шагами вместо одного.
  async moveElement(scenarioId: string, elementId: string, companyId: string, direction: 'up' | 'down'): Promise<void> {
    const scenario = await this.findOne(scenarioId, companyId);
    const ordered = await this.walkOrderedSteps(scenarioId);
    const groups = this.groupSteps(ordered);

    const index = groups.findIndex((g) => g.id === elementId);
    if (index === -1) throw new NotFoundException('Элемент не найден');

    const otherIndex = direction === 'up' ? index - 1 : index + 1;
    if (otherIndex < 0 || otherIndex >= groups.length) return;

    const [firstIdx, secondIdx] = index < otherIndex ? [index, otherIndex] : [otherIndex, index];
    const before = firstIdx > 0 ? groups[firstIdx - 1] : null;
    const a = groups[firstIdx];
    const b = groups[secondIdx];

    const bTail = await this.prisma.botScenarioStep.findUniqueOrThrow({ where: { id: b.tailStepId } });
    const afterBId = bTail.onSuccessStepId;

    if (before) {
      await this.prisma.botScenarioStep.update({ where: { id: before.tailStepId }, data: { onSuccessStepId: b.headStepId } });
    } else {
      await this.prisma.botScenario.update({ where: { id: scenario.id }, data: { firstStepId: b.headStepId } });
    }
    await this.prisma.botScenarioStep.update({ where: { id: b.tailStepId }, data: { onSuccessStepId: a.headStepId } });
    await this.prisma.botScenarioStep.update({ where: { id: a.tailStepId }, data: { onSuccessStepId: afterBId } });
  }

  private async walkOrderedSteps(scenarioId: string): Promise<BotScenarioStep[]> {
    const scenario = await this.prisma.botScenario.findUniqueOrThrow({ where: { id: scenarioId } });
    const steps = await this.prisma.botScenarioStep.findMany({ where: { scenarioId } });
    const byId = new Map(steps.map((s) => [s.id, s]));

    const ordered: BotScenarioStep[] = [];
    let currentId = scenario.firstStepId;
    let guard = 0;
    while (currentId && guard < steps.length + 1) {
      const step = byId.get(currentId);
      if (!step) break;
      ordered.push(step);
      currentId = step.onSuccessStepId;
      guard++;
    }

    return ordered;
  }

  // Группирует плоский упорядоченный список реальных шагов в элементы — DELAY, за которым СРАЗУ
  // идёт SEND_MESSAGE (и DELAY.onSuccessStepId указывает именно на него), считается одним
  // элементом с delaySeconds > 0; одиночный SEND_MESSAGE — элементом с delaySeconds = 0. Любой
  // другой шаг (устаревший CONDITION или "осиротевший" DELAY без последующего сообщения — из
  // старого редактора, где условие/задержка добавлялись отдельно) проходит как непрозрачный
  // элемент-заглушка без контента, чтобы не уронить группировку на существующих данных —
  // движок (BotScenarioEngineService) его всё равно honestly выполнит, просто новый редактор
  // такие элементы не умеет показать содержательно.
  private groupSteps(ordered: BotScenarioStep[]): StepGroup[] {
    const groups: StepGroup[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const step = ordered[i];
      if (step.type === 'SEND_MESSAGE') {
        const prev = ordered[i - 1];
        if (prev && prev.type === 'DELAY' && prev.onSuccessStepId === step.id) continue; // уже добавлен ниже
        groups.push({
          id: step.id,
          headStepId: step.id,
          tailStepId: step.id,
          delaySeconds: 0,
          messageText: step.messageText,
          messageMedia: step.messageMedia,
          buttons: step.buttons,
        });
      } else if (step.type === 'DELAY') {
        const next = ordered[i + 1];
        if (next && next.type === 'SEND_MESSAGE' && step.onSuccessStepId === next.id) {
          groups.push({
            id: next.id,
            headStepId: step.id,
            tailStepId: next.id,
            delaySeconds: step.delaySeconds || 0,
            messageText: next.messageText,
            messageMedia: next.messageMedia,
            buttons: next.buttons,
          });
        } else {
          groups.push({ id: step.id, headStepId: step.id, tailStepId: step.id, delaySeconds: step.delaySeconds || 0, messageText: null, messageMedia: null, buttons: null });
        }
      } else {
        groups.push({ id: step.id, headStepId: step.id, tailStepId: step.id, delaySeconds: 0, messageText: null, messageMedia: null, buttons: null });
      }
    }
    return groups;
  }

  private async assertStepInScenario(stepId: string, scenarioId: string): Promise<BotScenarioStep> {
    const step = await this.prisma.botScenarioStep.findFirst({ where: { id: stepId, scenarioId } });
    if (!step) throw new NotFoundException('Элемент не найден');
    return step;
  }

  private assertElementContentValid(dto: CreateScenarioElementDto | UpdateScenarioElementDto): void {
    if (dto.messageMedia && dto.messageMedia.length > 1 && dto.messageMedia.some((m) => m.type === 'video_note')) {
      throw new BadRequestException('Кружок нельзя отправить вместе с другими медиафайлами в одном сообщении');
    }
  }

  // --- Медиа для шага сообщения (запрос пользователя 2026-07-22, "до 10 других медиа") — тот
  // же плоский-ключ паттерн, что PushesService.uploadMedia/streamMedia, ключ ещё не привязан
  // к конкретному шагу на момент загрузки (шаг может ещё не существовать, форма собирает
  // messageMedia в состоянии до сохранения — тот же порядок, что в форме создания пуша). ---

  async uploadStepMedia(companyId: string, channelId: string, mediaType: string, file?: Express.Multer.File): Promise<{ url: string; key: string }> {
    await this.channelsService.findOne(channelId, companyId);
    if (!file) throw new BadRequestException('Файл не передан');
    if (file.size > MAX_STEP_MEDIA_SIZE) throw new BadRequestException('Файл слишком большой (макс. 50MB)');

    let buffer = file.buffer;
    if (mediaType === 'video_note') {
      buffer = await this.videoProcessing.ensureSquareVideoNote(buffer);
      if (buffer.length > MAX_VIDEO_NOTE_SIZE) {
        throw new BadRequestException('Видео для кружка слишком большое даже после обрезки (макс. 12MB у Telegram)');
      }
    }

    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `scenario-step-media_${nanoid(16)}-${safeName}`;
    await this.channelMedia.uploadBuffer(key, buffer, file.mimetype);

    const apiUrl = this.config.get<string>('API_URL');
    return { url: `${apiUrl}/api/v1/scenario-step-media/${key}`, key };
  }

  async streamStepMedia(key: string): Promise<{ stream: Readable; contentType?: string; size?: number }> {
    const [stream, stat] = await Promise.all([this.channelMedia.getObjectStream(key), this.channelMedia.getStat(key)]);
    return { stream, contentType: stat?.contentType, size: stat?.size };
  }
}
