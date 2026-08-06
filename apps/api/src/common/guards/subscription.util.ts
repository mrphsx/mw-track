import { Company } from '@prisma/client';

// Сами сравнения лимитов подписки — вынесены из SubscriptionGuard (запрос пользователя
// 2026-07-18, отложенные рассылки) в чистую функцию, чтобы крон отложенных пушей
// (pushes.cron.ts, вне HTTP-запроса — CanActivate-guard там применить нельзя) мог
// использовать РОВНО ту же проверку, что и живой HTTP-путь, а не отдельную копию, которая
// могла бы незаметно разъехаться с гвардом при следующем изменении логики лимитов.
export function checkSubscriptionLimit(company: Company, limit: string): { blocked: boolean; reason?: string } {
  // Ручная блокировка супер-админом (Фаза 4.3D, запрос пользователя 2026-07-19) — безусловно,
  // до проверки плана: заблокированная компания не должна проходить ни по одному лимиту, даже
  // если её план формально ещё активен. Тот же приём, что уже у planExpiresAt ниже — единая
  // точка для SubscriptionGuard (ручные действия) И PushesCron.fireScheduledPushes (авто),
  // без этого уже запланированные пуши заблокированной компании продолжали бы уходить.
  if (company.isSuspended) {
    return { blocked: true, reason: 'Компания заблокирована администратором платформы' };
  }

  if (company.planExpiresAt && company.planExpiresAt < new Date()) {
    return { blocked: true, reason: 'Подписка истекла. Пожалуйста, продлите план.' };
  }

  switch (limit) {
    case 'projects':
      if (company.currentProjects >= company.maxProjects) {
        return { blocked: true, reason: `Достигнут лимит проектов (${company.maxProjects}) для вашего плана` };
      }
      break;
    case 'clients':
      if (company.currentClients >= company.maxClients) {
        return { blocked: true, reason: `Достигнут лимит клиентов (${company.maxClients})` };
      }
      break;
    case 'pushes':
      if (company.pushesBlocked) {
        return { blocked: true, reason: 'Рассылки для этой компании заблокированы администратором' };
      }
      // Дневной лимит (запрос пользователя 2026-07-30) — был помесячным, см. plans.ts.
      if (company.pushesToday >= company.maxPushesPerDay) {
        return { blocked: true, reason: 'Достигнут дневной лимит рассылок для вашего плана' };
      }
      break;
  }

  return { blocked: false };
}
