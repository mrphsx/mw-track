'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/lib/utils';
import { LinkPixel, buildTrackedLink } from '@/lib/landings';
import { useAuthStore } from '@/store/auth.store';

// Управленческие роли (Фаза 3.6, Team Analytics) — та же группа, что уже используется на
// /team/page.tsx для isOwner и бэкендом (ProjectsService.findAll/getStats) как "видит всё в
// компании". Ссылка, взятая с такого аккаунта, не несёт метку баера — клиент в системе будет
// отмечен как "БЕЗ БАЕРА".
const ELEVATED_ROLES = ['OWNER', 'ADMIN', 'SUPER_ADMIN'];

// Минимальные формы вместо полных LandingItem/LandingAttachment — диалог используется и там,
// где под рукой полный объект (карточка лендинга), и там, где есть только urls/id из stats-
// эндпоинта лендинга (страница статистики), buildTrackedLink нужны только domain+path.
export interface GetLinkLanding {
  id: string;
  name: string;
  project: { id: string };
}

export interface GetLinkAttachment {
  domain: string;
  path: string;
}
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const ALL_PIXELS = '__all__';

// Трекинг-ссылка лендинга с пикселем + рекламными макросами Facebook/TikTok (запрос
// пользователя 2026-07-04): баер выбирает один пиксель проекта → получает готовую ссылку с
// ad_id/campaign_id/... для вставки в Ads Manager как destination URL. Данные проекта
// (пиксели + кастомная карта имён параметров) грузятся лениво, только когда диалог открыт —
// та же ['project', id] query, что уже используют настройки проекта.
export function GetLinkDialog({
  landing,
  attachment,
  onClose,
}: {
  landing: GetLinkLanding | null;
  attachment: GetLinkAttachment | null;
  onClose: () => void;
}) {
  const [pixelSelection, setPixelSelection] = useState(ALL_PIXELS);
  const currentUser = useAuthStore((s) => s.user);

  const { data: project } = useQuery({
    queryKey: ['project', landing?.project.id],
    queryFn: () => api.get(`/projects/${landing!.project.id}`).then((r) => r.data),
    enabled: !!landing,
  });

  if (!landing) return null;

  const pixels: LinkPixel[] = (project?.pixels ?? []).filter((p: LinkPixel) => p.isActive);
  const selectedPixel = pixels.find((p) => p.id === pixelSelection) ?? null;
  const isElevated = !!currentUser && ELEVATED_ROLES.includes(currentUser.role);
  // Короткий код (запрос пользователя 2026-08-20) — обычный id как фолбэк, если код почему-то
  // ещё не сгенерирован (см. common/short-code.util.ts на бэкенде).
  const buyerId = isElevated ? null : (currentUser?.buyerShortCode || currentUser?.id || null);
  const link = attachment ? buildTrackedLink(attachment, selectedPixel, project?.linkParamMap, buyerId) : null;

  return (
    <Dialog open={!!landing} onOpenChange={(open) => !open && onClose()}>
      {/* Расширено (баг-репорт пользователя 2026-07-30: "слишком маленький попап, в выборке не
          помещаются пикселя, так же сама ссылка не помещается на экран") — max-w-lg было тесно
          и для длинного списка пикселей в Select, и для самой ссылки (десяток параметров с
          рекламными макросами легко превышает ширину обычного попапа). max-h-[85vh]+overflow-y
          на случай проекта с большим числом пикселей — сам Select уже скроллится внутри себя, но
          общая высота диалога тоже должна иметь предел на низких экранах. */}
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ссылка для «{landing.name}»</DialogTitle>
        </DialogHeader>

        {!attachment ? (
          <p className="text-sm text-muted-foreground">Сначала привяжите домен к лендингу.</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="get-link-pixel">Пиксель</Label>
              <Select value={pixelSelection} onValueChange={(v) => v && setPixelSelection(v)}>
                <SelectTrigger id="get-link-pixel" className="w-full">
                  {/* Баг (6-й раз в проекте, тот же паттерн) — без children-функции Base UI
                      показывает сырое value (id пикселя), а не название. */}
                  <SelectValue>
                    {(v: string) =>
                      v === ALL_PIXELS
                        ? 'Все активные пиксели проекта (без привязки)'
                        : (() => {
                            const p = pixels.find((px) => px.id === v);
                            return p ? `${p.label || p.pixelId} (${p.platform})` : v;
                          })()
                    }
                  </SelectValue>
                </SelectTrigger>
                {/* w-max вместо дефолтного w-(--anchor-width) (баг-репорт пользователя
                    2026-07-30: "выбор пикселя всё ещё не вмещает названия") — попап по умолчанию
                    жёстко равен ширине триггера, а не самого длинного пункта, длинные названия
                    пикселей обрезались overflow-x-hidden без многоточия. min-w сохраняет прежнее
                    поведение "не уже триггера", max-w — защита от переполнения на очень длинных
                    названиях. */}
                <SelectContent className="w-max min-w-(--anchor-width) max-w-[26rem]">
                  <SelectItem value={ALL_PIXELS}>Все активные пиксели проекта (без привязки)</SelectItem>
                  {pixels.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label || p.pixelId} ({p.platform})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {pixels.length === 0 && (
                <p className="text-xs text-muted-foreground">В проекте пока нет пикселей — ссылка сработает без привязки к конкретному.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="get-link-url">Ссылка для рекламного кабинета</Label>
              <div className="flex gap-2 items-start">
                {/* Textarea вместо однострочного Input — сама ссылка (баг-репорт: "не
                    помещается на экран") теперь переносится по строкам вместо горизонтального
                    скролла/обрезки. resize-none — это поле только для чтения/копирования, не
                    для редактирования формы. */}
                <Textarea
                  id="get-link-url"
                  readOnly
                  value={link ?? ''}
                  rows={4}
                  className="font-mono text-xs resize-none break-all"
                />
                <Button size="icon" variant="outline" className="shrink-0" onClick={() => link && copyToClipboard(link)}>
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {'{{ad.id}}, {{campaign.id}}'} и т.п. — подставит сама рекламная система при показе объявления. Имена
                параметров можно изменить в настройках проекта.
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
