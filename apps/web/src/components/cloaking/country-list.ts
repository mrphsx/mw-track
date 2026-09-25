// Полный список кодов ISO 3166-1 alpha-2 (запрос пользователя 2026-09-25: "подсказки при вводе
// для страны") — сами коды не меняются, поэтому статический массив, а не запрос к бэкенду.
// Названия НЕ хардкодятся отдельным словарём — Intl.DisplayNames(['ru'], {type:'region'}),
// встроенный в браузер API, всегда даёт актуальное официальное русское название без единой
// строки на нашей стороне и без сетевого запроса.
export const COUNTRY_CODES = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
  'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
  'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE',
  'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF',
  'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
  'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM',
  'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC',
  'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
  'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
  'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG',
  'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
  'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO',
  'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
  'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
];

let regionNamesRu: Intl.DisplayNames | null = null;
let regionNamesEn: Intl.DisplayNames | null = null;
function getRegionNames(locale: 'ru' | 'en'): Intl.DisplayNames | null {
  try {
    if (locale === 'ru') return (regionNamesRu ??= new Intl.DisplayNames(['ru'], { type: 'region' }));
    return (regionNamesEn ??= new Intl.DisplayNames(['en'], { type: 'region' }));
  } catch {
    return null;
  }
}

export function countryLabel(code: string): string {
  const name = getRegionNames('ru')?.of(code);
  return name && name !== code ? `${name} (${code})` : code;
}

// Английское название — не для отображения, а чтобы поиск находил страну при вводе на
// английском (запрос пользователя 2026-09-25: "чтобы находилось даже если вбиваем на
// английском, сейчас только по русским находит") — см. keywords в SearchableMultiSelect.
function countryEnglishName(code: string): string | null {
  const name = getRegionNames('en')?.of(code);
  return name && name !== code ? name : null;
}

export const COUNTRY_OPTIONS = COUNTRY_CODES.map((code) => {
  const en = countryEnglishName(code);
  return { value: code, label: countryLabel(code), keywords: en ? [en] : [] };
});
