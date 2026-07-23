// Общие типы для автоворонок — используются и списком (/automations), и редактором
// (/automations/[flowId]). Зеркалит apps/api/src/modules/automations/dto/*.

export const AUTOMATION_TRIGGER_EVENTS = ['Subscribe', 'Purchase', 'Dialogue'] as const;
export type AutomationTriggerEvent = (typeof AUTOMATION_TRIGGER_EVENTS)[number];

export const TRIGGER_LABEL: Record<AutomationTriggerEvent, string> = {
  Subscribe: 'Подписался',
  Purchase: 'Купил',
  Dialogue: 'Написал в диалог',
};

export type AutomationStepType = 'DELAY' | 'SEND_PUSH' | 'CONDITION';

export interface AutomationButton {
  text: string;
  url: string;
}

export interface AutomationConditionFilter {
  hasPurchase?: boolean;
}

export interface AutomationStep {
  id: string;
  flowId: string;
  type: AutomationStepType;
  delaySeconds: number | null;
  messageText: string | null;
  buttons: AutomationButton[] | null;
  conditionFilter: AutomationConditionFilter | null;
  onSuccessStepId: string | null;
  onFailureStepId: string | null;
}

export interface AutomationFlowListItem {
  id: string;
  name: string;
  triggerEvent: string;
  isActive: boolean;
  stepCount: number;
  activeEnrollments: number;
}

export interface AutomationFlowDetail {
  id: string;
  projectId: string;
  name: string;
  triggerEvent: string;
  isActive: boolean;
  firstStepId: string | null;
  steps: AutomationStep[];
}

export interface AutomationEnrollment {
  id: string;
  status: 'ACTIVE' | 'COMPLETED' | 'EXITED' | 'FAILED';
  currentStepId: string | null;
  enrolledAt: string;
  completedAt: string | null;
  client: {
    id: string;
    tgFirstName: string | null;
    tgLastName: string | null;
    tgUsername: string | null;
    waName: string | null;
    email: string | null;
  };
}

export const ENROLLMENT_STATUS_LABEL: Record<AutomationEnrollment['status'], string> = {
  ACTIVE: 'В процессе',
  COMPLETED: 'Завершена',
  EXITED: 'Остановлена условием',
  FAILED: 'Ошибка',
};

export function clientDisplayName(client: AutomationEnrollment['client']): string {
  return (
    [client.tgFirstName, client.tgLastName].filter(Boolean).join(' ') ||
    client.tgUsername ||
    client.waName ||
    client.email ||
    client.id
  );
}
