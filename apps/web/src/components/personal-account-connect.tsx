'use client';

// Подключение личного Telegram-аккаунта через MTProto (запрос пользователя 2026-07-04,
// "диалоги с клиентами", расширено 2026-07-17 на каналы любого режима — не только PERSONAL_DM,
// бот при наличии продолжает вести подписчиков как обычно) — пошаговый мастер: номер → код →
// (если включена 2FA) пароль → статус "подключён". Явное предупреждение о риске для аккаунта
// перед первым шагом.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ChannelPersonalInfo {
  tgPersonalConnected: boolean;
  tgPersonalPhone: string | null;
}

type Step = 'risk' | 'phone' | 'code' | 'password';

export function PersonalAccountConnect({ channelId }: { channelId: string }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('risk');
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const { data: info } = useQuery({
    queryKey: ['channel', channelId, 'personal'],
    queryFn: async () => (await api.get<ChannelPersonalInfo>(`/channels/${channelId}`)).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['channel', channelId, 'personal'] });

  const startConnect = useMutation({
    mutationFn: () => api.post(`/channels/${channelId}/personal-connect/start`, { phone }),
    onSuccess: () => {
      setStep('code');
      setError('');
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось отправить код'),
  });

  const submitCode = useMutation({
    mutationFn: () => api.post<{ needsPassword: boolean; connected: boolean }>(`/channels/${channelId}/personal-connect/code`, { code }),
    onSuccess: ({ data }) => {
      setError('');
      if (data.needsPassword) {
        setStep('password');
        return;
      }
      resetWizard();
      invalidate();
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Неверный код'),
  });

  const submitPassword = useMutation({
    mutationFn: () => api.post(`/channels/${channelId}/personal-connect/password`, { password }),
    onSuccess: () => {
      resetWizard();
      invalidate();
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Неверный пароль'),
  });

  const disconnect = useMutation({
    mutationFn: () => api.delete(`/channels/${channelId}/personal-connect`),
    onSuccess: () => invalidate(),
  });

  const resetWizard = () => {
    setStep('risk');
    setRiskAccepted(false);
    setPhone('');
    setCode('');
    setPassword('');
  };

  if (!info) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Личный аккаунт (диалоги)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {info.tgPersonalConnected ? (
          <div className="flex items-center justify-between">
            <div>
              <Badge>Подключён</Badge>
              {info.tgPersonalPhone && <span className="text-sm text-gray-500 ml-2">{info.tgPersonalPhone}</span>}
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={disconnect.isPending}
              onClick={() => {
                if (confirm('Отключить личный аккаунт? Диалоги перестанут учитываться.')) disconnect.mutate();
              }}
            >
              Отключить
            </Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500">
              Чтобы CRM видела диалоги с клиентами в личных сообщениях, нужно подключить сам
              аккаунт (не бота) — вход по номеру телефона, как в обычном Telegram-клиенте.
            </p>

            {step === 'risk' && (
              <div className="space-y-3 border rounded-md p-3 bg-amber-50">
                <div className="flex gap-2 text-sm text-amber-800">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>
                    Telegram не гарантирует сохранность аккаунтов, подключённых через сторонние
                    приложения (не через официальный клиент) — возможны ограничения со стороны
                    Telegram. Мы читаем только входящие сообщения, ничего не отправляем и не
                    меняем от имени аккаунта. Ответственность за возможные последствия для
                    аккаунта — на вас.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={riskAccepted} onCheckedChange={setRiskAccepted} />
                  Понимаю и принимаю риск
                </label>
                <Button size="sm" disabled={!riskAccepted} onClick={() => setStep('phone')}>
                  Продолжить
                </Button>
              </div>
            )}

            {step === 'phone' && (
              <div className="space-y-2">
                <Label htmlFor="pa-phone">Номер телефона</Label>
                <Input id="pa-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+79991234567" />
                {error && <p className="text-sm text-red-500">{error}</p>}
                <Button size="sm" disabled={!phone || startConnect.isPending} onClick={() => startConnect.mutate()}>
                  {startConnect.isPending ? 'Отправляем код...' : 'Получить код'}
                </Button>
              </div>
            )}

            {step === 'code' && (
              <div className="space-y-2">
                <Label htmlFor="pa-code">Код из Telegram</Label>
                <Input id="pa-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="12345" />
                {error && <p className="text-sm text-red-500">{error}</p>}
                <Button size="sm" disabled={!code || submitCode.isPending} onClick={() => submitCode.mutate()}>
                  {submitCode.isPending ? 'Проверяем...' : 'Подтвердить'}
                </Button>
              </div>
            )}

            {step === 'password' && (
              <div className="space-y-2">
                <Label htmlFor="pa-password">Пароль двухфакторной аутентификации</Label>
                <Input id="pa-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                {error && <p className="text-sm text-red-500">{error}</p>}
                <Button size="sm" disabled={!password || submitPassword.isPending} onClick={() => submitPassword.mutate()}>
                  {submitPassword.isPending ? 'Проверяем...' : 'Подтвердить'}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
