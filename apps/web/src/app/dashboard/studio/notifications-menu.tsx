'use client';

// Колокол оповещений Studio. Был инлайном прямо в layout.tsx — ДВАЖДЫ (в пилюле для десктопа и
// отдельной кнопкой для мобильного), поэтому с появлением объявлений платформы (запрос
// пользователя 2026-10-02) логика вынесена сюда: иначе запрос, счётчик непрочитанных и обе
// мутации пришлось бы держать в двух копиях. Только Studio — классическое дерево легаси и не
// трогается (стандартное правило по UI-правкам).
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { api } from '@/lib/api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface AdminNotice {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

export function StudioNotificationsMenu({
  systemAlerts,
  triggerClassName,
  badgeClassName,
}: {
  // Живые проблемы, выведенные из состояния проектов/подписки (бот отключён, сессия отозвана,
  // подписка истекает). У них нет состояния "прочитано": они исчезают сами, когда проблема
  // решена, и возвращаются, пока она есть — поэтому их не касается ни отметка о прочтении, ни
  // "Очистить все".
  systemAlerts: string[];
  triggerClassName: string;
  badgeClassName: string;
}) {
  const queryClient = useQueryClient();

  const { data: notices } = useQuery({
    queryKey: ['notices'],
    queryFn: async () => (await api.get<AdminNotice[]>('/notices')).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notices'] });
  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notices/${id}/read`),
    onSuccess: invalidate,
  });
  const clearAll = useMutation({
    mutationFn: () => api.post('/notices/clear'),
    onSuccess: invalidate,
  });

  const unreadNotices = (notices ?? []).filter((n) => !n.read).length;
  const badgeCount = systemAlerts.length + unreadNotices;
  const isEmpty = systemAlerts.length === 0 && (notices ?? []).length === 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={triggerClassName}>
        <Bell className="w-4 h-4" />
        {badgeCount > 0 && <span className={badgeClassName}>{badgeCount}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        {isEmpty && <div className="px-2 py-1.5 text-sm text-muted-foreground">Всё в порядке</div>}

        {systemAlerts.map((n, i) => (
          <DropdownMenuItem key={`alert-${i}`} className="text-sm whitespace-normal">
            {n}
          </DropdownMenuItem>
        ))}

        {systemAlerts.length > 0 && (notices ?? []).length > 0 && <DropdownMenuSeparator />}

        {/* closeOnClick={false} — нажатие помечает объявление прочитанным, но меню не закрывается:
            иначе прочитать несколько подряд (и затем нажать "Очистить все") было бы невозможно. */}
        {(notices ?? []).map((n) => (
          <DropdownMenuItem
            key={n.id}
            closeOnClick={false}
            onClick={() => {
              if (!n.read) markRead.mutate(n.id);
            }}
            className="flex-col items-start gap-0.5 whitespace-normal py-1.5"
          >
            <div className="flex w-full items-start gap-1.5">
              {!n.read && <span className="mt-1.5 w-1.5 h-1.5 shrink-0 rounded-full bg-red-500" />}
              <span className={`text-sm leading-snug ${n.read ? 'text-muted-foreground' : 'font-semibold'}`}>{n.title}</span>
            </div>
            <span className="text-xs leading-snug text-muted-foreground whitespace-pre-line">{n.body}</span>
            <span className="text-[11px] text-muted-foreground/70">
              {format(new Date(n.createdAt), 'd MMM yyyy, HH:mm', { locale: ru })}
            </span>
          </DropdownMenuItem>
        ))}

        {/* Кнопка показывается только когда есть что скрывать: живые проблемы выше она не
            убирает (они вернулись бы при следующем запросе — выглядело бы как поломка). */}
        {(notices ?? []).length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              closeOnClick={false}
              onClick={() => clearAll.mutate()}
              disabled={clearAll.isPending}
              className="justify-center text-xs text-muted-foreground"
            >
              Очистить все
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
