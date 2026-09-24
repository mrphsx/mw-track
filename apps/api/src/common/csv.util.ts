// Общий CSV-билдер (запрос пользователя 2026-09-08: "добавить возможность скачивать таблицы
// статистики") — единственный существующий экспорт до этого (ClientsService.exportForLookalike,
// Lookalike CSV) оборачивал каждое значение в кавычки без экранирования внутренних кавычек
// (`"${v}"` — сломается на реальном значении, содержащем кавычку); для более широких экспортов
// (полные данные клиента, статистика проекта) это уже реальный риск, а не гипотетический —
// имена/города/названия кампаний вполне могут содержать запятые/кавычки. `\r\n` — построчный
// разделитель по спецификации CSV (RFC 4180), так Excel гарантированно не путает переносы строк.
function escapeCsvValue(value: string | number | boolean | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsvRow(values: Array<string | number | boolean | null | undefined>): string {
  return values.map(escapeCsvValue).join(',');
}

export function buildCsv(headers: string[], rows: Array<Array<string | number | boolean | null | undefined>>): string {
  return [buildCsvRow(headers), ...rows.map(buildCsvRow)].join('\r\n');
}

// BOM (запрос пользователя 2026-09-08, live-проверено) — без него Excel определяет кодировку
// эвристически и часто выбирает не UTF-8, превращая кириллицу (имена/города клиентов, названия
// колонок) в нечитаемые символы. Добавляется только в новых, более широких экспортах этой
// функцией — не трогаем уже работающий exportForLookalike (Facebook принимает его как есть,
// трогать формат уже интегрированного экспорта без необходимости — лишний риск).
export function withUtf8Bom(csv: string): string {
  return '﻿' + csv;
}
