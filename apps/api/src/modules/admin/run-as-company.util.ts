import { UserRole } from '@prisma/client';
import { companyStorage } from '../../common/context/company.context';

// Дрилл-даун по чужой компании (Фаза 4.3B, запрос пользователя 2026-07-19) — обычный вызов
// company-scoped сервиса (ProjectsService.findAll и т.д.) с явным targetCompanyId НЕ работает
// сам по себе: PrismaService's middleware для Project/Landing/Client/BotScenario/
// AutomationFlow/AbTestGroup молча подменяет любой companyId в where на companyId САМОГО
// АДМИНА из его собственного JWT-контекста (companyStorage). Решение — временно ре-войти в
// AsyncLocalStorage с ID целевой компании на время вызова: middleware/сервисы переиспользуются
// БЕЗ изменений, просто видят "правильный" companyId. Domain/Push/Channel/User вне этого
// списка middleware — их сервисы уже берут companyId явным параметром, эта обёртка им не
// нужна (но безвредна, если всё равно вызвать через неё).
//
// ВАЖНО для будущих читателей: role/userId в этом синтетическом контексте сейчас нигде не
// читаются (проверено — только companyId используется в prisma.service.ts и
// http-exception.filter.ts). Если когда-нибудь появится код, читающий getCompanyContext().userId
// в ожидании "текущий реальный пользователь в этой компании" — он молча получит userId админа,
// которого в целевой компании не существует. Не полагаться на userId/role отсюда нигде, кроме
// прохождения через сам PrismaService middleware.
//
// **РЕАЛЬНЫЙ БАГ, найденный живым смоук-тестом 2026-07-20 (не догадкой, а прямой проверкой —
// запросил проект чужой компании через дрилл-даун другой компании, получил его данные вместо
// 404)**: первая версия этой функции была `return companyStorage.run({...}, fn)` — без
// внутреннего await. `fn`, если это простая стрелочная функция вида `() =>
// prisma.project.findFirst(...)`, синхронно ВОЗВРАЩАЕТ промис Prisma (PrismaPromise — свой
// класс, НЕ нативный Promise) сама не дожидаясь его. `companyStorage.run()` в этот момент уже
// синхронно завершается и передаёт управление обратно — АЛС корректно привязывает контекст
// только к тому, что реально стартовало (создало настоящий нативный Promise/микрозадачу) ДО
// этого момента. Реальный запрос к Prisma-миддлвару стартует позже, при вызове `.then()`
// снаружи (`await runAsCompany(...)` в вызывающем коде) — то есть УЖЕ вне активного окна
// `run()`, и middleware видит `ctx === undefined`, никакого скоупинга не происходит вообще.
// Фикс — `fn` дожидается ВНУТРИ колбэка `run()`, синхронно инициируя реальный await ещё в
// пределах активного окна AsyncLocalStorage. Проверено: заново прогнанный кросс-компанийный
// тест (запрос проекта компании A через дрилл-даун компании B) корректно вернул null/404 после
// этого фикса. **Урок: с Prisma (или любым кастомным thenable, не нативным Promise) через
// AsyncLocalStorage — всегда await'ить внутри run(), никогда не полагаться на то, что вызывающий
// код await'нет возвращённый run()'ом промис снаружи.**
export async function runAsCompany<T>(companyId: string, adminUserId: string, fn: () => Promise<T>): Promise<T> {
  return companyStorage.run({ companyId, userId: adminUserId, role: UserRole.SUPER_ADMIN }, async () => {
    return await fn();
  });
}
