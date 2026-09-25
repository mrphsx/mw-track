// Список языков (запрос пользователя 2026-09-25) — ISO 639-1 коды, ровно то, что уже сравнивает
// LanguageConditionEvaluator на бэкенде (первый язык из Accept-Language, приведённый к нижнему
// регистру) — безопасно использовать без изменений, в отличие от списков ОС/устройств выше:
// здесь нет стороннего normalization-слоя (ua-parser-js), который мог бы называть язык иначе.
const RAW_LANGUAGES = [
  { value: 'ab', label: 'Абхазский' }, { value: 'af', label: 'Африканский' }, { value: 'am', label: 'Амхарский' },
  { value: 'an', label: 'Арагонский' }, { value: 'ar', label: 'Арабский' }, { value: 'as', label: 'Асамский' },
  { value: 'az', label: 'Азербайджанский' }, { value: 'be', label: 'Белорусский' }, { value: 'bg', label: 'Болгарский' },
  { value: 'bn', label: 'Бенгальский' }, { value: 'bo', label: 'Тибетский' }, { value: 'br', label: 'Бретонский' },
  { value: 'bs', label: 'Боснийский' }, { value: 'ca', label: 'Каталонский' }, { value: 'ce', label: 'Чеченский' },
  { value: 'co', label: 'Корсиканский' }, { value: 'cs', label: 'Чешский' }, { value: 'cu', label: 'Церковнославянский' },
  { value: 'cy', label: 'Валлийский' }, { value: 'da', label: 'Датский' }, { value: 'de', label: 'Немецкий' },
  { value: 'dv', label: 'Мальдивский' }, { value: 'el', label: 'Греческий' }, { value: 'en', label: 'Английский' },
  { value: 'eo', label: 'Эсперанто' }, { value: 'es', label: 'Испанский' }, { value: 'et', label: 'Эстонский' },
  { value: 'eu', label: 'Баскский' }, { value: 'fa', label: 'Персидский' }, { value: 'fi', label: 'Финский' },
  { value: 'fj', label: 'Фиджийский' }, { value: 'fl', label: 'Филиппинский' }, { value: 'fo', label: 'Фарерский' },
  { value: 'fr', label: 'Французский' }, { value: 'fy', label: 'Фризийский' }, { value: 'ga', label: 'Ирландский' },
  { value: 'gd', label: 'Шотландский' }, { value: 'gl', label: 'Галисийский' }, { value: 'gn', label: 'Гуарани' },
  { value: 'gv', label: 'Мэнский' }, { value: 'gu', label: 'Гуджарати' }, { value: 'ha', label: 'Хауса' },
  { value: 'he', label: 'Иврит' }, { value: 'hi', label: 'Хинди' }, { value: 'hr', label: 'Хорватский' },
  { value: 'ht', label: 'Гаитянский' }, { value: 'hu', label: 'Венгерский' }, { value: 'hy', label: 'Армянский' },
  { value: 'id', label: 'Индонезийский' }, { value: 'ig', label: 'Игбо' }, { value: 'is', label: 'Исландский' },
  { value: 'it', label: 'Итальянский' }, { value: 'ja', label: 'Японский' }, { value: 'jv', label: 'Яванский' },
  { value: 'ka', label: 'Грузинский' }, { value: 'kg', label: 'Конголезский' }, { value: 'kn', label: 'Каннада' },
  { value: 'km', label: 'Кхмерский' }, { value: 'kk', label: 'Казахский' }, { value: 'ko', label: 'Корейский' },
  { value: 'ku', label: 'Курдский' }, { value: 'kw', label: 'Корнский' }, { value: 'ky', label: 'Киргизский' },
  { value: 'la', label: 'Латинский' }, { value: 'lb', label: 'Люксембургский' }, { value: 'li', label: 'Лимбургский' },
  { value: 'ln', label: 'Лингала' }, { value: 'lo', label: 'Лаосский' }, { value: 'lt', label: 'Литовский' },
  { value: 'lv', label: 'Латышский' }, { value: 'mg', label: 'Малагасийский' }, { value: 'mk', label: 'Македонский' },
  { value: 'ml', label: 'Малаялам' }, { value: 'mn', label: 'Монгольский' }, { value: 'mo', label: 'Молдавский' },
  { value: 'mr', label: 'Маратхи' }, { value: 'ms', label: 'Малайский' }, { value: 'mt', label: 'Мальтийский' },
  { value: 'my', label: 'Бирманский' }, { value: 'nb', label: 'Норвежский (букмол)' }, { value: 'ne', label: 'Непальский' },
  { value: 'nl', label: 'Голландский' }, { value: 'nn', label: 'Норвежский (нюнорск)' }, { value: 'no', label: 'Норвежский' },
  { value: 'ns', label: 'Северный сото' }, { value: 'oc', label: 'Окситанский' }, { value: 'or', label: 'Ория' },
  { value: 'pa', label: 'Панджаби' }, { value: 'pl', label: 'Польский' }, { value: 'ps', label: 'Пушту' },
  { value: 'pt', label: 'Португальский' }, { value: 'rm', label: 'Ретороманский' }, { value: 'ro', label: 'Румынский' },
  { value: 'ru', label: 'Русский' }, { value: 'rw', label: 'Руандийский' }, { value: 'sc', label: 'Сардинский' },
  { value: 'se', label: 'Северносаамский' }, { value: 'si', label: 'Сингальский' }, { value: 'sk', label: 'Словацкий' },
  { value: 'sl', label: 'Словенский' }, { value: 'so', label: 'Сомалийский' }, { value: 'sq', label: 'Албанский' },
  { value: 'sr', label: 'Сербский' }, { value: 'ss', label: 'Свати' }, { value: 'st', label: 'Южный сото' },
  { value: 'sv', label: 'Шведский' }, { value: 'sw', label: 'Суахили' }, { value: 'ta', label: 'Тамильский' },
  { value: 'te', label: 'Телугу' }, { value: 'tk', label: 'Туркменский' }, { value: 'th', label: 'Тайский' },
  { value: 'tg', label: 'Таджикский' }, { value: 'tn', label: 'Тсвана' }, { value: 'tl', label: 'Тагальский' },
  { value: 'ts', label: 'Тсонга' }, { value: 'tr', label: 'Турецкий' }, { value: 'ty', label: 'Таитянский' },
  { value: 'ug', label: 'Уйгурский' }, { value: 'uk', label: 'Украинский' }, { value: 'ur', label: 'Урду' },
  { value: 'uz', label: 'Узбекский' }, { value: 've', label: 'Венда' }, { value: 'vi', label: 'Вьетнамский' },
  { value: 'vo', label: 'Волапюк' }, { value: 'xh', label: 'Коса' }, { value: 'yi', label: 'Идиш' },
  { value: 'yo', label: 'Йоруба' }, { value: 'za', label: 'Чжуанский' }, { value: 'zh', label: 'Китайский' },
  { value: 'zu', label: 'Зулу' },
];

// Английское название языка — только для поиска (та же причина, что и у country-list.ts:
// "чтобы находилось даже если вбиваем на английском"), не для отображения.
let languageNamesEn: Intl.DisplayNames | null = null;
function languageEnglishName(code: string): string | null {
  try {
    languageNamesEn ??= new Intl.DisplayNames(['en'], { type: 'language' });
    const name = languageNamesEn.of(code);
    return name && name.toLowerCase() !== code.toLowerCase() ? name : null;
  } catch {
    return null;
  }
}

export const LANGUAGE_OPTIONS = RAW_LANGUAGES.map(({ value, label }) => {
  const en = languageEnglishName(value);
  return { value, label, keywords: en ? [en] : [] };
});
