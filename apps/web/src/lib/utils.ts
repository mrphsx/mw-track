import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Хвост id сущности (Project/Landing — оба cuid, см. prisma/schema.prisma) — короткий, но
// достаточно уникальный код для URL. Названия не годятся для пути: меняются при переименовании,
// могут быть на кириллице, и сам путь в адресной строке не должен раскрывать название
// проекта/лендинга постороннему. id уже гарантированно уникален и стабилен, поэтому используем
// его хвост вместо слага из имени.
export function shortCode(id: string, length = 8): string {
  return id.slice(-length);
}

// Путь по умолчанию для привязки лендинга к домену — /project-code/landing-code. При коллизии
// с уже занятым на этом домене путём (DomainPath уникален по domainId+path, см. схему) добавляем
// -2, -3... тем же способом, что и AuthService.generateUniqueSlug для Company.slug на бэкенде.
// Используется и со страницы /domains (диалог путей), и со страницы лендингов (привязка домена
// к лендингу) — оба места должны генерировать путь одинаково, поэтому вынесено сюда.
export function buildAutoPath(projectId: string, landingId: string, existingPaths: string[]): string {
  const base = `/${shortCode(projectId)}/${shortCode(landingId)}`;
  const taken = new Set(existingPaths);
  if (!taken.has(base)) return base;
  let attempt = 2;
  while (taken.has(`${base}-${attempt}`)) attempt += 1;
  return `${base}-${attempt}`;
}

// navigator.clipboard требует secure context (HTTPS или localhost) — в этой среде дев-сервер
// открыт по публичному IP через HTTP, поэтому navigator.clipboard вообще undefined, а не просто
// бросает ошибку. Фоллбэк через скрытый textarea + execCommand работает в любом контексте.
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

// Общий приём "скачать Blob как файл" (запрос пользователя 2026-09-08: "добавить возможность
// скачивать таблицы статистики") — до этого был продублирован построчно в 4 местах (lookalike-
// экспорт классической и Studio страниц клиентов), каждый раз заново: createObjectURL, временный
// <a download>, click, revokeObjectURL. Вынесен сюда, а не оставлен дублироваться и дальше, раз
// новых мест использования сразу становится больше двух (полный экспорт клиентов + статистика
// проекта, тоже по 2 копии на дерево).
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
