import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AutomationStep, AutomationStepType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAutomationFlowDto, UpdateAutomationFlowDto } from './dto/automation-flow.dto';
import { CreateAutomationStepDto, UpdateAutomationStepDto } from './dto/automation-step.dto';

@Injectable()
export class AutomationsService {
  constructor(private prisma: PrismaService) {}

  async findAllForProject(projectId: string) {
    const flows = await this.prisma.automationFlow.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { steps: true } } },
    });

    return Promise.all(
      flows.map(async (flow) => ({
        ...flow,
        stepCount: flow._count.steps,
        activeEnrollments: await this.prisma.automationEnrollment.count({ where: { flowId: flow.id, status: 'ACTIVE' } }),
      })),
    );
  }

  async findOne(flowId: string, projectId: string) {
    const flow = await this.assertFlowInProject(flowId, projectId);
    const steps = await this.walkOrderedSteps(flow.id);
    return { ...flow, steps };
  }

  async create(projectId: string, companyId: string, dto: CreateAutomationFlowDto) {
    return this.prisma.automationFlow.create({
      data: { projectId, companyId, name: dto.name, triggerEvent: dto.triggerEvent },
    });
  }

  async update(flowId: string, projectId: string, dto: UpdateAutomationFlowDto) {
    await this.assertFlowInProject(flowId, projectId);
    return this.prisma.automationFlow.update({
      where: { id: flowId },
      data: { name: dto.name, triggerEvent: dto.triggerEvent, isActive: dto.isActive },
    });
  }

  // Soft-delete + остановка активных enrollments — без этого они бы зависли ACTIVE навечно
  // (advance() всё ещё нашёл бы шаг у мёртвой воронки, потому что сама проверка isActive/
  // deletedAt делается только в handleTriggerEvent на входе, не при каждом advance()).
  async remove(flowId: string, projectId: string) {
    await this.assertFlowInProject(flowId, projectId);
    await this.prisma.$transaction([
      this.prisma.automationFlow.update({ where: { id: flowId }, data: { deletedAt: new Date(), isActive: false } }),
      this.prisma.automationEnrollment.updateMany({
        where: { flowId, status: 'ACTIVE' },
        data: { status: 'EXITED', completedAt: new Date() },
      }),
    ]);
  }

  async getEnrollments(flowId: string, projectId: string) {
    await this.assertFlowInProject(flowId, projectId);
    return this.prisma.automationEnrollment.findMany({
      where: { flowId },
      orderBy: { enrolledAt: 'desc' },
      take: 200,
      include: {
        client: { select: { id: true, tgFirstName: true, tgLastName: true, tgUsername: true, waName: true, email: true } },
      },
    });
  }

  async addStep(flowId: string, projectId: string, dto: CreateAutomationStepDto) {
    const flow = await this.assertFlowInProject(flowId, projectId);
    this.assertStepContentValid(dto.type, dto);

    const ordered = await this.walkOrderedSteps(flowId);
    const last = ordered[ordered.length - 1];

    const step = await this.prisma.automationStep.create({
      data: {
        flowId,
        type: dto.type,
        delaySeconds: dto.delaySeconds,
        messageText: dto.messageText,
        buttons: dto.buttons as unknown as Prisma.InputJsonValue,
        conditionFilter: dto.conditionFilter as unknown as Prisma.InputJsonValue,
      },
    });

    if (last) {
      await this.prisma.automationStep.update({ where: { id: last.id }, data: { onSuccessStepId: step.id } });
    } else {
      await this.prisma.automationFlow.update({ where: { id: flow.id }, data: { firstStepId: step.id } });
    }

    return step;
  }

  async updateStep(flowId: string, stepId: string, projectId: string, dto: UpdateAutomationStepDto) {
    await this.assertFlowInProject(flowId, projectId);
    const step = await this.assertStepInFlow(stepId, flowId);
    this.assertStepContentValid(step.type, dto);

    return this.prisma.automationStep.update({
      where: { id: stepId },
      data: {
        delaySeconds: dto.delaySeconds,
        messageText: dto.messageText,
        buttons: dto.buttons as unknown as Prisma.InputJsonValue,
        conditionFilter: dto.conditionFilter as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async removeStep(flowId: string, stepId: string, projectId: string) {
    const flow = await this.assertFlowInProject(flowId, projectId);
    const ordered = await this.walkOrderedSteps(flowId);
    const index = ordered.findIndex((s) => s.id === stepId);
    if (index === -1) throw new NotFoundException('Шаг не найден');

    const step = ordered[index];
    const prev = index > 0 ? ordered[index - 1] : null;

    if (prev) {
      await this.prisma.automationStep.update({ where: { id: prev.id }, data: { onSuccessStepId: step.onSuccessStepId } });
    } else {
      await this.prisma.automationFlow.update({ where: { id: flow.id }, data: { firstStepId: step.onSuccessStepId } });
    }

    await this.prisma.automationStep.delete({ where: { id: stepId } });
  }

  // Переставляет шаг с соседним (prev при direction='up', next при direction='down') —
  // перевязка трёх указателей вокруг пары, вычисленных из уже упорядоченного walk. Граф всё
  // ещё линеен после операции (v1), просто в другом порядке.
  async moveStep(flowId: string, stepId: string, projectId: string, direction: 'up' | 'down') {
    const flow = await this.assertFlowInProject(flowId, projectId);
    const ordered = await this.walkOrderedSteps(flowId);
    const index = ordered.findIndex((s) => s.id === stepId);
    if (index === -1) throw new NotFoundException('Шаг не найден');

    const otherIndex = direction === 'up' ? index - 1 : index + 1;
    if (otherIndex < 0 || otherIndex >= ordered.length) return; // некуда двигать — тихо игнорируем

    const [firstIndex, secondIndex] = index < otherIndex ? [index, otherIndex] : [otherIndex, index];
    const before = ordered[firstIndex - 1] ?? null; // шаг перед парой (или null, если пара в начале)
    const a = ordered[firstIndex];
    const b = ordered[secondIndex];
    const after = b.onSuccessStepId; // что шло после пары

    // Новый порядок: before -> b -> a -> after
    if (before) {
      await this.prisma.automationStep.update({ where: { id: before.id }, data: { onSuccessStepId: b.id } });
    } else {
      await this.prisma.automationFlow.update({ where: { id: flow.id }, data: { firstStepId: b.id } });
    }
    await this.prisma.automationStep.update({ where: { id: b.id }, data: { onSuccessStepId: a.id } });
    await this.prisma.automationStep.update({ where: { id: a.id }, data: { onSuccessStepId: after } });
  }

  // Единая точка правды для порядка шагов — граф проходится от firstStepId по onSuccessStepId,
  // отдельного поля "order" в схеме нет (см. контекст плана). Счётчик итераций — защита от
  // случайного цикла (не должен возникать при текущем UI, но не полагаемся только на это).
  private async walkOrderedSteps(flowId: string): Promise<AutomationStep[]> {
    const flow = await this.prisma.automationFlow.findUniqueOrThrow({ where: { id: flowId } });
    const steps = await this.prisma.automationStep.findMany({ where: { flowId } });
    const byId = new Map(steps.map((s) => [s.id, s]));

    const ordered: AutomationStep[] = [];
    let currentId = flow.firstStepId;
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

  private async assertFlowInProject(flowId: string, projectId: string) {
    const flow = await this.prisma.automationFlow.findFirst({ where: { id: flowId, projectId, deletedAt: null } });
    if (!flow) throw new NotFoundException('Воронка не найдена');
    return flow;
  }

  private async assertStepInFlow(stepId: string, flowId: string) {
    const step = await this.prisma.automationStep.findFirst({ where: { id: stepId, flowId } });
    if (!step) throw new NotFoundException('Шаг не найден');
    return step;
  }

  // SEND_PUSH намеренно не требует непустого messageText здесь (баг-репорт пользователя
  // 2026-07-15: добавление шага падало 400-кой, потому что шаг создаётся пустым, а текст
  // заполняется потом в панели редактирования — тот же принцип, что и у BotScenario.messageText,
  // которое тоже @IsOptional() без проверки на непустоту).
  private assertStepContentValid(type: AutomationStepType, dto: CreateAutomationStepDto | UpdateAutomationStepDto): void {
    if (type === 'DELAY' && dto.delaySeconds == null) {
      throw new BadRequestException('Для шага задержки нужно указать длительность');
    }
    if (type === 'CONDITION' && dto.conditionFilter?.hasPurchase == null) {
      throw new BadRequestException('Для шага условия нужно выбрать проверку');
    }
  }
}
