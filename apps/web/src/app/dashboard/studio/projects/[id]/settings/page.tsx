'use client';

import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Project, readTabFromSearchParams, SettingsTab } from '../../../../../(dashboard)/projects/[id]/settings/tabs';
import {
  BotSettingsTab,
  DangerTab,
  EventsTab,
  GeneralTab,
  ChannelsTab,
  IntegrationTab,
  PersonalAccountConnect,
  PixelLogsTab,
  PixelsTab,
} from './tabs';

// Studio-версия настроек проекта. Первый проход (2026-07-30, "давай дальше") переиспользовал
// содержимое вкладок из классического файла без изменений — только оболочка (шапка, пилюли).
// Второй проход, тем же днём (запрос пользователя: "именно внутренние формы тоже доделай под
// дизайн studio") — сама разметка каждой вкладки теперь в отдельном Studio-файле ./tabs.tsx
// (STUDIO_CARD/StudioPill/StudioLinkButton вместо Card/Badge/Button), с той же логикой
// (state/мутации/запросы), скопированной 1:1 — см. комментарий в шапке ./tabs.tsx. Типы/утилиты
// (Project, readTabFromSearchParams, SettingsTab) по-прежнему берутся из классического модуля —
// они не визуальные, дублировать их не за чем. Третий проход, 2026-07-30 ("сделай под новый
// дизайн и страницу проектов и настройки") — BotSettingsTab/PersonalAccountConnect тоже
// переоформлены (теперь свои Studio-версии в ./tabs.tsx, а не импорт классических компонентов),
// закрывая последний известный пробел этой страницы.
export default function StudioProjectSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [tab, setTab] = useState<SettingsTab>(() => readTabFromSearchParams(searchParams));

  const handleTabChange = (value: SettingsTab) => {
    setTab(value);
    const params = new URLSearchParams(searchParams);
    params.set('tab', value);
    router.replace(`${pathname}?${params}`, { scroll: false });
  };

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: async () => (await api.get<Project>(`/projects/${id}`)).data,
  });

  if (!project) return <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>;

  const isTelegram = project.channel?.type === 'TELEGRAM';

  const tabs: { value: SettingsTab; label: string; hidden?: boolean }[] = [
    { value: 'general', label: 'Основные' },
    { value: 'channels', label: 'Каналы' },
    { value: 'bot', label: 'Бот', hidden: !isTelegram },
    { value: 'personal', label: 'Личный аккаунт', hidden: !isTelegram },
    { value: 'pixels', label: 'Пиксели' },
    { value: 'pixel-logs', label: 'Логи' },
    { value: 'events', label: 'События' },
    { value: 'integration', label: 'Интеграция' },
    { value: 'danger', label: 'Опасная зона' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Настройки проекта</h1>

      <div className="inline-flex flex-wrap rounded-lg bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-1 gap-0.5">
        {tabs
          .filter((t) => !t.hidden)
          .map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => handleTabChange(t.value)}
              className={`px-4 py-1.5 text-sm rounded-lg transition-colors whitespace-nowrap ${
                tab === t.value
                  ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                  : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
              }`}
            >
              {t.label}
            </button>
          ))}
      </div>

      <div>
        {tab === 'general' && <GeneralTab project={project} />}
        {tab === 'channels' && <ChannelsTab projectId={id} channel={project.channel} />}
        {tab === 'bot' && isTelegram && project.channel && (
          <BotSettingsTab projectId={id} channelId={project.channel.id} channelType={project.channel.type} />
        )}
        {tab === 'personal' && isTelegram && project.channel && <PersonalAccountConnect channelId={project.channel.id} />}
        {tab === 'pixels' && <PixelsTab projectId={id} pixels={project.pixels} linkParamMap={project.linkParamMap} />}
        {tab === 'pixel-logs' && <PixelLogsTab projectId={id} pixels={project.pixels} />}
        {tab === 'events' && <EventsTab projectId={id} disabledTrackingEvents={project.disabledTrackingEvents} />}
        {tab === 'integration' && <IntegrationTab projectId={id} allowedDomains={project.allowedDomains} />}
        {tab === 'danger' && <DangerTab projectId={id} onArchived={() => router.push('/dashboard/studio')} />}
      </div>
    </div>
  );
}
