import { api } from '@/lib/api';

// Воронка проекта (запрос пользователя 2026-10-24) — см. apps/api/src/common/funnel-config.ts.

export type LeadBotStart = 'ALL' | 'TRACKED' | 'LINKS' | 'OFF';
export type LeadChannelJoin = 'ANY' | 'OFF';

export interface FunnelConfig {
  leadBotStart: LeadBotStart;
  leadChannelJoin: LeadChannelJoin;
  leadPersonalMessage: boolean;
  dialogueBotMessage: boolean;
  dialoguePersonalMessage: boolean;
}

export interface ProjectFunnel {
  config: FunnelConfig;
  isCustom: boolean;
  defaults: FunnelConfig;
  leadLabel: string;
  connections: {
    type: string | null;
    mode: string | null;
    hasBot: boolean;
    hasChannel: boolean;
    hasPersonal: boolean;
  };
}

export const LEAD_BOT_START_LABEL: Record<LeadBotStart, string> = {
  ALL: 'Каждый, кто нажал Start',
  TRACKED: 'Пришедшие с лендинга или по ссылке на бота',
  LINKS: 'Только пришедшие по ссылке на бота',
  OFF: 'Start в боте лидом не делает',
};

export const ENTRY_LABEL: Record<string, string> = {
  BOT_DIRECT: 'в бота',
  PRIVATE_CHANNEL_REQUEST: 'на заявку в приватный канал',
  PUBLIC_CHANNEL_DIRECT: 'в публичный канал',
  PERSONAL_DM: 'в личные сообщения',
};

export async function fetchProjectFunnel(projectId: string): Promise<ProjectFunnel> {
  return (await api.get<ProjectFunnel>(`/projects/${projectId}/funnel`)).data;
}

// config = null — сбросить к поведению по умолчанию.
export async function saveProjectFunnel(projectId: string, config: FunnelConfig | null): Promise<ProjectFunnel> {
  return (await api.put<ProjectFunnel>(`/projects/${projectId}/funnel`, { config })).data;
}
