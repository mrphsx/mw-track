import { Channel, Client } from '@prisma/client';

export interface SendMessageOptions {
  text: string;
  mediaUrl?: string;
  mediaType?: 'photo' | 'video' | 'document';
  buttons?: Array<{ text: string; url?: string; callbackData?: string }>;
  parseMode?: 'HTML' | 'Markdown';
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
  sendMessage(channelUserId: string, options: SendMessageOptions, channel: Channel): Promise<boolean>;

  // Получить статус пользователя
  getUserStatus(channelUserId: string): Promise<UserStatus>;

  // Одобрить вступление (для Telegram)
  approveJoinRequest?(userId: string): Promise<void>;

  // Отклонить вступление
  declineJoinRequest?(userId: string): Promise<void>;

  // Получить информацию о пользователе
  getUserInfo?(channelUserId: string): Promise<Partial<Client>>;
}
