// Формат отображаемого имени пользователя — общий хелпер (запрос пользователя 2026-08-19:
// "у некоторых баеров везде в проекте есть слово null после их имени") — три места
// (ProjectsService.getLeaderboards, TeamService.getBuyerAnalytics, ClientsService.findMany)
// независимо собирали имя как `${firstName} ${lastName}`.trim(), а .trim() убирает только
// пробелы по краям, не литеральную строку "null", в которую JS превращает lastName: null
// внутри шаблонной строки. filter(Boolean) отбрасывает null/undefined/пустую строку целиком,
// а не просто их текстовое представление.
export function formatUserName(user: { firstName: string; lastName: string | null }): string {
  return [user.firstName, user.lastName].filter(Boolean).join(' ');
}
