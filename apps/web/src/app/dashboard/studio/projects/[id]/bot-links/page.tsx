'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ArrowLeft, Check, Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { STUDIO_CARD, StudioLinkButton, StudioPill } from '../../../ui';

type BotLinkSource = 'FACEBOOK' | 'TIKTOK' | 'TELEGRAM_ADS' | 'OTHER';

const SOURCE_LABEL: Record<BotLinkSource, string> = {
  FACEBOOK: 'Facebook',
  TIKTOK: 'TikTok',
  TELEGRAM_ADS: 'Telegram Ads',
  OTHER: 'Другое',
};

const SOURCE_HINT: Record<BotLinkSource, string> = {
  FACEBOOK: 'В ссылку уже вставлены макросы {{ad.id}} и {{campaign.id}} — Facebook сам подставит id объявления и кампании.',
  TIKTOK: 'В ссылку уже вставлены макросы __CID__ и __CAMPAIGN_ID__ — TikTok сам подставит id объявления и кампании.',
  TELEGRAM_ADS: 'Статичная ссылка — Telegram Ads не подставляет макросы. Для разных объявлений создайте отдельные ссылки.',
  OTHER: 'Статичная ссылка — для любого другого источника. Разные креативы — разные ссылки.',
};

interface BotLinkItem {
  id: string;
  name: string;
  source: BotLinkSource;
  buyerId: string | null;
  buyerName: string | null;
  pixelId: string | null;
  pixelLabel: string | null;
  url: string | null;
  leads: number;
  dialogues: number;
  depositors: number;
  revenue: number;
}

interface BotLinksResponse {
  botUsername: string | null;
  available: boolean;
  // Кто из нажавших Start — лид (воронка проекта, 2026-10-24).
  leadBotStart: 'ALL' | 'TRACKED' | 'LINKS' | 'OFF';
  items: BotLinkItem[];
}

const LEAD_RULE_TEXT: Record<BotLinksResponse['leadBotStart'], string> = {
  ALL: 'лидом считается каждый новый Start, даже без ссылки',
  TRACKED: 'лидами считаются пришедшие по ссылкам на бота и с лендингов',
  LINKS: 'лидами считаются только пришедшие по ссылкам на бота',
  OFF: 'Start в боте сейчас лидом не делает — пришедшие по ссылкам не попадут в статистику',
};

interface ProjectInfo {
  name: string;
  pixels: { id: string; platform: string; pixelId: string; label: string | null }[];
}

// Ссылки на бота для рекламы без лендинга (запрос пользователя 2026-10-23): у каждой ссылки свой
// код, по которому бот на /start узнаёт источник, баера и пиксель, а хвост с макросами кабинета
// даёт id объявления и кампании — всё это ложится в карточку клиента и в статистику проекта так
// же, как атрибуция с лендинга.
export default function StudioBotLinksPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);
  const isBuyer = user?.role === 'BUYER';
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<BotLinkItem | 'new' | null>(null);

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => (await api.get<ProjectInfo>(`/projects/${projectId}`)).data,
  });
  const { data } = useQuery({
    queryKey: ['bot-links', projectId],
    queryFn: async () => (await api.get<BotLinksResponse>(`/projects/${projectId}/bot-links`)).data,
  });

  const remove = useMutation({
    mutationFn: (linkId: string) => api.delete(`/projects/${projectId}/bot-links/${linkId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bot-links', projectId] }),
  });

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="space-y-2">
        <Link
          href={`/projects/${projectId}`}
          className="inline-flex items-center gap-1.5 text-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]"
        >
          <ArrowLeft className="w-4 h-4" /> {project?.name ?? 'Проект'}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Ссылки на бота</h1>
          {data?.available && (
            <StudioLinkButton variant="primary" icon={Plus} onClick={() => setEditing('new')}>
              Новая ссылка
            </StudioLinkButton>
          )}
        </div>
      </div>

      <div className={`${STUDIO_CARD} p-5 grid gap-4 sm:grid-cols-3 text-sm`}>
        {[
          ['1', 'Создайте ссылку', 'Под каждую площадку, баера или креатив — своя ссылка со своим пикселем.'],
          ['2', 'Вставьте в рекламу', 'Ссылка ведёт сразу в бота. Facebook и TikTok сами подставят id объявления и кампании.'],
          ['3', 'Бот соберёт лида', 'Нажал Start — клиент в CRM с источником, баером и рекламой, в статистике и в чатах.'],
        ].map(([n, title, text]) => (
          <div key={n} className="flex gap-3">
            <div className="w-7 h-7 shrink-0 rounded-full bg-[#1F4E9C]/10 dark:bg-[#7BA9EE]/10 text-[#1F4E9C] dark:text-[#7BA9EE] text-xs font-bold flex items-center justify-center">
              {n}
            </div>
            <div>
              <div className="font-medium text-[#131A24] dark:text-[#E9EDF3]">{title}</div>
              <div className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] mt-0.5">{text}</div>
            </div>
          </div>
        ))}
      </div>

      {data && !data.available && (
        <div className={`${STUDIO_CARD} p-5 text-sm text-[#5F6B7A] dark:text-[#92A0AF]`}>
          Ссылки на бота работают для проектов с ботом в режиме «Сразу в бота». Смените способ вступления в{' '}
          <Link href={`/projects/${projectId}/settings?tab=channels`} className="text-[#1F4E9C] dark:text-[#7BA9EE] underline">
            настройках канала
          </Link>
          .
        </div>
      )}

      {data?.available && (
        <div className={`${STUDIO_CARD} p-4 flex flex-wrap items-center justify-between gap-3 text-sm`}>
          <div className="text-[#5F6B7A] dark:text-[#92A0AF]">
            Бот <span className="font-medium text-[#131A24] dark:text-[#E9EDF3]">@{data.botUsername}</span> ·{' '}
            <span className={data.leadBotStart === 'OFF' ? 'text-red-600 dark:text-red-400' : ''}>{LEAD_RULE_TEXT[data.leadBotStart]}</span>
          </div>
          <Link href={`/projects/${projectId}/settings?tab=funnel`} className="text-xs text-[#1F4E9C] dark:text-[#7BA9EE] hover:underline">
            Изменить в «Воронке»
          </Link>
        </div>
      )}

      {data?.available && (
        <div className={`${STUDIO_CARD} overflow-x-auto`}>
          {data.items.length === 0 ? (
            <div className="p-10 text-center text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Ссылок пока нет — создайте первую.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[#5F6B7A] dark:text-[#92A0AF] border-b border-[#DCE1E8] dark:border-white/10">
                  <th className="px-4 py-3 font-medium">Ссылка</th>
                  <th className="px-3 py-3 font-medium">Баер / пиксель</th>
                  <th className="px-3 py-3 font-medium text-right">Лиды</th>
                  <th className="px-3 py-3 font-medium text-right">Диалоги</th>
                  <th className="px-3 py-3 font-medium text-right">FD</th>
                  <th className="px-3 py-3 font-medium text-right">Доход</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((link) => (
                  <tr key={link.id} className="border-b last:border-0 border-[#DCE1E8] dark:border-white/10 align-top">
                    <td className="px-4 py-3 max-w-md">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[#131A24] dark:text-[#E9EDF3]">{link.name}</span>
                        <StudioPill hue="amber">{SOURCE_LABEL[link.source]}</StudioPill>
                      </div>
                      {link.url && <CopyableUrl url={link.url} />}
                    </td>
                    <td className="px-3 py-3 text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
                      <div>{link.buyerName ?? 'Без баера'}</div>
                      <div>{link.pixelLabel ?? 'Без пикселя'}</div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium text-[#131A24] dark:text-[#E9EDF3]">{link.leads}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{link.dialogues}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{link.depositors}</td>
                    <td className="px-3 py-3 text-right tabular-nums">${link.revenue.toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setEditing(link)}
                          className="p-1.5 rounded-lg text-[#5F6B7A] hover:bg-[#F3F5F8] dark:hover:bg-white/5"
                          aria-label="Изменить"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => confirm(`Удалить ссылку «${link.name}»? Уже пришедшие по ней клиенты сохранят источник.`) && remove.mutate(link.id)}
                          className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                          aria-label="Удалить"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {editing && (
        <BotLinkDialog
          projectId={projectId}
          link={editing === 'new' ? null : editing}
          pixels={project?.pixels ?? []}
          canPickBuyer={!isBuyer}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function CopyableUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await copyToClipboard(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="mt-1.5 flex items-center gap-1.5 max-w-full text-left font-mono text-[11px] text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]"
      title="Скопировать"
    >
      {copied ? <Check className="w-3 h-3 shrink-0 text-emerald-500" /> : <Copy className="w-3 h-3 shrink-0" />}
      <span className="break-all">{url}</span>
    </button>
  );
}

function BotLinkDialog({
  projectId,
  link,
  pixels,
  canPickBuyer,
  onClose,
}: {
  projectId: string;
  link: BotLinkItem | null;
  pixels: ProjectInfo['pixels'];
  canPickBuyer: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(link?.name ?? '');
  const [source, setSource] = useState<BotLinkSource>(link?.source ?? 'FACEBOOK');
  const [buyerId, setBuyerId] = useState(link?.buyerId ?? '');
  const [pixelId, setPixelId] = useState(link?.pixelId ?? '');
  const [error, setError] = useState('');

  const { data: options } = useQuery({
    queryKey: ['clients-filter-options', projectId],
    queryFn: async () => (await api.get<{ buyers: { id: string; name: string; isDeleted: boolean }[] }>(`/projects/${projectId}/clients/filter-options`)).data,
    enabled: canPickBuyer,
  });

  const save = useMutation({
    mutationFn: () => {
      const body = { name, source, pixelId: pixelId || null, ...(canPickBuyer ? { buyerId: buyerId || null } : {}) };
      return link ? api.patch(`/projects/${projectId}/bot-links/${link.id}`, body) : api.post(`/projects/${projectId}/bot-links`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bot-links', projectId] });
      onClose();
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить'),
  });

  const selectClass = 'w-full h-9 rounded-md border border-input bg-transparent px-2.5 text-sm';

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{link ? 'Изменить ссылку' : 'Новая ссылка на бота'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bot-link-name">Название</Label>
            <Input id="bot-link-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="FB — креатив «Отзывы»" />
            <p className="text-xs text-muted-foreground">Попадёт в карточку клиента и в UTM Campaign.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Площадка</Label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(SOURCE_LABEL) as BotLinkSource[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSource(s)}
                  className={`h-9 rounded-lg border text-sm transition-colors ${
                    source === s
                      ? 'border-[#1F4E9C] bg-[#1F4E9C]/10 text-[#1F4E9C] dark:border-[#7BA9EE] dark:bg-[#7BA9EE]/10 dark:text-[#7BA9EE] font-medium'
                      : 'border-input hover:bg-muted'
                  }`}
                >
                  {SOURCE_LABEL[s]}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{SOURCE_HINT[source]}</p>
          </div>
          {canPickBuyer && (
            <div className="space-y-1.5">
              <Label htmlFor="bot-link-buyer">Баер</Label>
              <select id="bot-link-buyer" value={buyerId} onChange={(e) => setBuyerId(e.target.value)} className={selectClass}>
                <option value="">Без баера</option>
                {options?.buyers
                  .filter((b) => !b.isDeleted || b.id === buyerId)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="bot-link-pixel">Пиксель</Label>
            <select id="bot-link-pixel" value={pixelId} onChange={(e) => setPixelId(e.target.value)} className={selectClass}>
              <option value="">Без пикселя</option>
              {pixels.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label || `${p.platform} ${p.pixelId}`}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">События лида (подписка, диалог, депозит) уйдут в этот пиксель.</p>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
        <DialogFooter>
          <StudioLinkButton onClick={onClose}>Отмена</StudioLinkButton>
          <StudioLinkButton variant="primary" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Сохраняем…' : link ? 'Сохранить' : 'Создать'}
          </StudioLinkButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
