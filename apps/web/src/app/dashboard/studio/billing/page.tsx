'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { CheckCircle2, Crown, Gem, History, Rocket, Trophy, TrendingUp, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PaymentModal } from '@/components/billing/payment-modal';
import { STUDIO_CARD, StudioLinkButton, StudioPill } from '../ui';

interface PlanConfig {
  priceUsdt: number;
  durationDays: number;
  maxProjects: number;
  maxClients: number;
  maxPushesPerDay: number;
}

interface CompanyUsage {
  plan: string;
  planExpiresAt: string | null;
  balance: string;
  maxProjects: number;
  currentProjects: number;
  maxClients: number;
  currentClients: number;
  maxPushesPerDay: number;
  pushesToday: number;
}

interface Invoice {
  id: string;
  amount: string;
  network: string | null;
  status: string;
  txHash: string | null;
  createdAt: string;
}

type PaymentNetwork = 'TRC20' | 'ERC20' | 'BEP20';

const NETWORK_LABEL: Record<PaymentNetwork, string> = {
  TRC20: 'USDT TRC-20 (TRON)',
  ERC20: 'USDT ERC-20 (Ethereum)',
  BEP20: 'USDT BEP-20 (BNB Chain)',
};

interface BalanceTransaction {
  id: string;
  type: 'TOPUP' | 'SUBSCRIPTION_CHARGE' | 'DOWNGRADE' | 'ADMIN_CREDIT';
  amount: string;
  balanceAfter: string;
  plan: string | null;
  createdAt: string;
}

const TRANSACTION_LABEL: Record<BalanceTransaction['type'], string> = {
  TOPUP: 'Пополнение',
  SUBSCRIPTION_CHARGE: 'Списание за подписку',
  DOWNGRADE: 'Сброс до TRIAL (не хватило баланса)',
  ADMIN_CREDIT: 'Начисление администратором',
};

// Оформление тарифных карточек (запрос пользователя 2026-07-30: "сделай карточки планов
// красивее, с иконками картинками, чтобы завлекали внимание, можно больше цветов... пусть
// будут больше") — намеренно НЕ приглушённая 5-оттеночная палитра Studio (та специально
// приглушена для остального приложения), у карточек тарифов своя, более насыщенная и
// контрастная тройка цветов — витрина продаж имеет право выглядеть иначе, чем рабочий
// интерфейс. GROWTH отмечен как рекомендуемый (средний тариф — самый частый реальный выбор).
const PLAN_PRESENTATION: Record<
  'STARTER' | 'GROWTH' | 'SCALE' | 'PRO' | 'ULTIMATE',
  {
    icon: typeof Rocket;
    label: string;
    tagline: string;
    accentText: string;
    accentBg: string;
    accentBgSoft: string;
    ring: string;
    recommended?: boolean;
  }
> = {
  STARTER: {
    icon: Rocket,
    label: 'Starter',
    tagline: 'Для первого проекта',
    accentText: 'text-[#2563EB] dark:text-[#60A5FA]',
    accentBg: 'bg-[#2563EB] dark:bg-[#60A5FA]',
    accentBgSoft: 'bg-[#2563EB]/10 dark:bg-[#60A5FA]/10',
    ring: 'ring-[#2563EB] dark:ring-[#60A5FA]',
  },
  GROWTH: {
    icon: TrendingUp,
    label: 'Growth',
    tagline: 'Для роста команды',
    accentText: 'text-[#9333EA] dark:text-[#C084FC]',
    accentBg: 'bg-[#9333EA] dark:bg-[#C084FC]',
    accentBgSoft: 'bg-[#9333EA]/10 dark:bg-[#C084FC]/10',
    ring: 'ring-[#9333EA] dark:ring-[#C084FC]',
    recommended: true,
  },
  SCALE: {
    icon: Crown,
    label: 'Scale',
    tagline: 'Для агентств',
    accentText: 'text-[#D97706] dark:text-[#FBBF24]',
    accentBg: 'bg-[#D97706] dark:bg-[#FBBF24]',
    accentBgSoft: 'bg-[#D97706]/10 dark:bg-[#FBBF24]/10',
    ring: 'ring-[#D97706] dark:ring-[#FBBF24]',
  },
  // PRO/ULTIMATE добавлены 2026-09-25 (запрос пользователя "поменять условия подписки") —
  // продолжение той же насыщенной витринной палитры, два новых непересекающихся акцентных цвета.
  PRO: {
    icon: Gem,
    label: 'Pro',
    tagline: 'Для крупных команд',
    accentText: 'text-[#059669] dark:text-[#34D399]',
    accentBg: 'bg-[#059669] dark:bg-[#34D399]',
    accentBgSoft: 'bg-[#059669]/10 dark:bg-[#34D399]/10',
    ring: 'ring-[#059669] dark:ring-[#34D399]',
  },
  ULTIMATE: {
    icon: Trophy,
    label: 'Ultimate',
    tagline: 'Максимальные лимиты',
    accentText: 'text-[#E11D48] dark:text-[#FB7185]',
    accentBg: 'bg-[#E11D48] dark:bg-[#FB7185]',
    accentBgSoft: 'bg-[#E11D48]/10 dark:bg-[#FB7185]/10',
    ring: 'ring-[#E11D48] dark:ring-[#FB7185]',
  },
};
const PURCHASABLE: Array<'STARTER' | 'GROWTH' | 'SCALE' | 'PRO' | 'ULTIMATE'> = ['STARTER', 'GROWTH', 'SCALE', 'PRO', 'ULTIMATE'];

// Studio-версия страницы подписки. Полный редизайн 2026-07-30 (запрос пользователя): карточки
// планов стали крупнее/ярче (см. PLAN_PRESENTATION выше); пополнение переехало из инлайн-формы
// в модалку (TopUpDialog ниже, тот же двухшаговый паттерн, что уже был — форма суммы/сети,
// затем существующий PaymentModal с QR); история пополнений (инвойсы) переехала на отдельную
// страницу ./history — сама эта страница теперь короче и меньше похожа на бухгалтерский отчёт.
export default function StudioBillingPage() {
  const queryClient = useQueryClient();
  const [activeInvoiceId, setActiveInvoiceId] = useState<string | null>(null);
  const [showTopUp, setShowTopUp] = useState(false);
  const [planError, setPlanError] = useState('');

  const { data: plans } = useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: async () => (await api.get<Record<string, PlanConfig>>('/billing/plans')).data,
  });

  const { data: usage } = useQuery({
    queryKey: ['billing', 'current'],
    queryFn: async () => (await api.get<CompanyUsage>('/billing/current')).data,
  });

  const { data: transactions } = useQuery({
    queryKey: ['billing', 'transactions'],
    queryFn: async () => (await api.get<BalanceTransaction[]>('/billing/transactions')).data,
  });

  const selectPlan = useMutation({
    mutationFn: async (plan: string) => (await api.post('/billing/select-plan', { plan })).data,
    onSuccess: () => {
      setPlanError('');
      queryClient.invalidateQueries({ queryKey: ['billing', 'current'] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'transactions'] });
    },
    onError: (err: unknown) => {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
          : undefined;
      setPlanError(message || 'Не удалось сменить тариф');
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Подписка</h1>
        <StudioLinkButton icon={History} href="/billing/history">
          История пополнений
        </StudioLinkButton>
      </div>

      <div className={`${STUDIO_CARD} p-5 flex items-center justify-between gap-4 flex-wrap`}>
        <div>
          <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3] mb-1">Баланс</h2>
          <div className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] font-mono tabular-nums">${usage?.balance ?? '0.00'}</div>
          <p className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] mt-1 max-w-md">
            Тариф продлевается автоматически списанием с баланса раз в период. Не хватит средств — тариф будет сброшен до TRIAL.
          </p>
        </div>
        <StudioLinkButton variant="primary" icon={Wallet} onClick={() => setShowTopUp(true)}>
          Пополнить
        </StudioLinkButton>
      </div>

      {usage && (
        <div className={`${STUDIO_CARD} p-5 space-y-4`}>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Текущий план:</h2>
            <StudioPill hue="amber">{usage.plan}</StudioPill>
            {usage.planExpiresAt && (
              <span className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">следующее списание {format(new Date(usage.planExpiresAt), 'd MMM yyyy')}</span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <UsageBar label="Проекты" current={usage.currentProjects} max={usage.maxProjects} />
            <UsageBar label="Клиенты" current={usage.currentClients} max={usage.maxClients} />
            <UsageBar label="Рассылок в день" current={usage.pushesToday} max={usage.maxPushesPerDay} />
          </div>
        </div>
      )}

      {/* Баг-репорт пользователя 2026-09-25 (round 2): "карточки обрубают текст, лучше переноси
          на другой ряд тариф" — grid-cols вынуждало ровно N равных колонок на каждой ширине,
          из-за чего промежуточные ширины сжимали карточку уже её текста и truncate его резал.
          Заменено на flex-wrap + justify-center: каждая карточка получает фиксированную (не
          резиновую) ширину под нужное число карточек в ряду через calc() с учётом gap-6
          (1.5rem) — при переполнении ряда лишние карточки сами переносятся на следующий ряд
          целиком (а не обрезают текст), и justify-center центрирует неполный последний ряд с
          тем же зазором gap, что и между остальными карточками — 1 (<md) → 2+2+1 (md-xl) →
          3+2 (xl-2xl) → 5 (>=2xl), точный порядок из запроса пользователя. */}
      <div className="flex flex-wrap justify-center gap-6">
        {PURCHASABLE.map((plan) => {
          const config = plans?.[plan];
          const presentation = PLAN_PRESENTATION[plan];
          const Icon = presentation.icon;
          const isCurrent = usage?.plan === plan;
          return (
            // flex flex-col + <ul> ниже flex-1 (баг-репорт пользователя 2026-09-25: "кнопка
            // сейчас на разных высотах карточек") — карточки в гриде уже растянуты на высоту
            // самой высокой строки (align-items:stretch по умолчанию), список фич забирает всё
            // свободное место, кнопка всегда прижата к низу независимо от числа строк текста.
            <div
              key={plan}
              // min-w-0 на самой карточке — flex-элемент по умолчанию не сжимается уже своего
              // контента (тот же min-width:auto), из-за чего при переполнении он бы вытолкнул
              // соседей вместо переноса на новую строку. basis-full/md/xl/2xl — фиксированная
              // ширина под 1/2/3/5 карточек в ряду соответственно (см. комментарий у контейнера).
              className={`relative rounded-2xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-md hover:shadow-xl transition-shadow p-8 flex flex-col gap-5 min-w-0 basis-full md:basis-[calc((100%-1.5rem)/2)] xl:basis-[calc((100%-3rem)/3)] 2xl:basis-[calc((100%-6rem)/5)] ${
                presentation.recommended ? `ring-2 ${presentation.ring}` : isCurrent ? 'ring-2 ring-[#1F4E9C] dark:ring-[#7BA9EE]' : ''
              }`}
            >
              {presentation.recommended && (
                <div
                  className={`absolute -top-3 left-8 text-[11px] font-bold uppercase tracking-wide px-3 py-1 rounded-full text-white ${presentation.accentBg}`}
                >
                  Популярный выбор
                </div>
              )}

              {/* min-w-0 на текстовом блоке — без него flex-ребёнок не сжимается уже своего
                  контента и тянет карточку/текст за границы на промежуточных ширинах (тот же
                  класс бага, что и в feedback_flex_truncate_nesting). */}
              <div className="flex items-center gap-4 min-w-0">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${presentation.accentBgSoft}`}>
                  <Icon className={`w-7 h-7 ${presentation.accentText}`} />
                </div>
                {/* truncate убран (баг-репорт "текст обрубается") — теперь ширина карточки
                    фиксирована под конкретное число в ряду (см. выше), а не резиновая, так что
                    достаточно места и переносить текст незачем, но на случай длинного названия
                    break-words не даст ему вылезти за карточку. */}
                <div className="min-w-0">
                  <h3 className="text-xl font-bold text-[#131A24] dark:text-[#E9EDF3] break-words">{presentation.label}</h3>
                  <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] break-words">{presentation.tagline}</p>
                </div>
              </div>

              <div className="flex items-baseline gap-1.5 flex-wrap">
                <span className="text-4xl font-extrabold text-[#131A24] dark:text-[#E9EDF3]">${config?.priceUsdt}</span>
                <span className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">/ мес</span>
              </div>

              <ul className="space-y-2.5 flex-1">
                <FeatureRow icon={CheckCircle2} accentText={presentation.accentText}>
                  {config?.maxProjects} {config && config.maxProjects === 1 ? 'проект' : 'проектов'}
                </FeatureRow>
                <FeatureRow icon={CheckCircle2} accentText={presentation.accentText}>
                  {config?.maxClients.toLocaleString()} клиентов
                </FeatureRow>
                <FeatureRow icon={CheckCircle2} accentText={presentation.accentText}>
                  {config?.maxPushesPerDay.toLocaleString()} рассылок в день
                </FeatureRow>
                {/* Запрос пользователя 2026-09-25: "подметь во всех карточках что становится
                    доступен полный доступ к клоакингу" — TRIAL (не в PURCHASABLE, сюда не
                    попадает) ограничен только условием "Страна", любой платный тариф снимает
                    это ограничение целиком, см. TRIAL_ALLOWED_CLOAKING_FIELDS. */}
                <FeatureRow icon={CheckCircle2} accentText={presentation.accentText}>
                  Полный доступ к фильтрации (клоакингу)
                </FeatureRow>
              </ul>

              <StudioLinkButton
                variant={isCurrent ? 'secondary' : 'primary'}
                // Баг-репорт пользователя 2026-09-25: "при нажатии на одну кнопку сразу все
                // кнопки визуально прожимаются" — isPending была общей на все 5 карточек сразу,
                // теперь скоуплено на конкретный план через .variables.
                disabled={selectPlan.isPending && selectPlan.variables === plan}
                onClick={() => selectPlan.mutate(plan)}
              >
                {isCurrent ? 'Продлить сейчас' : 'Выбрать план'}
              </StudioLinkButton>
            </div>
          );
        })}
      </div>
      {planError && <p className="text-sm text-red-500">{planError}</p>}

      <div>
        <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3] mb-3">История операций</h2>
        <div className={`${STUDIO_CARD} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[#5F6B7A] dark:text-[#92A0AF] border-b border-[#DCE1E8] dark:border-white/10">
                <th className="px-5 py-3 font-medium">Дата</th>
                <th className="px-5 py-3 font-medium">Операция</th>
                <th className="px-5 py-3 font-medium">Сумма</th>
                <th className="px-5 py-3 font-medium">Остаток</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DCE1E8] dark:divide-white/10">
              {transactions?.map((tx) => (
                <tr key={tx.id}>
                  <td className="px-5 py-3 text-[#131A24] dark:text-[#E9EDF3]">{format(new Date(tx.createdAt), 'd MMM yyyy HH:mm')}</td>
                  <td className="px-5 py-3 text-[#131A24] dark:text-[#E9EDF3]">
                    {TRANSACTION_LABEL[tx.type]}
                    {tx.type === 'SUBSCRIPTION_CHARGE' && tx.plan ? ` (${tx.plan})` : ''}
                  </td>
                  <td className={`px-5 py-3 font-mono tabular-nums ${Number(tx.amount) < 0 ? 'text-red-600 dark:text-red-400' : 'text-[#1F7A6C] dark:text-[#6FCBBA]'}`}>
                    {Number(tx.amount) > 0 ? '+' : ''}
                    {tx.amount} USDT
                  </td>
                  <td className="px-5 py-3 font-mono tabular-nums text-[#5F6B7A] dark:text-[#92A0AF]">${tx.balanceAfter}</td>
                </tr>
              ))}
              {transactions?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-[#5F6B7A] dark:text-[#92A0AF]">
                    Операций пока нет.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <TopUpDialog
        open={showTopUp}
        onClose={() => setShowTopUp(false)}
        onCreated={(invoiceId) => {
          setShowTopUp(false);
          setActiveInvoiceId(invoiceId);
        }}
      />
      <PaymentModal invoiceId={activeInvoiceId} onClose={() => setActiveInvoiceId(null)} />
    </div>
  );
}

function FeatureRow({ icon: Icon, accentText, children }: { icon: typeof CheckCircle2; accentText: string; children: React.ReactNode }) {
  return (
    // items-start (не center) + min-w-0 на тексте — баг-репорт пользователя 2026-09-25: длинные
    // строки ("Полный доступ к фильтрации (клоакингу)", "500,000 клиентов") на узкой карточке
    // должны переноситься на вторую строку, а не вылезать за границу — flex-ребёнок без min-w-0
    // не сжимается своего непрерывного контента, см. feedback_flex_truncate_nesting.
    <li className="flex items-start gap-2 text-sm text-[#131A24] dark:text-[#E9EDF3]">
      <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${accentText}`} />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function UsageBar({ label, current, max }: { label: string; current: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((current / max) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-[#5F6B7A] dark:text-[#92A0AF]">{label}</span>
        <span className="text-[#131A24] dark:text-[#E9EDF3] font-mono tabular-nums">
          {current.toLocaleString()} / {max.toLocaleString()}
        </span>
      </div>
      <Progress value={pct} />
    </div>
  );
}

const TOPUP_PRESETS = [50, 100, 200];

// Пополнение вынесено из инлайн-формы на странице в модалку (запрос пользователя 2026-07-30:
// "пополнение вынеси на отдельную страницу или в модальное окно") — сначала эта форма
// (сумма + сеть), по успеху сразу передаёт эстафету уже существующему PaymentModal (QR/адрес
// для оплаты), который остался ровно тем же компонентом, что и раньше.
// NOWPayments подключён 2026-07-30 (реальные ключи в .env.prod) — единственный видимый способ
// оплаты на фронтенде сейчас (запрос пользователя 2026-07-30: "убери другие способы оплаты
// кроме nowpayments, остальные пока спрячь, они недоступны"). Self-hosted (`POST /billing/topup`)
// и Heleket остаются рабочими/существующими на бэкенде — просто без кнопки здесь.
function TopUpDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (invoiceId: string) => void }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('100');
  const [network, setNetwork] = useState<PaymentNetwork>('TRC20');

  const createNowPaymentsTopUp = useMutation({
    mutationFn: async () => (await api.post('/billing/topup/nowpayments', { amount: Number(amount), network })).data as Invoice,
    onSuccess: (invoice) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'invoices'] });
      onCreated(invoice.id);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Пополнить баланс</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {TOPUP_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAmount(String(preset))}
                className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  amount === String(preset)
                    ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                    : 'bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
                }`}
              >
                ${preset}
              </button>
            ))}
          </div>
          <Input type="number" min={10} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Своя сумма" />
          <Select value={network} onValueChange={(v) => setNetwork(v as PaymentNetwork)}>
            <SelectTrigger>
              <SelectValue>{(v: PaymentNetwork) => NETWORK_LABEL[v]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TRC20">{NETWORK_LABEL.TRC20}</SelectItem>
              <SelectItem value="ERC20">{NETWORK_LABEL.ERC20}</SelectItem>
              <SelectItem value="BEP20">{NETWORK_LABEL.BEP20}</SelectItem>
            </SelectContent>
          </Select>
          {/* Запрос пользователя 2026-07-30: "убери другие способы оплаты кроме nowpayments,
              остальные пока спрячь, они недоступны" — self-hosted (createTopUp) и Heleket
              скрыты из UI, но их код/эндпоинты не удалены (createTopUp работает, Heleket всё
              ещё без ключей) — легко вернуть кнопки обратно, когда понадобится. */}
          <StudioLinkButton
            variant="primary"
            disabled={!amount || Number(amount) < 10 || createNowPaymentsTopUp.isPending}
            onClick={() => createNowPaymentsTopUp.mutate()}
          >
            {createNowPaymentsTopUp.isPending ? 'Создаём счёт...' : 'Оплатить через NOWPayments'}
          </StudioLinkButton>
          {createNowPaymentsTopUp.isError && (
            <p className="text-xs text-red-500">Не удалось создать счёт через NOWPayments. Попробуйте ещё раз.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
