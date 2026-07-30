'use client';

import { useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { BotSettingsTab } from '@/components/bot-settings-tab';
import { PersonalAccountConnect } from '@/components/personal-account-connect';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DangerTab,
  EventsTab,
  GeneralTab,
  ChannelsTab,
  IntegrationTab,
  PixelLogsTab,
  PixelsTab,
  Project,
  readTabFromSearchParams,
  SettingsTab,
} from './tabs';

// Компоненты вкладок живут в ./tabs.tsx (запрос пользователя 2026-07-30: перенесены туда, чтобы
// их же переиспользовала Studio-версия этой страницы — Next.js App Router не разрешает
// произвольные именованные export из файла page.tsx). Сама эта страница — только раскладка вкладок
// и персистентность выбранной вкладки в URL, ничего не изменилось функционально.
export default function ProjectSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Персистентность вкладки в URL (тот же паттерн, что уже есть у PeriodSelector на странице
  // проекта, apps/web/src/app/(dashboard)/projects/[id]/page.tsx) — читаем один раз при
  // монтировании через useState(() => ...), а не useEffect, чтобы не мигать вкладкой "Основные"
  // перед переключением на реальную.
  const [tab, setTab] = useState<SettingsTab>(() => readTabFromSearchParams(searchParams));

  const handleTabChange = (value: string) => {
    setTab(value as SettingsTab);
    const params = new URLSearchParams(searchParams);
    params.set('tab', value);
    router.replace(`${pathname}?${params}`, { scroll: false });
  };

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: async () => (await api.get<Project>(`/projects/${id}`)).data,
  });

  if (!project) return <p className="text-sm text-muted-foreground">Загрузка...</p>;

  return (
    // Без ограничения ширины — та же конвенция, что у остальных страниц дашборда
    // (projects/[id]/page.tsx, /landings, /projects), max-w-3xl раньше душил вкладку
    // "Пиксели" (список+параметры трекинг-ссылки в две колонки, запрос пользователя 2026-07-20).
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Настройки проекта</h1>

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="general">Основные</TabsTrigger>
          <TabsTrigger value="channels">Каналы</TabsTrigger>
          {project.channel?.type === 'TELEGRAM' && <TabsTrigger value="bot">Бот</TabsTrigger>}
          {project.channel?.type === 'TELEGRAM' && (
            <TabsTrigger value="personal">Личный аккаунт</TabsTrigger>
          )}
          <TabsTrigger value="pixels">Пиксели</TabsTrigger>
          <TabsTrigger value="pixel-logs">Логи</TabsTrigger>
          <TabsTrigger value="events">События</TabsTrigger>
          <TabsTrigger value="integration">Интеграция</TabsTrigger>
          <TabsTrigger value="danger">Опасная зона</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4">
          <GeneralTab project={project} />
        </TabsContent>
        <TabsContent value="channels" className="mt-4">
          <ChannelsTab projectId={id} channel={project.channel} />
        </TabsContent>
        {project.channel?.type === 'TELEGRAM' && (
          <TabsContent value="bot" className="mt-4">
            <BotSettingsTab
              projectId={id}
              channelId={project.channel.id}
              channelType={project.channel.type}
            />
          </TabsContent>
        )}
        {project.channel?.type === 'TELEGRAM' && (
          <TabsContent value="personal" className="mt-4">
            <PersonalAccountConnect channelId={project.channel.id} />
          </TabsContent>
        )}
        <TabsContent value="pixels" className="mt-4">
          <PixelsTab projectId={id} pixels={project.pixels} linkParamMap={project.linkParamMap} />
        </TabsContent>
        <TabsContent value="pixel-logs" className="mt-4">
          <PixelLogsTab projectId={id} pixels={project.pixels} />
        </TabsContent>
        <TabsContent value="events" className="mt-4">
          <EventsTab projectId={id} disabledTrackingEvents={project.disabledTrackingEvents} />
        </TabsContent>
        <TabsContent value="integration" className="mt-4">
          <IntegrationTab projectId={id} allowedDomains={project.allowedDomains} />
        </TabsContent>
        <TabsContent value="danger" className="mt-4">
          <DangerTab projectId={id} onArchived={() => router.push('/projects')} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
