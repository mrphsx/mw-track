import { BotScenarioTrigger, Channel, Client } from '@prisma/client';

export interface SendMessageOptions {
  text: string;
  mediaUrl?: string;
  // video_note — "кружок" (круглое видео-сообщение Telegram); voice — голосовое (ogg/opus).
  // Telegram API не поддерживает caption у video_note — см. TelegramProvider.sendMessage,
  // текст в этом случае уходит отдельным сообщением следом.
  mediaType?: 'photo' | 'video' | 'video_note' | 'voice' | 'document';
  // Альбом (Telegram media group, 2-10 элементов, только photo/video) — запрос пользователя
  // 2026-07-17 "как загрузить больше медиа в одну рассылку". mediaUrl/mediaType выше всегда
  // дублируют первый элемент этого массива (когда он есть) — провайдеры, не умеющие в альбомы
  // (WhatsApp/Instagram), просто не читают это поле и шлют один файл через обычный путь,
  // деградация автоматическая, без doп. кода в тех провайдерах.
  mediaGroup?: Array<{ type: 'photo' | 'video'; url: string }>;
  buttons?: Array<{ text: string; url?: string; callbackData?: string }>;
  parseMode?: 'HTML' | 'Markdown';
}

// Причина неудачи наружу (запрос пользователя 2026-07-17: "добавь логи ошибок при открытии
// рассылки") — раньше провайдеры возвращали голый boolean, реальный текст ошибки Telegram/
// WhatsApp/Instagram терялся, доходя только до pm2-логов; PushLog.error писал одинаковое
// "send failed" на любую причину. Теперь ошибка доносится до PushLog и видна в самой рассылке.
export interface SendMessageResult {
  success: boolean;
  error?: string;
}

export interface BroadcastResult {
  totalSent: number;
  totalFailed: number;
  failedUserIds: string[];
}

export interface UserStatus {
  isReachable: boolean; // можно отправить сообщение
  isSubscribed: boolean; // состоит в канале/списке
}

export interface ChannelProvider {
  // Инициализация (регистрация webhook и т.д.)
  initialize(channel: Channel): Promise<void>;

  // Отправить сообщение одному пользователю
  sendMessage(channelUserId: string, options: SendMessageOptions, channel: Channel): Promise<SendMessageResult>;

  // Получить статус пользователя
  getUserStatus(channelUserId: string): Promise<UserStatus>;

  // Одобрить вступление (для Telegram)
  approveJoinRequest?(userId: string): Promise<void>;

  // Отклонить вступление
  declineJoinRequest?(userId: string): Promise<void>;

  // Получить информацию о пользователе
  getUserInfo?(channelUserId: string): Promise<Partial<Client>>;

  // Сценарии бота (команды/депозит/повторный депозит/отписка/дефолт) — реализовано только
  // в TelegramProvider (см. BotScenario в schema.prisma), остальные провайдеры её не имеют,
  // как и approveJoinRequest/declineJoinRequest уже опциональны здесь же.
  triggerScenario?(channelUserId: string, channel: Channel, triggerType: BotScenarioTrigger, command?: string): Promise<void>;
}
