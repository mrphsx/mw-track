'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ArrowLeft, Bot, ChevronDown, ChevronUp, Loader2, Paperclip, Plus, Send, Trash2, User, X } from 'lucide-react';
import {
  BroadcastPartInput,
  CHAT_TABS,
  ChatSource,
  ChatTab,
  ConversationFilters,
  countBroadcastRecipients,
  createChatBroadcast,
  fetchChatAccess,
  fetchChatFields,
  fetchChatTags,
  TEMPLATE_KIND_LABEL,
  TemplateMediaKind,
  uploadBroadcastMedia,
} from '@/lib/chat';
import { cn } from '@/lib/utils';
import { useChatTemplates } from './templates';
import { useChatStages } from './stages';

// Новая рассылка во вкладке «Рассылки» (2026-10-25: «прямо внутри вкладки, несколько вариантов,
// полная фильтрация по всем параметрам, тегам, этапам, интервал между отправками, дата»).
// 2026-10-26: тот же конструктор открывается и из списка чатов (фильтр списка или выбранные
// диалоги подставляются сразу), у варианта — свои сообщения с файлами: фото, видео, файл, войс, кружок.

const FIELD = 'h-9 rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] px-2 text-sm text-[#131A24] dark:text-[#E9EDF3] outline-none';
const LABEL = 'text-xs font-medium text-[#5F6B7A] dark:text-[#92A0AF]';
const SECTION = 'rounded-xl border border-[#DCE1E8] dark:border-white/10 p-4 space-y-3';

// Дни из полей ввода → границы для API: «по» включительно.
function day(v: string, shift = 0) {
  const d = new Date(`${v}T00:00:00`);
  d.setDate(d.getDate() + shift);
  return d.toISOString();
}

function durationLabel(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} сек`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.round(minutes)} мин`;
  const hours = minutes / 60;
  return hours < 48 ? `${hours.toFixed(1)} ч` : `${(hours / 24).toFixed(1)} дн`;
}

// Часть своего сообщения: текст и/или файл. Файл грузится сразу при выборе; войс и кружок
// перекодирует сервер, поэтому при смене вида файл загружается заново.
interface Part {
  key: number;
  text: string;
  file: File | null;
  kind: TemplateMediaKind | null;
  preview: string | null;
  uploading: boolean;
  uploaded: Required<Omit<BroadcastPartInput, 'text'>> | null;
  error: string;
}

interface Variant {
  key: number;
  mode: 'own' | 'template';
  text: string; // для шаблона — свой текст перед ним / вместо его текста
  templateId: string;
  parts: Part[];
}
let seq = 0;
const newPart = (): Part => ({ key: ++seq, text: '', file: null, kind: null, preview: null, uploading: false, uploaded: null, error: '' });
const newVariant = (): Variant => ({ key: ++seq, mode: 'own', text: '', templateId: '', parts: [newPart()] });
const MAX_PARTS = 10;
const MAX_FILE = 20 * 1024 * 1024;

function guessKind(file: File): TemplateMediaKind {
  if (/^image\/(jpeg|png|webp)$/.test(file.type)) return 'photo';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'voice';
  return 'document';
}

// Какие виды можно выбрать для файла: аудио — войс или файл, видео — видео, кружок или файл.
function kindOptions(file: File): TemplateMediaKind[] {
  if (file.type.startsWith('video/')) return ['video', 'video_note', 'document'];
  if (file.type.startsWith('audio/')) return ['voice', 'document'];
  if (/^image\/(jpeg|png|webp)$/.test(file.type)) return ['photo', 'document'];
  return ['document'];
}

// Дата из ISO-границы фильтра списка обратно в поле ввода (yyyy-mm-dd, день браузера).
function isoToDay(iso: string | undefined, shift = 0) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + shift);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// source — ресурс, открытый сверху (бот или личка); рассылка только через него.
// initial — фильтр списка чатов, из которого открыли рассылку; conversationIds — выбранные вручную
// диалоги (тогда фильтры не показываются); embedded — внутри окна, без своей карточки.
export function BroadcastComposer({
  projectId,
  source,
  initial,
  conversationIds,
  embedded,
  onDone,
  onCancel,
}: {
  projectId: string;
  source: ChatSource;
  initial?: ConversationFilters & { search?: string };
  conversationIds?: string[];
  embedded?: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [tab, setTab] = useState<ChatTab>(initial?.tab ?? 'all');
  const [tagIds, setTagIds] = useState<string[]>(initial?.tagIds ?? []);
  const [stage, setStage] = useState(initial?.stage ?? '');
  const [assignee, setAssignee] = useState(initial?.assignee ?? '');
  const [fieldId, setFieldId] = useState(initial?.fieldId ?? '');
  const [fieldValue, setFieldValue] = useState(initial?.fieldValue ?? '');
  const [purchase, setPurchase] = useState<'' | 'yes' | 'no'>(initial?.purchase ?? '');
  const [traffic, setTraffic] = useState<'' | 'FB' | 'TT' | 'none'>(initial?.traffic ?? '');
  const [from, setFrom] = useState(isoToDay(initial?.from));
  const [to, setTo] = useState(isoToDay(initial?.to, -1));
  const [search, setSearch] = useState(initial?.search ?? '');
  const [variants, setVariants] = useState<Variant[]>([newVariant()]);
  const [delayMin, setDelayMin] = useState(source === 'PERSONAL' ? 15 : 1);
  const [delayMax, setDelayMax] = useState(source === 'PERSONAL' ? 40 : 3);
  const [later, setLater] = useState(false);
  const [sendAt, setSendAt] = useState('');
  const [error, setError] = useState('');

  // Настройки — того же ресурса, что и рассылка (у бота и лички свои).
  const resource = source === 'PERSONAL' ? 'PERSONAL' : 'BOT';
  const { data: templates } = useChatTemplates(projectId, resource);
  const { data: stagesData } = useChatStages(projectId, resource);
  const { data: tags } = useQuery({ queryKey: ['chat-tags', projectId, resource], queryFn: () => fetchChatTags(projectId, resource) });
  const { data: fields } = useQuery({ queryKey: ['chat-fields', projectId, resource], queryFn: () => fetchChatFields(projectId, resource) });
  const { data: access } = useQuery({ queryKey: ['chat-access', projectId], queryFn: () => fetchChatAccess(projectId) });

  // Интервал по умолчанию — под выбранный канал: личка медленно, бот быстрее.
  useEffect(() => {
    setDelayMin(source === 'PERSONAL' ? 15 : 1);
    setDelayMax(source === 'PERSONAL' ? 40 : 3);
  }, [source]);

  useEffect(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setSeconds(0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    setSendAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
  }, []);

  const filter: { projectId: string; source: ChatSource; search?: string } & ConversationFilters = {
    projectId,
    source,
    search: search || undefined,
    tab,
    tagIds,
    stage: stage || undefined,
    assignee: assignee || undefined,
    fieldId: fieldId || undefined,
    fieldValue: fieldValue || undefined,
    purchase,
    traffic,
    from: from ? day(from) : undefined,
    to: to ? day(to, 1) : undefined,
  };
  const [debounced, setDebounced] = useState(filter);
  const filterKey = JSON.stringify(filter);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(JSON.parse(filterKey)), 300);
    return () => clearTimeout(t);
  }, [filterKey]);
  const { data: count, isFetching: counting } = useQuery({
    queryKey: ['chat-broadcast-count', debounced, conversationIds],
    queryFn: () => countBroadcastRecipients(debounced, conversationIds),
  });

  const allTemplates = (templates?.folders ?? []).flatMap((f) => f.templates.map((t) => ({ ...t, folder: f.name })));
  const selectedField = fields?.fields.find((f) => f.id === fieldId);
  const operators = (access?.operators ?? []).filter((o) => o.isActive);
  const personalTooFast = source === 'PERSONAL' && delayMin < 5;
  const variantsValid = variants.every((v) =>
    v.mode === 'template' ? !!v.templateId : v.parts.length > 0 && v.parts.every((p) => !p.uploading && !p.error && (p.text.trim() || p.uploaded)),
  );
  const uploading = variants.some((v) => v.parts.some((p) => p.uploading));
  const avg = (delayMin + delayMax) / 2;

  const create = useMutation({
    mutationFn: () =>
      createChatBroadcast(filter, {
        conversationIds,
        variants: variants.map((v) =>
          v.mode === 'template'
            ? { text: v.text.trim() || undefined, templateId: v.templateId }
            : { parts: v.parts.map((p) => ({ text: p.text.trim() || undefined, ...(p.uploaded ?? {}) })) },
        ),
        delayMinSec: delayMin,
        delayMaxSec: delayMax,
        sendAt: later ? new Date(sendAt).toISOString() : undefined,
      }),
    onSuccess: onDone,
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось запустить рассылку'),
  });

  const setVariant = (key: number, patch: Partial<Variant>) => setVariants((prev) => prev.map((v) => (v.key === key ? { ...v, ...patch } : v)));
  const setPart = (vKey: number, pKey: number, patch: Partial<Part>) =>
    setVariants((prev) => prev.map((v) => (v.key === vKey ? { ...v, parts: v.parts.map((p) => (p.key === pKey ? { ...p, ...patch } : p)) } : v)));

  // Загрузка файла части; повторный вызов (смена вида) — загружает заново. Ответ на устаревшую
  // загрузку отбрасываем по номеру попытки.
  const attempts = useRef(new Map<number, number>());
  const upload = async (vKey: number, pKey: number, file: File, kind: TemplateMediaKind) => {
    if (file.size > MAX_FILE) {
      setPart(vKey, pKey, { error: 'Файл больше 20 МБ', file: null, uploaded: null });
      return;
    }
    const attempt = (attempts.current.get(pKey) ?? 0) + 1;
    attempts.current.set(pKey, attempt);
    setPart(vKey, pKey, { file, kind, uploading: true, uploaded: null, error: '' });
    try {
      const res = await uploadBroadcastMedia(projectId, file, kind);
      if (attempts.current.get(pKey) === attempt) setPart(vKey, pKey, { uploading: false, uploaded: res });
    } catch (err) {
      if (attempts.current.get(pKey) === attempt)
        setPart(vKey, pKey, { uploading: false, error: (isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось загрузить файл' });
    }
  };
  const attach = (vKey: number, pKey: number, file: File) => {
    setPart(vKey, pKey, { preview: file.type.startsWith('image/') || file.type.startsWith('video/') ? URL.createObjectURL(file) : null });
    void upload(vKey, pKey, file, guessKind(file));
  };
  // Несколько файлов (выбор или перетаскивание) — по сообщению на файл.
  const attachMany = (v: Variant, files: File[], intoKey?: number) => {
    let list = files;
    const target = intoKey !== undefined ? v.parts.find((p) => p.key === intoKey && !p.file) : undefined;
    if (target && list.length) {
      attach(v.key, target.key, list[0]);
      list = list.slice(1);
    }
    const room = MAX_PARTS - v.parts.length;
    const extra = list.slice(0, Math.max(0, room)).map((f) => ({ part: newPart(), file: f }));
    if (!extra.length) return;
    setVariants((prev) => prev.map((x) => (x.key === v.key ? { ...x, parts: [...x.parts, ...extra.map((e) => e.part)] } : x)));
    for (const e of extra) setTimeout(() => attach(v.key, e.part.key, e.file), 0);
  };
  const movePart = (vKey: number, index: number, dir: -1 | 1) =>
    setVariants((prev) =>
      prev.map((v) => {
        if (v.key !== vKey) return v;
        const parts = [...v.parts];
        const j = index + dir;
        if (j < 0 || j >= parts.length) return v;
        [parts[index], parts[j]] = [parts[j], parts[index]];
        return { ...v, parts };
      }),
    );

  return (
    <div className={embedded ? 'space-y-4' : 'rounded-xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-5 max-w-3xl mx-auto space-y-4'}>
      <div className="flex items-center gap-2">
        {!embedded && (
          <button type="button" onClick={onCancel} className="p-1.5 rounded-lg text-[#5F6B7A] hover:bg-[#F3F5F8] dark:hover:bg-white/5" aria-label="Назад">
            <ArrowLeft className="w-4 h-4" />
          </button>
        )}
        <h2 className="text-lg font-semibold text-[#131A24] dark:text-[#E9EDF3]">{conversationIds ? 'Рассылка выбранным' : 'Новая рассылка'}</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-[#F3F5F8] dark:bg-[#0F1620] px-2.5 py-0.5 text-xs font-medium text-[#5F6B7A] dark:text-[#92A0AF]">
          {source === 'BOT' ? <Bot className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
          {source === 'BOT' ? 'через бота' : 'с личного аккаунта'}
        </span>
      </div>

      {/* Кому */}
      <div className={SECTION}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Кому</span>
          <span className="text-sm">
            {counting && count === undefined ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#5F6B7A]" />
            ) : (
              <>
                Получателей: <b className="tabular-nums">{count === undefined ? '…' : count > 20000 ? 'больше 20 000' : count}</b>
              </>
            )}
          </span>
        </div>
        {conversationIds ? (
          <div className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">Диалоги, отмеченные в списке чатов.</div>
        ) : (
        <>
        {search && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-[#5F6B7A] dark:text-[#92A0AF]">Поиск из списка:</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-[#F3F5F8] dark:bg-[#0F1620] px-2 py-0.5 font-medium text-[#131A24] dark:text-[#E9EDF3]">
              {search}
              <button type="button" onClick={() => setSearch('')} aria-label="Убрать поиск" className="text-[#5F6B7A] hover:text-red-600">
                <X className="w-3 h-3" />
              </button>
            </span>
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          {CHAT_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              title={t.hint}
              onClick={() => setTab(t.value)}
              className={cn(
                'rounded-lg px-2.5 py-1 text-xs font-medium',
                tab === t.value ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]' : 'bg-[#F3F5F8] dark:bg-[#0F1620] text-[#5F6B7A] dark:text-[#92A0AF]',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className={LABEL}>Этап</span>
            <select value={stage} onChange={(e) => setStage(e.target.value)} className={cn(FIELD, 'w-full')}>
              <option value="">Любой</option>
              <option value="none">Без этапа</option>
              {stagesData?.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={LABEL}>Ответственный</span>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={cn(FIELD, 'w-full')}>
              <option value="">Любой</option>
              <option value="none">Без ответственного</option>
              {operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={LABEL}>Покупка</span>
            <select value={purchase} onChange={(e) => setPurchase(e.target.value as '' | 'yes' | 'no')} className={cn(FIELD, 'w-full')}>
              <option value="">Неважно</option>
              <option value="yes">Есть покупка (FD)</option>
              <option value="no">Без покупки</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className={LABEL}>Источник трафика</span>
            <select value={traffic} onChange={(e) => setTraffic(e.target.value as '' | 'FB' | 'TT' | 'none')} className={cn(FIELD, 'w-full')}>
              <option value="">Любой</option>
              <option value="FB">Facebook</option>
              <option value="TT">TikTok</option>
              <option value="none">Без метки (органика)</option>
            </select>
          </label>
          <div className="space-y-1">
            <span className={LABEL}>Начало диалога</span>
            <div className="flex items-center gap-1.5">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={cn(FIELD, 'flex-1 min-w-0')} />
              <span className="text-[#5F6B7A]">—</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={cn(FIELD, 'flex-1 min-w-0')} />
            </div>
          </div>
          {!!fields?.fields.length && (
            <div className="space-y-1 sm:col-span-2">
              <span className={LABEL}>Своё поле</span>
              <div className="flex gap-1.5">
                <select
                  value={fieldId}
                  onChange={(e) => {
                    setFieldId(e.target.value);
                    setFieldValue('');
                  }}
                  className={cn(FIELD, 'w-48')}
                >
                  <option value="">—</option>
                  {fields.fields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                {selectedField &&
                  (selectedField.options.length ? (
                    <select value={fieldValue} onChange={(e) => setFieldValue(e.target.value)} className={cn(FIELD, 'flex-1')}>
                      <option value="">любое значение</option>
                      {selectedField.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input value={fieldValue} onChange={(e) => setFieldValue(e.target.value)} placeholder="значение" className={cn(FIELD, 'flex-1')} />
                  ))}
              </div>
            </div>
          )}
        </div>
        {!!tags?.length && (
          <div className="space-y-1">
            <span className={LABEL}>Теги (любой из отмеченных)</span>
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => {
                const on = tagIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTagIds((prev) => (on ? prev.filter((x) => x !== t.id) : [...prev, t.id]))}
                    className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium border dark:brightness-150', on ? '' : 'opacity-60 hover:opacity-100')}
                    style={{ backgroundColor: on ? `${t.color}26` : 'transparent', color: t.color, borderColor: `${t.color}55` }}
                  >
                    {t.name} <span className="opacity-60">{t.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        </>
        )}
      </div>

      {/* Что */}
      <div className={SECTION}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Сообщение</span>
          {variants.length > 1 && <span className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">Лиды получат варианты по очереди: 1, 2, …, снова 1</span>}
        </div>
        {variants.map((v, i) => {
          const tpl = allTemplates.find((t) => t.id === v.templateId);
          return (
            <div
              key={v.key}
              className="rounded-lg bg-[#F3F5F8]/70 dark:bg-[#0F1620]/70 p-3 space-y-2"
              onDragOver={(e) => v.mode === 'own' && e.preventDefault()}
              onDrop={(e) => {
                if (v.mode !== 'own' || !e.dataTransfer.files.length) return;
                e.preventDefault();
                attachMany(v, Array.from(e.dataTransfer.files), v.parts.find((p) => !p.file)?.key);
              }}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[#131A24] dark:text-[#E9EDF3]">Вариант {i + 1}</span>
                <div className="inline-flex rounded-md bg-white dark:bg-[#171F2B] p-0.5">
                  {(
                    [
                      ['own', 'Свои сообщения'],
                      ['template', 'Шаблон'],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setVariant(v.key, { mode })}
                      className={cn(
                        'px-2 py-0.5 rounded text-xs font-medium',
                        v.mode === mode ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]' : 'text-[#5F6B7A] dark:text-[#92A0AF]',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {variants.length > 1 && (
                  <button type="button" onClick={() => setVariants((prev) => prev.filter((x) => x.key !== v.key))} className="ml-auto p-1 rounded text-[#5F6B7A] hover:text-red-600" aria-label="Убрать вариант">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {v.mode === 'template' ? (
                <>
                  <select value={v.templateId} onChange={(e) => setVariant(v.key, { templateId: e.target.value })} className={cn(FIELD, 'w-full h-8 bg-white dark:bg-[#171F2B]')}>
                    <option value="">Выберите шаблон…</option>
                    {allTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.folder} · #{t.code} {t.title}
                        {t.messages.length > 1 ? ` (${t.messages.length} сообщ.)` : ''}
                      </option>
                    ))}
                  </select>
                  {tpl && (
                    <div className="rounded-lg bg-white dark:bg-[#171F2B] px-2.5 py-1.5 text-xs text-[#5F6B7A] dark:text-[#92A0AF] space-y-0.5">
                      {tpl.messages.map((m, j) => (
                        <div key={m.id} className="truncate">
                          {tpl.messages.length > 1 && `${j + 1}. `}
                          {m.mediaKind && `[${TEMPLATE_KIND_LABEL[m.mediaKind].toLowerCase()}] `}
                          {m.text}
                        </div>
                      ))}
                    </div>
                  )}
                  <textarea
                    value={v.text}
                    onChange={(e) => setVariant(v.key, { text: e.target.value })}
                    rows={2}
                    maxLength={4096}
                    placeholder={tpl && tpl.messages.length > 1 ? 'Текст перед шаблоном (необязательно)' : 'Свой текст вместо текста шаблона (необязательно)'}
                    className="w-full rounded-lg bg-white dark:bg-[#171F2B] px-2.5 py-2 text-sm text-[#131A24] dark:text-[#E9EDF3] outline-none resize-y"
                  />
                </>
              ) : (
                <>
                  {v.parts.map((part, j) => (
                    <div key={part.key} className="rounded-lg bg-white dark:bg-[#171F2B] p-2 space-y-2">
                      {v.parts.length > 1 && (
                        <div className="flex items-center gap-1 text-[11px] text-[#5F6B7A] dark:text-[#92A0AF]">
                          <span className="font-semibold">Сообщение {j + 1}</span>
                          <button type="button" disabled={j === 0} onClick={() => movePart(v.key, j, -1)} className="ml-auto p-0.5 rounded disabled:opacity-30" aria-label="Выше">
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" disabled={j === v.parts.length - 1} onClick={() => movePart(v.key, j, 1)} className="p-0.5 rounded disabled:opacity-30" aria-label="Ниже">
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setVariant(v.key, { parts: v.parts.filter((p) => p.key !== part.key) })}
                            className="p-0.5 rounded hover:text-red-600"
                            aria-label="Убрать сообщение"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                      {part.file && (
                        <div className="flex items-center gap-2">
                          {part.preview && part.file.type.startsWith('image/') ? (
                            <img src={part.preview} alt="" className="w-12 h-12 rounded-md object-cover shrink-0" />
                          ) : part.preview && part.file.type.startsWith('video/') ? (
                            <video src={part.preview} muted className={cn('w-12 h-12 object-cover shrink-0', part.kind === 'video_note' ? 'rounded-full' : 'rounded-md')} />
                          ) : (
                            <div className="w-12 h-12 rounded-md bg-[#F3F5F8] dark:bg-[#0F1620] flex items-center justify-center shrink-0">
                              <Paperclip className="w-4 h-4 text-[#5F6B7A]" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium truncate text-[#131A24] dark:text-[#E9EDF3]">{part.file.name}</div>
                            <div className="flex flex-wrap items-center gap-1 mt-0.5">
                              {kindOptions(part.file).length > 1
                                ? kindOptions(part.file).map((k) => (
                                    <button
                                      key={k}
                                      type="button"
                                      disabled={part.uploading}
                                      onClick={() => k !== part.kind && part.file && void upload(v.key, part.key, part.file, k)}
                                      className={cn(
                                        'rounded px-1.5 py-0.5 text-[11px] font-medium',
                                        part.kind === k ? 'bg-[#1F4E9C]/10 text-[#1F4E9C] dark:bg-[#7BA9EE]/15 dark:text-[#7BA9EE]' : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:bg-[#F3F5F8] dark:hover:bg-white/5',
                                      )}
                                    >
                                      {TEMPLATE_KIND_LABEL[k]}
                                    </button>
                                  ))
                                : part.kind && <span className="text-[11px] text-[#5F6B7A] dark:text-[#92A0AF]">{TEMPLATE_KIND_LABEL[part.kind]}</span>}
                              {part.uploading && (
                                <span className="inline-flex items-center gap-1 text-[11px] text-[#5F6B7A]">
                                  <Loader2 className="w-3 h-3 animate-spin" /> {part.kind === 'voice' || part.kind === 'video_note' ? 'загрузка и обработка…' : 'загрузка…'}
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              attempts.current.set(part.key, (attempts.current.get(part.key) ?? 0) + 1);
                              setPart(v.key, part.key, { file: null, kind: null, preview: null, uploading: false, uploaded: null, error: '' });
                            }}
                            className="p-1 rounded text-[#5F6B7A] hover:text-red-600"
                            aria-label="Убрать файл"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                      {part.error && <div className="text-xs text-red-600 dark:text-red-400">{part.error}</div>}
                      {part.kind !== 'voice' && part.kind !== 'video_note' && (
                        <textarea
                          value={part.text}
                          onChange={(e) => setPart(v.key, part.key, { text: e.target.value })}
                          rows={part.file ? 2 : 4}
                          maxLength={4096}
                          placeholder={part.file ? 'Подпись (необязательно)' : 'Текст сообщения — или перетащите сюда файл'}
                          className="w-full rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] px-2.5 py-2 text-sm text-[#131A24] dark:text-[#E9EDF3] outline-none resize-y"
                        />
                      )}
                      {!part.file && (
                        <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs font-medium text-[#1F4E9C] dark:text-[#7BA9EE] hover:underline">
                          <Paperclip className="w-3.5 h-3.5" />
                          Прикрепить фото, видео, файл, войс или кружок
                          <input
                            type="file"
                            multiple
                            className="hidden"
                            onChange={(e) => {
                              const files = Array.from(e.target.files ?? []);
                              e.target.value = '';
                              if (files.length) attachMany(v, files, part.key);
                            }}
                          />
                        </label>
                      )}
                    </div>
                  ))}
                  {v.parts.length < MAX_PARTS && (
                    <button
                      type="button"
                      onClick={() => setVariant(v.key, { parts: [...v.parts, newPart()] })}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#1F4E9C] dark:text-[#7BA9EE] hover:underline"
                    >
                      <Plus className="w-3.5 h-3.5" /> Ещё сообщение
                    </button>
                  )}
                  {v.parts.length > 1 && <div className="text-[11px] text-[#5F6B7A] dark:text-[#92A0AF]">Сообщения уйдут лиду подряд, по порядку.</div>}
                </>
              )}
            </div>
          );
        })}
        {variants.length < 10 && (
          <button
            type="button"
            onClick={() => setVariants((prev) => [...prev, newVariant()])}
            className="w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-dashed border-[#DCE1E8] dark:border-white/15 text-xs font-medium text-[#1F4E9C] dark:text-[#7BA9EE]"
          >
            <Plus className="w-3.5 h-3.5" /> Добавить вариант
          </button>
        )}
      </div>

      {/* Когда и как часто */}
      <div className={SECTION}>
        <span className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Отправка</span>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[#5F6B7A] dark:text-[#92A0AF]">Пауза между сообщениями от</span>
          <input type="number" min={0} max={3600} value={delayMin} onChange={(e) => setDelayMin(Math.max(0, Number(e.target.value) || 0))} className={cn(FIELD, 'w-20 tabular-nums')} />
          <span className="text-[#5F6B7A] dark:text-[#92A0AF]">до</span>
          <input type="number" min={0} max={3600} value={delayMax} onChange={(e) => setDelayMax(Math.max(0, Number(e.target.value) || 0))} className={cn(FIELD, 'w-20 tabular-nums')} />
          <span className="text-[#5F6B7A] dark:text-[#92A0AF]">сек (случайно в этих пределах)</span>
        </div>
        {personalTooFast && <div className="text-xs text-red-600 dark:text-red-400">С личного аккаунта — не чаще раза в 5 секунд, иначе аккаунт могут забанить.</div>}
        {delayMax < delayMin && <div className="text-xs text-red-600 dark:text-red-400">«От» не может быть больше «до».</div>}
        {!!count && count <= 20000 && (
          <div className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">Займёт примерно {durationLabel(count * avg)}.</div>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={!later} onChange={() => setLater(false)} /> Сразу
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={later} onChange={() => setLater(true)} /> Запланировать на
          </label>
          {later && <input type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} className={FIELD} />}
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-9 px-4 rounded-lg text-sm text-[#5F6B7A] hover:bg-[#F3F5F8] dark:hover:bg-white/5">
          Отмена
        </button>
        <button
          type="button"
          disabled={!count || count > 20000 || !variantsValid || uploading || personalTooFast || delayMax < delayMin || create.isPending || (later && !sendAt)}
          onClick={() => confirm(`Отправить ${count} лидам${variants.length > 1 ? ` (${variants.length} варианта по очереди)` : ''}?`) && create.mutate()}
          className="h-9 px-4 rounded-lg text-sm font-semibold bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620] disabled:opacity-40 inline-flex items-center gap-1.5"
        >
          {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {later ? 'Запланировать' : 'Запустить рассылку'}
        </button>
      </div>
    </div>
  );
}
