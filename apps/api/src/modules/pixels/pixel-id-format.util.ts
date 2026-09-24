import { BadRequestException } from '@nestjs/common';
import { PixelPlatform } from '@prisma/client';

// Проверка, что ID пикселя похож на ID своей платформы (запрос пользователя 2026-09-17). Найдено на
// боевых данных: 12 активных пикселей были заведены как Facebook с ID формата TikTok
// ("D9QFQU3C77U97D5QCT70"). Facebook отвечал на каждое событие "Invalid OAuth access token —
// Cannot parse access token", и события не доходили ни до Facebook, ни до TikTok — тысячи
// отказов за месяц, незаметных в интерфейсе.
//
// Формат: ID пикселя Facebook (dataset id) — только цифры; код пикселя TikTok — латиница в
// верхнем регистре вместе с цифрами. Проверка намеренно грубая — ловит именно перепутанную
// платформу, а не пытается полностью описать формат каждой из них.
const FACEBOOK_PIXEL_ID = /^\d{10,20}$/;
const DIGITS_ONLY = /^\d+$/;

export function assertPixelIdMatchesPlatform(platform: PixelPlatform, rawPixelId: string): void {
  const pixelId = rawPixelId.trim();
  if (platform === 'FACEBOOK' && !FACEBOOK_PIXEL_ID.test(pixelId)) {
    const looksLikeTikTok = /^[A-Z0-9]{15,30}$/.test(pixelId) && /[A-Z]/.test(pixelId);
    throw new BadRequestException(
      looksLikeTikTok
        ? 'Этот ID похож на код пикселя TikTok. Для него выберите платформу TikTok — ID пикселя Facebook состоит только из цифр.'
        : 'ID пикселя Facebook состоит только из цифр (10–20 знаков). Скопируйте его в Events Manager → Источники данных.',
    );
  }
  if (platform === 'TIKTOK' && DIGITS_ONLY.test(pixelId)) {
    throw new BadRequestException(
      'Этот ID похож на пиксель Facebook (только цифры). Для него выберите платформу Facebook — код пикселя TikTok содержит буквы.',
    );
  }
}
