'use client';

import { useState } from 'react';
import { isAxiosError } from 'axios';
import { AlertTriangle, Check, CheckCircle2, Copy, Eye, EyeOff, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Общая форма полей канала — используется и при создании проекта (канал выбирается и
// настраивается сразу, см. apps/web/src/app/(dashboard)/projects/new/page.tsx), и при
// редактировании уже существующего канала проекта (apps/web/.../[id]/settings/page.tsx).
// Раньше жила только в настройках, вынесена сюда 2026-07-02 при переходе Project↔Channel
// на строгий 1:1 (канал больше не "добавляется" отдельным шагом после создания проекта).

export type ChannelType = 'TELEGRAM' | 'WHATSAPP' | 'INSTAGRAM' | 'WEBSITE';

export const CHANNEL_TYPE_LABEL: Record<ChannelType, string> = {
  TELEGRAM: 'Telegram',
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  WEBSITE: 'Website',
};

// 4 способа, которыми лендинг ведёт в Telegram — см. prisma/schema.prisma enum TelegramMode
// и LandingRendererService.buildTelegramLink. Выбор влияет на то, какие поля канала нужны
// и куда в итоге ведёт кнопка "Вступить" на лендинге.
export type TgMode = 'BOT_DIRECT' | 'PRIVATE_CHANNEL_REQUEST' | 'PUBLIC_CHANNEL_DIRECT' | 'PERSONAL_DM';

export const TG_MODE_LABEL: Record<TgMode, string> = {
  BOT_DIRECT: 'Сразу в бота',
  PRIVATE_CHANNEL_REQUEST: 'Приватный канал (заявка)',
  PUBLIC_CHANNEL_DIRECT: 'Публичный канал (напрямую)',
  PERSONAL_DM: 'Личные сообщения (без бота)',
};

export const TG_MODE_HINT: Record<TgMode, string> = {
  BOT_DIRECT: 'Кнопка открывает чат с ботом — бот фиксирует атрибуцию (fbclid/UTM) и общается с пользователем напрямую.',
  PRIVATE_CHANNEL_REQUEST:
    'Кнопка сразу открывает нативный экран Telegram «Подать заявку» в канал — бот не участвует в переписке, заявку одобряет автоматически. Атрибуция по клику (fbclid/UTM) не сохраняется — у пригласительных ссылок Telegram нет параметров, это ограничение платформы.',
  PUBLIC_CHANNEL_DIRECT:
    'Кнопка ведёт прямо в публичный канал, без чата с ботом — один клик для пользователя, но атрибуция по клику слабее (нет fbclid/UTM на момент вступления).',
  PERSONAL_DM:
    'Кнопка открывает личный диалог с указанным аккаунтом — без бота и вебхука. Подписчики не попадают в CRM (только клик фиксируется как Lead), пуши через этот канал недоступны.',
};

export interface ChannelFormState {
  type: ChannelType;
  name: string;
  tgMode: TgMode;
  botToken: string;
  channelId: string;
  channelUsername: string;
  personalUsername: string;
  wa360Token: string;
  igPageId: string;
  igAccessToken: string;
  websiteUrl: string;
  // Трафик напрямую в бота (2026-10-23, см. Channel.tgDirectTraffic). Необязательное: формы,
  // которые его не заполняют (classic), не отправляют поле вовсе и не сбрасывают флаг.
  directTraffic?: boolean;
}

// tgMode по умолчанию — приватный канал с заявкой (запрос пользователя 2026-08-18: "пусть
// изначально будет приватный канал выбрано") — самый частый реальный кейс использования,
// раньше по умолчанию стоял BOT_DIRECT.
export const EMPTY_CHANNEL_FORM: ChannelFormState = {
  type: 'TELEGRAM',
  name: '',
  tgMode: 'PRIVATE_CHANNEL_REQUEST',
  botToken: '',
  channelId: '',
  channelUsername: '',
  personalUsername: '',
  wa360Token: '',
  igPageId: '',
  igAccessToken: '',
  websiteUrl: '',
};

// name не входит сюда намеренно — при создании проекта имя канала берётся из имени проекта
// (см. CreateProjectDto на бэкенде), при редактировании имя канала не меняется через эту
// форму вообще. type тоже не входит: UpdateChannelDto (PATCH) явно его исключает (тип канала
// не меняется после создания), а ValidationPipe настроен с forbidNonWhitelisted:true — лишнее
// поле в теле PATCH-запроса валит ВЕСЬ запрос 400-кой. Вызывающий код сам добавляет type,
// когда он нужен (создание проекта) — см. channel: { type: form.type, ...channelFormToPayload(form) }.
export function channelFormToPayload(f: ChannelFormState) {
  return {
    tgMode: f.type === 'TELEGRAM' ? f.tgMode : undefined,
    tgBotToken: f.type === 'TELEGRAM' && f.tgMode !== 'PERSONAL_DM' ? f.botToken : undefined,
    tgChannelId: f.type === 'TELEGRAM' && f.tgMode !== 'PERSONAL_DM' ? f.channelId || undefined : undefined,
    tgChannelUsername: f.type === 'TELEGRAM' && f.tgMode !== 'PERSONAL_DM' ? f.channelUsername || undefined : undefined,
    tgPersonalUsername: f.type === 'TELEGRAM' && f.tgMode === 'PERSONAL_DM' ? f.personalUsername : undefined,
    wa360Token: f.type === 'WHATSAPP' ? f.wa360Token : undefined,
    igPageId: f.type === 'INSTAGRAM' ? f.igPageId : undefined,
    igAccessToken: f.type === 'INSTAGRAM' ? f.igAccessToken : undefined,
    websiteUrl: f.type === 'WEBSITE' ? f.websiteUrl || undefined : undefined,
    tgDirectTraffic: f.type === 'TELEGRAM' && f.tgMode === 'BOT_DIRECT' ? f.directTraffic : undefined,
  };
}

// Проверка токена бота до сохранения (запрос пользователя 2026-10-23) — POST
// /channels/check-bot-token, только getMe, ничего не сохраняет.
function BotTokenCheck({ token }: { token: string }) {
  const [state, setState] = useState<
    { status: 'idle' } | { status: 'loading' } | { status: 'ok'; username?: string; firstName: string; warning: string | null } | { status: 'error'; message: string }
  >({ status: 'idle' });
  const [checkedToken, setCheckedToken] = useState('');
  const stale = checkedToken !== token.trim();

  const check = async () => {
    const value = token.trim();
    setCheckedToken(value);
    setState({ status: 'loading' });
    try {
      const { data } = await api.post<{ username?: string; firstName: string; warning: string | null }>('/channels/check-bot-token', { token: value });
      setState({ status: 'ok', ...data });
    } catch (err) {
      setState({ status: 'error', message: (isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось проверить токен' });
    }
  };

  return (
    <div className="space-y-1.5">
      <Button type="button" size="sm" variant="outline" disabled={!token.trim() || state.status === 'loading'} onClick={check}>
        {state.status === 'loading' ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />}
        Проверить токен
      </Button>
      {!stale && state.status === 'ok' && (
        <div className="space-y-1">
          <p className="text-xs text-emerald-600 dark:text-emerald-400">
            Токен рабочий: {state.firstName}
            {state.username && ` (@${state.username})`}
          </p>
          {state.warning && (
            <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {state.warning}
            </p>
          )}
        </div>
      )}
      {!stale && state.status === 'error' && <p className="text-xs text-red-500">{state.message}</p>}
    </div>
  );
}

export function channelFormCanSubmit(f: ChannelFormState): boolean {
  return Boolean(
    f.type === 'TELEGRAM'
      ? f.tgMode === 'PERSONAL_DM'
        ? f.personalUsername
        : f.botToken && (f.tgMode === 'BOT_DIRECT' || f.channelId) && (f.tgMode !== 'PUBLIC_CHANNEL_DIRECT' || f.channelUsername)
      : f.type === 'WHATSAPP'
        ? f.wa360Token
        : f.type === 'WEBSITE'
          ? true
          : f.igPageId && f.igAccessToken,
  );
}

// Поле-секрет с возможностью раскрыть/скопировать — для редактирования уже существующего
// канала (где значение реально хранится и есть что показать), в отличие от формы создания,
// где пользователь только печатает новое значение и раскрывать пока нечего.
export function SecretField({
  id,
  label,
  value,
  onChange,
  revealable,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  revealable: boolean;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await copyToClipboard(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-1.5">
        <Input id={id} type={visible ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
        {revealable && (
          <>
            <Button type="button" size="icon" variant="outline" onClick={() => setVisible((v) => !v)}>
              {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </Button>
            <Button type="button" size="icon" variant={copied ? 'default' : 'outline'} onClick={handleCopy}>
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// Общие поля формы канала — используются и при создании проекта, и при редактировании
// существующего канала. `lockType` запрещает менять тип после создания (backend это и так
// не примет — UpdateChannelDto не включает type), `secretsRevealable` включает Eye/Copy у
// токенов (есть смысл только когда значение реально загружено с сервера, а не печатается с нуля).
export function ChannelFieldsEditor({
  value,
  onChange,
  lockType,
  secretsRevealable,
  studio,
  lockMode,
}: {
  value: ChannelFormState;
  onChange: (next: ChannelFormState) => void;
  lockType?: boolean;
  secretsRevealable?: boolean;
  // Проверка токена и трафик напрямую в бота (2026-10-23) — только в Studio, classic не трогаем.
  studio?: boolean;
  // Studio-редактирование (2026-10-24): вход с лендинга меняется только кнопкой «Сделать входом» в
  // «Подключениях» (с проверкой и откатом, ChannelsService.switchEntry), а не этим полем.
  lockMode?: boolean;
}) {
  const set = <K extends keyof ChannelFormState>(key: K, v: ChannelFormState[K]) => onChange({ ...value, [key]: v });

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="channel-type">Тип канала</Label>
        {lockType ? (
          <p className="text-sm">{CHANNEL_TYPE_LABEL[value.type]}</p>
        ) : (
          <Select value={value.type} onValueChange={(v) => v && set('type', v as ChannelType)}>
            <SelectTrigger id="channel-type">
              <SelectValue>{(v: ChannelType) => CHANNEL_TYPE_LABEL[v]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TELEGRAM">Telegram</SelectItem>
              <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
              <SelectItem value="INSTAGRAM">Instagram</SelectItem>
              <SelectItem value="WEBSITE">Website</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {value.type === 'TELEGRAM' && (
        <>
          {lockMode ? (
            <p className="text-xs text-muted-foreground">
              Вход с лендинга: <span className="font-medium text-foreground">{TG_MODE_LABEL[value.tgMode]}</span> — меняется в «Подключениях» кнопкой «Сделать входом».
            </p>
          ) : (
          <div className="space-y-1.5">
            <Label htmlFor="channel-tg-mode">Способ вступления</Label>
            <Select value={value.tgMode} onValueChange={(v) => v && set('tgMode', v as TgMode)}>
              <SelectTrigger id="channel-tg-mode">
                <SelectValue>{(v: TgMode) => TG_MODE_LABEL[v]}</SelectValue>
              </SelectTrigger>
              {/* w-auto min-w-(--anchor-width) (запрос пользователя 2026-08-18: "дропдаун
                  сломан визуально, не помещается текст каждой опции") — дефолт SelectContent
                  без className растягивается строго под триггер (w-(--anchor-width)), в неё не
                  влезали длинные подписи вроде "Приватный канал (заявка)"; тот же фикс уже
                  применён в create-landing-dialog.tsx/landing-content-card.tsx для той же
                  проблемы. */}
              <SelectContent className="w-auto min-w-(--anchor-width)">
                {(Object.keys(TG_MODE_LABEL) as TgMode[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {TG_MODE_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{TG_MODE_HINT[value.tgMode]}</p>
          </div>
          )}

          {value.tgMode === 'PERSONAL_DM' ? (
            <div className="space-y-1.5">
              <Label htmlFor="channel-personal-username">Username личного аккаунта</Label>
              <Input
                id="channel-personal-username"
                value={value.personalUsername}
                onChange={(e) => set('personalUsername', e.target.value)}
                placeholder="@myusername"
              />
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Создайте бота через @BotFather
                {value.tgMode !== 'BOT_DIRECT' && ', добавьте его администратором в ваш канал'}, вставьте токен ниже.
              </p>
              <SecretField
                id="channel-bot-token"
                label="Bot Token"
                value={value.botToken}
                onChange={(v) => set('botToken', v)}
                revealable={!!secretsRevealable}
                placeholder="123456:ABC-..."
              />
              {studio && <BotTokenCheck token={value.botToken} />}
              {/* Переключатель «Реклама ведёт прямо в бота» (2026-10-23) переехал во вкладку «Воронка»
                  (2026-10-24, вариант «Каждый, кто нажал Start»). directTraffic по-прежнему уходит
                  в PATCH неизменённым, так что сохранение канала флаг не сбрасывает. */}
              <div className="space-y-1.5">
                <Label htmlFor="channel-id">
                  Channel ID (числовой){value.tgMode === 'BOT_DIRECT' ? ', опционально' : ''}
                </Label>
                <Input id="channel-id" value={value.channelId} onChange={(e) => set('channelId', e.target.value)} placeholder="-1001234567890" />
              </div>
              {(value.tgMode === 'PUBLIC_CHANNEL_DIRECT' || lockMode) && (
                <div className="space-y-1.5">
                  <Label htmlFor="channel-username">
                    Публичный username канала{value.tgMode !== 'PUBLIC_CHANNEL_DIRECT' ? ' (если канал публичный)' : ''}
                  </Label>
                  <Input
                    id="channel-username"
                    value={value.channelUsername}
                    onChange={(e) => set('channelUsername', e.target.value)}
                    placeholder="@mychannel"
                  />
                </div>
              )}
            </>
          )}
        </>
      )}

      {value.type === 'WHATSAPP' && (
        <>
          <p className="text-xs text-muted-foreground">
            Подключите номер к 360dialog (BSP для WhatsApp Cloud API), вставьте API-ключ канала ниже —
            вебхук в 360dialog мы зарегистрируем автоматически.
          </p>
          <SecretField
            id="channel-wa360-token"
            label="360dialog API Key"
            value={value.wa360Token}
            onChange={(v) => set('wa360Token', v)}
            revealable={!!secretsRevealable}
            placeholder="D360-API-KEY"
          />
        </>
      )}

      {value.type === 'INSTAGRAM' && (
        <>
          <p className="text-xs text-muted-foreground">
            Нужна Facebook Page, привязанная к Instagram Professional аккаунту, и Page Access
            Token с правом instagram_manage_messages. Подписку Page на вебхуки мы оформим
            автоматически — единый Callback URL для всех Instagram-каналов настраивается один
            раз в Meta App Dashboard (см. README/доку по интеграции).
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="channel-ig-page-id">Facebook Page ID</Label>
            <Input id="channel-ig-page-id" value={value.igPageId} onChange={(e) => set('igPageId', e.target.value)} />
          </div>
          <SecretField
            id="channel-ig-token"
            label="Page Access Token"
            value={value.igAccessToken}
            onChange={(v) => set('igAccessToken', v)}
            revealable={!!secretsRevealable}
          />
        </>
      )}

      {value.type === 'WEBSITE' && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="channel-website-url">Адрес сайта</Label>
            <Input
              id="channel-website-url"
              placeholder="https://example.com"
              value={value.websiteUrl}
              onChange={(e) => set('websiteUrl', e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Можно указать сейчас или позже. После сохранения зайдите во вкладку «Каналы» и
            подключите SDK-скрипт (track.js) к сайту — там же можно проверить, что скрипт
            установлен и работает.
          </p>
        </>
      )}
    </>
  );
}
