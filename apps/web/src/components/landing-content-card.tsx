'use client';

// Контент лендинга (запрос пользователя 2026-07-04): название/описание канала, текст кнопки,
// число подписчиков (по умолчанию — реальное число из канала, дальше редактируется вручную) и
// своя аватарка (по умолчанию — фото канала, можно заменить загрузкой). Только для TEMPLATE —
// у CUSTOM/EXTERNAL лендингов нет templateData вообще (см. LandingsService.processZipUpload).

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { UploadCloud, X } from 'lucide-react';
import { api, API_BASE_URL } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  SUBSCRIBERS_LABEL_PRESETS,
  SUBSCRIBERS_LABEL_CUSTOM_VALUE as CUSTOM_VALUE,
} from '@/lib/landings';

interface LandingContentFull {
  id: string;
  avatarKey: string | null;
  templateData: {
    CHANNEL_TITLE?: string;
    CHANNEL_DESCRIPTION?: string;
    JOIN_BUTTON_TEXT?: string;
    SUBSCRIBERS_COUNT?: string;
    SUBSCRIBERS_LABEL?: string;
  } | null;
}

export function LandingContentCard({
  landingId,
  channelMembersCount,
}: {
  landingId: string;
  channelMembersCount: number | null;
}) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['landing', landingId, 'full'] });

  const { data: landing } = useQuery({
    queryKey: ['landing', landingId, 'full'],
    queryFn: async () => (await api.get<LandingContentFull>(`/landings/${landingId}`)).data,
  });

  const [channelTitle, setChannelTitle] = useState('');
  const [channelDescription, setChannelDescription] = useState('');
  const [buttonText, setButtonText] = useState('');
  const [subscribersCount, setSubscribersCount] = useState('');
  const [subscribersLabel, setSubscribersLabel] = useState('подписчиков');
  // Отдельно от subscribersLabel — иначе выбор "Свой вариант" в дропдауне, пока текущее слово
  // случайно совпадает с одним из пресетов, не показал бы поле ввода (Select тут же откатился
  // бы обратно на пресет, см. isPresetLabel ниже).
  const [useCustomLabel, setUseCustomLabel] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!landing) return;
    const d = landing.templateData || {};
    setChannelTitle(d.CHANNEL_TITLE || '');
    setChannelDescription(d.CHANNEL_DESCRIPTION || '');
    setButtonText(d.JOIN_BUTTON_TEXT || '');
    setSubscribersCount(d.SUBSCRIBERS_COUNT || '');
    const label = d.SUBSCRIBERS_LABEL || 'подписчиков';
    setSubscribersLabel(label);
    setUseCustomLabel(!SUBSCRIBERS_LABEL_PRESETS.some((p) => p.value === label));
  }, [landing]);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/landings/${landingId}`, {
        channelTitle,
        channelDescription,
        buttonText,
        subscribersCount,
        subscribersLabel,
      }),
    onSuccess: () => {
      invalidate();
      setError('');
    },
    onError: (err) =>
      setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить'),
  });

  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadAvatar = useMutation({
    mutationFn: async () => {
      if (!avatarFile) return;
      const formData = new FormData();
      formData.append('file', avatarFile);
      await api.post(`/landings/${landingId}/avatar`, formData);
    },
    onSuccess: () => {
      invalidate();
      setAvatarFile(null);
      setError('');
    },
    onError: (err) =>
      setError(
        (isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось загрузить файл',
      ),
  });

  const removeAvatar = useMutation({
    mutationFn: () => api.delete(`/landings/${landingId}/avatar`),
    onSuccess: () => invalidate(),
  });

  if (!landing) return null;

  // /landings/:id/avatar публичный и всегда отдаёт что-то осмысленное (своя аватарка либо
  // фото канала как дефолт) — можно просто <img src>, без blob-фетча с авторизацией, как у
  // ChannelAvatar (та привязана к закрытому /channels/:id/avatar).
  // ?v= — баг-фикс 2026-07-27 ("при загрузке аватарки она не обновляется"): без версии URL не
  // менялся между загрузками, а бэкенд отдаёт Cache-Control: max-age=86400 — браузер держал
  // старую картинку в кэше сутки. avatarKey меняется на каждую загрузку (см.
  // LandingsService.uploadAvatar), готовый версионирующий токен.
  const avatarPreviewUrl = `${API_BASE_URL}/landings/${landingId}/avatar?v=${encodeURIComponent(landing.avatarKey || 'channel')}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Контент лендинга</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Аватарка</Label>
          <div className="flex items-center gap-3">
            <img
              src={avatarPreviewUrl}
              alt=""
              className="w-16 h-16 rounded-full object-cover bg-muted shrink-0"
              onError={(e) => {
                (e.target as HTMLImageElement).style.visibility = 'hidden';
              }}
            />
            <div className="flex-1 space-y-2">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) setAvatarFile(file);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-3 text-center text-xs cursor-pointer transition-colors ${
                  dragOver
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                    : 'border-border text-muted-foreground hover:border-muted-foreground'
                }`}
              >
                <UploadCloud className="w-4 h-4 mx-auto mb-1" />
                {avatarFile ? avatarFile.name : 'Перетащите фото сюда или нажмите для выбора'}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && setAvatarFile(e.target.files[0])}
                />
              </div>
              <div className="flex items-center gap-2">
                {avatarFile && (
                  <Button
                    size="sm"
                    onClick={() => uploadAvatar.mutate()}
                    disabled={uploadAvatar.isPending}
                  >
                    {uploadAvatar.isPending ? 'Загружаем...' : 'Загрузить'}
                  </Button>
                )}
                {landing.avatarKey && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeAvatar.mutate()}
                    disabled={removeAvatar.isPending}
                  >
                    <X className="w-3.5 h-3.5 mr-1" /> Убрать свою (вернуть фото канала)
                  </Button>
                )}
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Пока своя не загружена — показывается фото канала.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="content-title">Название канала (на лендинге)</Label>
          <Input
            id="content-title"
            value={channelTitle}
            onChange={(e) => setChannelTitle(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="content-description">Описание</Label>
          <Textarea
            id="content-description"
            rows={3}
            value={channelDescription}
            onChange={(e) => setChannelDescription(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="content-button">Текст кнопки</Label>
          <Input
            id="content-button"
            value={buttonText}
            onChange={(e) => setButtonText(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="content-subscribers">Количество подписчиков (на лендинге)</Label>
          <div className="flex items-center gap-2">
            <Input
              id="content-subscribers"
              value={subscribersCount}
              onChange={(e) => setSubscribersCount(e.target.value)}
              className="max-w-40"
            />
            {channelMembersCount != null && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSubscribersCount(String(channelMembersCount))}
              >
                Как в канале ({channelMembersCount})
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            При создании лендинга подставляется текущее число участников канала — дальше можно
            менять вручную.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="content-subscribers-label">
            Слово &quot;подписчиков&quot; на лендинге
          </Label>
          <Select
            value={useCustomLabel ? CUSTOM_VALUE : subscribersLabel}
            onValueChange={(v) => {
              if (!v) return;
              if (v === CUSTOM_VALUE) {
                setUseCustomLabel(true);
              } else {
                setUseCustomLabel(false);
                setSubscribersLabel(v);
              }
            }}
          >
            <SelectTrigger id="content-subscribers-label">
              <SelectValue />
            </SelectTrigger>
            {/* Дефолт SelectContent — ширина строго под триггер (w-(--anchor-width)), длинные
                варианты вида "Русский — «подписчиков»" в неё не влезали. w-auto растягивает
                под самый широкий пункт, min-w сохраняет минимум в ширину триггера. */}
            <SelectContent className="w-auto min-w-(--anchor-width)">
              {SUBSCRIBERS_LABEL_PRESETS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM_VALUE}>Свой вариант</SelectItem>
            </SelectContent>
          </Select>
          {useCustomLabel && (
            <Input
              value={subscribersLabel}
              onChange={(e) => setSubscribersLabel(e.target.value)}
              placeholder="Своё слово"
              className="max-w-60"
            />
          )}
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Сохраняем...' : 'Сохранить'}
        </Button>
      </CardContent>
    </Card>
  );
}
