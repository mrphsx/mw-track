import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Перевод сообщений встроенного чата (запрос пользователя 2026-10-24). Сервис перевода — за
// интерфейсом TranslationProvider: сейчас DeepL (DEEPL_API_KEY), Claude подключится вторым
// провайдером без изменений в чате — выбор по TRANSLATION_PROVIDER.

export interface TranslationResult {
  text: string;
  // Язык оригинала, как его определил сервис (код в нижнем регистре: 'es', 'pt' и т.п.).
  from: string | null;
}

interface TranslationProvider {
  readonly name: string;
  translate(texts: string[], target: string): Promise<TranslationResult[]>;
}

// Языки, которые предлагает интерфейс чата. Ключ — наш код, значение — код цели DeepL
// (английский и португальский DeepL принимает только с вариантом).
export const TRANSLATION_LANGUAGES: Record<string, string> = {
  ru: 'RU',
  en: 'EN-US',
  es: 'ES',
  pt: 'PT-BR',
  uk: 'UK',
  de: 'DE',
  fr: 'FR',
  it: 'IT',
  tr: 'TR',
  pl: 'PL',
  id: 'ID',
  zh: 'ZH',
};

class DeepLProvider implements TranslationProvider {
  readonly name = 'deepl';
  constructor(private apiKey: string) {}

  async translate(texts: string[], target: string): Promise<TranslationResult[]> {
    // Ключи бесплатного плана заканчиваются на ":fx" и работают только через api-free.
    const host = this.apiKey.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
    const res = await fetch(`${host}/v2/translate`, {
      method: 'POST',
      headers: { Authorization: `DeepL-Auth-Key ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texts, target_lang: TRANSLATION_LANGUAGES[target] }),
    });
    if (res.status === 403) throw new ServiceUnavailableException('Сервис перевода не принял ключ — проверьте DEEPL_API_KEY');
    if (res.status === 456) throw new ServiceUnavailableException('Месячный лимит перевода DeepL исчерпан');
    if (res.status === 429) throw new ServiceUnavailableException('Слишком много запросов на перевод — попробуйте через несколько секунд');
    if (!res.ok) throw new ServiceUnavailableException(`Сервис перевода ответил ошибкой ${res.status}`);
    const body = (await res.json()) as { translations: { detected_source_language?: string; text: string }[] };
    return body.translations.map((t) => ({ text: t.text, from: t.detected_source_language?.toLowerCase() ?? null }));
  }
}

@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);
  private readonly provider: TranslationProvider | null;

  constructor(config: ConfigService) {
    const deeplKey = config.get<string>('DEEPL_API_KEY');
    const preferred = config.get<string>('TRANSLATION_PROVIDER') ?? 'deepl';
    this.provider = preferred === 'deepl' && deeplKey ? new DeepLProvider(deeplKey.trim()) : null;
  }

  get enabled(): boolean {
    return !!this.provider;
  }

  async translate(text: string, target: string): Promise<TranslationResult> {
    if (!this.provider) throw new ServiceUnavailableException('Перевод не настроен — нужен ключ сервиса перевода на сервере');
    if (!TRANSLATION_LANGUAGES[target]) throw new BadRequestException('Этот язык перевода не поддерживается');
    const trimmed = text.trim();
    if (!trimmed) throw new BadRequestException('Нечего переводить');
    if (trimmed.length > 5000) throw new BadRequestException('Слишком длинный текст для перевода');
    try {
      const [result] = await this.provider.translate([trimmed], target);
      return result;
    } catch (error) {
      this.logger.warn(`translate via ${this.provider.name} failed: ${(error as Error).message}`);
      throw error;
    }
  }
}
