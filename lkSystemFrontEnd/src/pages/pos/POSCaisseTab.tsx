import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  CalendarDays,
  CheckCircle2,
  CloudOff,
  Eye,
  History,
  Loader2,
  LockKeyhole,
  Receipt,
  RefreshCw,
  Trash2,
  Wallet,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  cashMovementService,
  cashSessionService,
  DEPOSIT_CATEGORY_OPTIONS,
  EXPENSE_CATEGORY_OPTIONS,
  type CashMovement,
  type CashMovementCategory,
  type CashSession,
  type CashSessionSummary,
  type CaisseMovement,
  type CurrentCashSession,
} from '@/services/cashMovement.service';
import {
  offlineCaisseService,
  type PendingCaisseOp,
} from '@/services/offlineCaisse.service';
import {
  POSDialogBody,
  POSDialogContent,
  POSDialogFooter,
  POSDialogHeader,
  POSPrimaryButton,
  POSSecondaryButton,
} from './POSDialog';
import { roundTND } from './posPayment';
import { fmtTND } from './types';

interface Props {
  channelId: number | null;
  channelName?: string;
  refreshSignal?: number;
  onAfterChange?: () => void;
}

const ZERO_SUMMARY: CashSessionSummary = {
  gross_sales: '0.000',
  revenue: '0.000',
  revenue_count: 0,
  cash_sales: '0.000',
  card_sales: '0.000',
  cash_refunds: '0.000',
  card_refunds: '0.000',
  refunds: '0.000',
  opening: '0.000',
  cash_added: '0.000',
  manual_cash_in: '0.000',
  manual_cash_out: '0.000',
  funding_total: '0.000',
  funding_count: 0,
  expenses: '0.000',
  expenses_count: 0,
  net_balance: '0.000',
  cash_balance: '0.000',
  expected_cash_live: '0.000',
  by_category: [],
};

const parseAmount = (value: string) => {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? roundTND(Math.max(0, parsed)) : 0;
};

const extractApiError = (error: unknown, fallback: string) => {
  const data = (error as { response?: { data?: unknown } } | null)?.response
    ?.data;
  if (typeof data === 'string' && data) return data;
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    const direct = record.detail ?? record.message ?? record.error;
    if (typeof direct === 'string') return direct;
    for (const value of Object.values(record)) {
      if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
      if (typeof value === 'string') return value;
    }
  }
  return error instanceof Error ? error.message : fallback;
};

const isNetworkError = (error: unknown) =>
  !(error as { response?: unknown } | null)?.response;

const formatDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

function Metric({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'positive' | 'negative';
}) {
  return (
    <div className="min-w-0 border-l-2 pl-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={`mt-1 truncate text-xl font-bold tabular-nums ${tone === 'positive' ? 'text-emerald-700' : tone === 'negative' ? 'text-destructive' : ''}`}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function SessionSummary({ summary }: { summary: CashSessionSummary }) {
  return (
    <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Fond de caisse" value={`${fmtTND(summary.opening)} TND`} />
      <Metric
        label="Ventes espèces"
        value={`${fmtTND(summary.cash_sales)} TND`}
        tone="positive"
      />
      <Metric
        label="Ventes carte"
        value={`${fmtTND(summary.card_sales)} TND`}
      />
      <Metric
        label="Remboursements"
        value={`-${fmtTND(summary.refunds)} TND`}
        tone={Number(summary.refunds) > 0 ? 'negative' : 'default'}
      />
      <Metric
        label="Entrées manuelles"
        value={`+${fmtTND(summary.manual_cash_in)} TND`}
      />
      <Metric
        label="Sorties manuelles"
        value={`-${fmtTND(summary.manual_cash_out)} TND`}
      />
      <Metric
        label="Caisse théorique"
        value={`${fmtTND(summary.cash_balance)} TND`}
        hint="Espèces attendues dans le tiroir"
      />
      <Metric
        label="Chiffre d’affaires net"
        value={`${fmtTND(summary.revenue)} TND`}
        hint={`${summary.revenue_count} transaction(s)`}
      />
    </div>
  );
}

function MovementForm({
  type,
  onSubmit,
  disabled,
  submitting,
}: {
  type: 'deposit' | 'expense';
  onSubmit: (payload: {
    amount: number;
    category: CashMovementCategory;
    note: string;
  }) => Promise<void>;
  disabled: boolean;
  submitting: boolean;
}) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [category, setCategory] = useState<CashMovementCategory>(
    type === 'deposit' ? 'TOP_UP' : 'SUPPLIES'
  );
  const options =
    type === 'deposit'
      ? DEPOSIT_CATEGORY_OPTIONS.filter(option => option.value !== 'OPENING')
      : EXPENSE_CATEGORY_OPTIONS;

  const submit = async () => {
    const numeric = parseAmount(amount);
    if (numeric <= 0) return;
    await onSubmit({ amount: numeric, category, note: note.trim() });
    setAmount('');
    setNote('');
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>
            {type === 'deposit' ? 'Montant ajouté' : 'Montant retiré'}
          </Label>
          <div className="relative">
            <Input
              value={amount}
              onChange={event => setAmount(event.target.value)}
              inputMode="decimal"
              placeholder="0.000"
              className="h-11 pr-12 tabular-nums"
              disabled={disabled}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
              TND
            </span>
          </div>
        </div>
        <div className="space-y-2">
          <Label>Motif</Label>
          <Select
            value={category}
            onValueChange={value => setCategory(value as CashMovementCategory)}
            disabled={disabled}
          >
            <SelectTrigger className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label>
          Note{' '}
          <span className="font-normal text-muted-foreground">
            (optionnelle)
          </span>
        </Label>
        <Input
          value={note}
          onChange={event => setNote(event.target.value)}
          placeholder="Justification de l’opération"
          className="h-11"
          disabled={disabled}
        />
      </div>
      <Button
        type="button"
        className="h-11 w-full"
        variant={type === 'deposit' ? 'default' : 'outline'}
        onClick={() => void submit()}
        disabled={disabled || submitting || parseAmount(amount) <= 0}
      >
        {submitting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : type === 'deposit' ? (
          <ArrowDownToLine className="size-4" />
        ) : (
          <ArrowUpFromLine className="size-4" />
        )}
        {type === 'deposit' ? 'Ajouter les espèces' : 'Enregistrer la sortie'}
      </Button>
    </div>
  );
}

export default function POSCaisseTab({
  channelId,
  channelName,
  refreshSignal = 0,
  onAfterChange,
}: Props) {
  const [current, setCurrent] = useState<CurrentCashSession | null>(null);
  const [history, setHistory] = useState<CashSession[]>([]);
  const [journal, setJournal] = useState<CaisseMovement[]>([]);
  const [manualMovements, setManualMovements] = useState<CashMovement[]>([]);
  const [pending, setPending] = useState<PendingCaisseOp[]>([]);
  const [loading, setLoading] = useState(false);
  const [movementSubmitting, setMovementSubmitting] = useState(false);
  const [openingAmount, setOpeningAmount] = useState('');
  const [opening, setOpening] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closingAmount, setClosingAmount] = useState('');
  const [closingNote, setClosingNote] = useState('');
  const [closing, setClosing] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<CashSession | null>(
    null
  );
  const [selectedHistoryJournal, setSelectedHistoryJournal] = useState<
    CaisseMovement[]
  >([]);
  const [historyDetailLoading, setHistoryDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [online, setOnline] = useState(() => navigator.onLine);
  const syncingRef = useRef(false);

  const session = current?.session ?? null;
  const summary = current?.summary ?? ZERO_SUMMARY;
  const isClosed = session?.status === 'CLOSED';
  const canOperate = Boolean(session && session.status === 'OPEN');

  const refresh = useCallback(async () => {
    if (!channelId) return;
    setLoading(true);
    setError('');
    try {
      const currentSession = await cashSessionService.current(channelId);
      setCurrent(currentSession);
      const date = currentSession.business_date;
      const [sessions, dayJournal, movements, queued] = await Promise.all([
        cashSessionService.list(channelId),
        cashMovementService.caisseJournal(channelId, {
          date_from: date,
          date_to: date,
        }),
        cashMovementService.list({
          sales_channel: channelId,
          date_from: date,
          date_to: date,
        }),
        offlineCaisseService
          .listPending(channelId)
          .catch(() => [] as PendingCaisseOp[]),
      ]);
      setHistory(sessions);
      setJournal(dayJournal.movements);
      setManualMovements(movements);
      setPending(queued);
    } catch (requestError) {
      setError(
        extractApiError(requestError, 'Impossible de charger la caisse.')
      );
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshSignal]);

  useEffect(() => {
    if (!channelId) return undefined;
    const refreshVisibleSession = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = window.setInterval(refreshVisibleSession, 60_000);
    window.addEventListener('focus', refreshVisibleSession);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisibleSession);
    };
  }, [channelId, refresh]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    if (!online || !channelId || syncingRef.current) return;
    void (async () => {
      const queued = await offlineCaisseService
        .listPending(channelId)
        .catch(() => []);
      if (queued.length === 0) return;
      syncingRef.current = true;
      try {
        const result = await offlineCaisseService.sync(channelId);
        if (result.synced > 0)
          setMessage(`${result.synced} opération(s) synchronisée(s).`);
        await refresh();
      } finally {
        syncingRef.current = false;
      }
    })();
  }, [channelId, online, refresh]);

  const openSession = async () => {
    if (!channelId || !online) return;
    setOpening(true);
    setError('');
    try {
      await cashSessionService.open(channelId, parseAmount(openingAmount));
      setOpeningAmount('');
      setMessage(
        'Caisse ouverte. Le fond de caisse est enregistré séparément du chiffre d’affaires.'
      );
      await refresh();
      onAfterChange?.();
    } catch (requestError) {
      setError(extractApiError(requestError, 'Impossible d’ouvrir la caisse.'));
    } finally {
      setOpening(false);
    }
  };

  const closeSession = async () => {
    if (!session || !online) return;
    setClosing(true);
    setError('');
    try {
      await cashSessionService.close(
        session.id,
        parseAmount(closingAmount),
        closingNote
      );
      setCloseOpen(false);
      setClosingAmount('');
      setClosingNote('');
      setMessage(
        'Caisse clôturée. Les montants de cette journée sont maintenant figés.'
      );
      await refresh();
      onAfterChange?.();
    } catch (requestError) {
      setError(
        extractApiError(requestError, 'Impossible de clôturer la caisse.')
      );
    } finally {
      setClosing(false);
    }
  };

  const createMovement = async (
    type: 'deposit' | 'expense',
    values: { amount: number; category: CashMovementCategory; note: string }
  ) => {
    if (!channelId || !canOperate) return;
    setMovementSubmitting(true);
    setError('');
    const payload = {
      sales_channel: channelId,
      movement_type: type,
      amount: values.amount,
      category: values.category,
      note: values.note,
    } as const;
    const options =
      type === 'deposit' ? DEPOSIT_CATEGORY_OPTIONS : EXPENSE_CATEGORY_OPTIONS;
    const label =
      options.find(option => option.value === values.category)?.label ??
      values.category;
    try {
      if (!online) {
        if (type === 'deposit')
          await offlineCaisseService.queueDeposit(payload, label);
        else await offlineCaisseService.queueExpense(payload, label);
        setMessage('Opération enregistrée hors ligne et mise en attente.');
      } else {
        await cashMovementService.create(payload);
        setMessage(
          type === 'deposit'
            ? 'Entrée de caisse enregistrée.'
            : 'Sortie de caisse enregistrée.'
        );
      }
      await refresh();
      onAfterChange?.();
    } catch (requestError) {
      if (isNetworkError(requestError)) {
        if (type === 'deposit')
          await offlineCaisseService.queueDeposit(payload, label);
        else await offlineCaisseService.queueExpense(payload, label);
        setOnline(false);
        setMessage('Connexion perdue. Opération conservée hors ligne.');
        await refresh();
      } else {
        setError(
          extractApiError(
            requestError,
            'Impossible d’enregistrer le mouvement.'
          )
        );
      }
    } finally {
      setMovementSubmitting(false);
    }
  };

  const removeMovement = async (id: number) => {
    if (
      !window.confirm(
        'Annuler ce mouvement ? Une trace de contrepassation restera dans le journal.'
      )
    )
      return;
    try {
      await cashMovementService.remove(id);
      await refresh();
      onAfterChange?.();
    } catch (requestError) {
      setError(
        extractApiError(requestError, 'Impossible d’annuler ce mouvement.')
      );
    }
  };

  const openHistoryDetail = async (row: CashSession) => {
    setSelectedHistory(row);
    setSelectedHistoryJournal([]);
    setHistoryDetailLoading(true);
    try {
      const detail = await cashMovementService.caisseJournal(
        row.sales_channel,
        {
          date_from: row.business_date,
          date_to: row.business_date,
        }
      );
      setSelectedHistoryJournal(detail.movements);
    } catch (requestError) {
      setError(
        extractApiError(
          requestError,
          'Impossible de charger le journal de cette journée.'
        )
      );
    } finally {
      setHistoryDetailLoading(false);
    }
  };

  const pendingTotal = useMemo(
    () =>
      pending.reduce(
        (sum, operation) =>
          sum +
          (operation.kind === 'deposit' ? operation.amount : -operation.amount),
        0
      ),
    [pending]
  );

  const liveDifference = roundTND(
    parseAmount(closingAmount) - Number(summary.cash_balance || 0)
  );

  if (!channelId) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        Sélectionnez un point de vente pour ouvrir sa caisse.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-1 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Wallet className="size-5" />
            <h2 className="text-lg font-semibold">
              Caisse {channelName ? `· ${channelName}` : ''}
            </h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Journée du {current ? formatDate(current.business_date) : '—'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={isClosed ? 'secondary' : 'outline'}
            className="h-8 px-3"
          >
            {isClosed ? (
              <LockKeyhole className="mr-1.5 size-3.5" />
            ) : (
              <CheckCircle2 className="mr-1.5 size-3.5 text-emerald-600" />
            )}
            {isClosed ? 'Clôturée' : session ? 'Ouverte' : 'Non ouverte'}
          </Badge>
          <Button
            variant="outline"
            size="icon"
            className="size-10"
            onClick={() => void refresh()}
            disabled={loading}
            title="Actualiser"
          >
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {!online || pending.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <CloudOff className="size-4 shrink-0" />
          <span className="font-semibold">
            {online ? 'Synchronisation en attente' : 'Mode hors ligne'}
          </span>
          <span>
            {pending.length} mouvement(s) · impact estimé{' '}
            {pendingTotal >= 0 ? '+' : ''}
            {fmtTND(pendingTotal)} TND
          </span>
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}

      {(!session || !session.opening_cash_set) && !isClosed ? (
        <Card className="p-5 sm:p-6">
          <div className="grid gap-5 lg:grid-cols-[1fr_320px] lg:items-end">
            <div>
              <p className="text-base font-semibold">Fond de caisse</p>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                Saisissez les espèces présentes dans le tiroir au début de la
                journée. Ce montant ne sera jamais compté comme chiffre
                d’affaires.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="opening-cash">Montant d’ouverture</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="opening-cash"
                    value={openingAmount}
                    onChange={event => setOpeningAmount(event.target.value)}
                    inputMode="decimal"
                    placeholder="0.000"
                    className="h-12 pr-12 text-lg font-semibold tabular-nums"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
                    TND
                  </span>
                </div>
                <Button
                  className="h-12 px-5"
                  onClick={() => void openSession()}
                  disabled={opening || !online}
                >
                  {opening ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Wallet className="size-4" />
                  )}{' '}
                  Ouvrir
                </Button>
              </div>
              {!online ? (
                <p className="text-xs text-amber-700">
                  La connexion est requise pour ouvrir une journée financière.
                </p>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      <Card className="p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-base font-semibold">Situation du jour</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Calculée depuis les tickets confirmés, retours et mouvements
              réels.
            </p>
          </div>
          {canOperate ? (
            <Button
              variant="outline"
              className="h-11"
              onClick={() => {
                setClosingAmount(summary.cash_balance);
                setCloseOpen(true);
              }}
            >
              <LockKeyhole className="size-4" /> Clôturer la caisse
            </Button>
          ) : null}
        </div>
        <SessionSummary summary={summary} />
        {isClosed && session ? (
          <>
            <Separator className="my-5" />
            <div className="grid gap-4 sm:grid-cols-3">
              <Metric
                label="Caisse théorique figée"
                value={`${fmtTND(session.closing_cash_expected || 0)} TND`}
              />
              <Metric
                label="Montant compté"
                value={`${fmtTND(session.closing_cash_actual || 0)} TND`}
              />
              <Metric
                label="Écart"
                value={`${Number(session.cash_difference || 0) >= 0 ? '+' : ''}${fmtTND(session.cash_difference || 0)} TND`}
                tone={
                  Number(session.cash_difference || 0) === 0
                    ? 'default'
                    : Number(session.cash_difference || 0) > 0
                      ? 'positive'
                      : 'negative'
                }
              />
            </div>
          </>
        ) : null}
      </Card>

      <Tabs defaultValue="movements" className="space-y-4">
        <TabsList className="h-11 w-full justify-start overflow-x-auto">
          <TabsTrigger value="movements" className="h-9 gap-2">
            <Banknote className="size-4" /> Mouvements
          </TabsTrigger>
          <TabsTrigger value="journal" className="h-9 gap-2">
            <Receipt className="size-4" /> Journal du jour
          </TabsTrigger>
          <TabsTrigger value="history" className="h-9 gap-2">
            <History className="size-4" /> Historique
          </TabsTrigger>
        </TabsList>

        <TabsContent value="movements" className="space-y-4">
          {!canOperate ? (
            <div className="rounded-md border border-dashed px-5 py-8 text-center text-sm text-muted-foreground">
              {isClosed
                ? 'La journée est clôturée. Aucun mouvement supplémentaire n’est autorisé.'
                : 'Ouvrez la caisse pour enregistrer des entrées ou sorties.'}
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-5">
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                    <ArrowDownToLine className="size-5" />
                  </span>
                  <div>
                    <p className="font-semibold">Entrée manuelle</p>
                    <p className="text-sm text-muted-foreground">
                      Ajouter de la monnaie au tiroir
                    </p>
                  </div>
                </div>
                <MovementForm
                  type="deposit"
                  disabled={!canOperate}
                  submitting={movementSubmitting}
                  onSubmit={values => createMovement('deposit', values)}
                />
              </Card>
              <Card className="p-5">
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-md bg-red-50 text-red-700">
                    <ArrowUpFromLine className="size-5" />
                  </span>
                  <div>
                    <p className="font-semibold">Sortie manuelle</p>
                    <p className="text-sm text-muted-foreground">
                      Dépense ou retrait justifié
                    </p>
                  </div>
                </div>
                <MovementForm
                  type="expense"
                  disabled={!canOperate}
                  submitting={movementSubmitting}
                  onSubmit={values => createMovement('expense', values)}
                />
              </Card>
            </div>
          )}

          {manualMovements.length > 0 || pending.length > 0 ? (
            <Card className="overflow-hidden">
              <div className="border-b px-5 py-4">
                <p className="font-semibold">Mouvements manuels du jour</p>
              </div>
              <div className="divide-y">
                {pending.map(operation => (
                  <div
                    key={operation.local_id}
                    className="flex items-center gap-3 px-5 py-3"
                  >
                    <CloudOff className="size-4 shrink-0 text-amber-600" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {operation.label}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        En attente · {operation.note || 'Sans note'}
                      </p>
                    </div>
                    <span
                      className={`font-semibold tabular-nums ${operation.kind === 'deposit' ? 'text-emerald-700' : 'text-destructive'}`}
                    >
                      {operation.kind === 'deposit' ? '+' : '-'}
                      {fmtTND(operation.amount)} TND
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9"
                      onClick={() => {
                        void offlineCaisseService
                          .remove(operation.local_id)
                          .then(refresh);
                      }}
                      title="Retirer de la file"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                {manualMovements.map(movement => (
                  <div
                    key={movement.id}
                    className="flex items-center gap-3 px-5 py-3"
                  >
                    {movement.movement_type === 'deposit' ? (
                      <ArrowDownToLine className="size-4 shrink-0 text-emerald-700" />
                    ) : (
                      <ArrowUpFromLine className="size-4 shrink-0 text-destructive" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {movement.category_display}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {movement.created_by_name || 'Utilisateur'} ·{' '}
                        {movement.note || 'Sans note'}
                      </p>
                    </div>
                    <span
                      className={`font-semibold tabular-nums ${movement.movement_type === 'deposit' ? 'text-emerald-700' : 'text-destructive'}`}
                    >
                      {movement.movement_type === 'deposit' ? '+' : '-'}
                      {fmtTND(movement.amount)} TND
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9"
                      onClick={() => void removeMovement(movement.id)}
                      disabled={isClosed}
                      title="Annuler le mouvement"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="journal">
          <Card className="overflow-hidden">
            <div className="border-b px-5 py-4">
              <p className="font-semibold">Toutes les opérations du jour</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Ventes, retours, entrées et sorties, triés du plus récent au
                plus ancien.
              </p>
            </div>
            {journal.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                Aucune opération enregistrée.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
                      <th className="px-5 py-3 font-medium">Heure</th>
                      <th className="px-4 py-3 font-medium">Type</th>
                      <th className="px-4 py-3 font-medium">Détail</th>
                      <th className="px-4 py-3 font-medium">Utilisateur</th>
                      <th className="px-5 py-3 text-right font-medium">
                        Montant
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {journal.map(row => (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                          {new Date(row.occurred_at).toLocaleTimeString(
                            'fr-FR',
                            { hour: '2-digit', minute: '2-digit' }
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline">{row.type_display}</Badge>
                        </td>
                        <td className="max-w-80 break-words px-4 py-3">
                          {row.detail}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {row.created_by_name || '—'}
                        </td>
                        <td
                          className={`px-5 py-3 text-right font-semibold tabular-nums ${row.direction === 'in' ? 'text-emerald-700' : 'text-destructive'}`}
                        >
                          {row.direction === 'in' ? '+' : '-'}
                          {fmtTND(row.amount)} TND
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card className="overflow-hidden">
            <div className="border-b px-5 py-4">
              <p className="font-semibold">Historique des journées</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Les clôtures restent figées et consultables.
              </p>
            </div>
            {history.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                Aucune journée de caisse enregistrée.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1240px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
                      <th className="px-5 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 text-right font-medium">
                        Ouverture
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Espèces
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Carte
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        CA net
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Théorique
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Compté
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Écart
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Tickets
                      </th>
                      <th className="px-4 py-3 font-medium">Caissier</th>
                      <th className="px-4 py-3 font-medium">Statut</th>
                      <th className="px-5 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(row => (
                      <tr
                        key={row.id}
                        className="border-b last:border-0 hover:bg-muted/20"
                      >
                        <td className="whitespace-nowrap px-5 py-3 font-medium">
                          {formatDate(row.business_date)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {fmtTND(row.opening_cash)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {fmtTND(row.summary.cash_sales)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {fmtTND(row.summary.card_sales)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">
                          {fmtTND(row.summary.revenue)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {fmtTND(
                            row.closing_cash_expected ??
                              row.summary.cash_balance
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {row.closing_cash_actual == null
                            ? '—'
                            : fmtTND(row.closing_cash_actual)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-semibold tabular-nums ${Number(row.cash_difference || 0) < 0 ? 'text-destructive' : Number(row.cash_difference || 0) > 0 ? 'text-emerald-700' : ''}`}
                        >
                          {row.cash_difference == null
                            ? '—'
                            : `${Number(row.cash_difference) > 0 ? '+' : ''}${fmtTND(row.cash_difference)}`}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {row.summary.revenue_count}
                        </td>
                        <td className="max-w-44 truncate px-4 py-3">
                          {row.closed_by_name ||
                            row.opened_by_name ||
                            'Automatique'}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={
                              row.status === 'CLOSED' ? 'secondary' : 'outline'
                            }
                          >
                            {row.status === 'CLOSED' ? 'Clôturée' : 'Ouverte'}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-9"
                            onClick={() => void openHistoryDetail(row)}
                            title="Voir le détail"
                          >
                            <Eye className="size-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={closeOpen}
        onOpenChange={next => !closing && setCloseOpen(next)}
      >
        <POSDialogContent size="compact">
          <POSDialogHeader
            title="Clôture de caisse"
            description={`Journée du ${current ? formatDate(current.business_date) : ''}`}
            aside={<LockKeyhole className="size-6" />}
          />
          <POSDialogBody className="space-y-5">
            <div className="flex items-end justify-between gap-4 border-b pb-4">
              <span className="text-sm text-muted-foreground">
                Caisse théorique
              </span>
              <span className="text-2xl font-bold tabular-nums">
                {fmtTND(summary.cash_balance)} TND
              </span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="closing-cash">Montant réellement compté</Label>
              <div className="relative">
                <Input
                  id="closing-cash"
                  value={closingAmount}
                  onChange={event => setClosingAmount(event.target.value)}
                  inputMode="decimal"
                  autoFocus
                  className="h-12 pr-12 text-xl font-semibold tabular-nums"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
                  TND
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border px-4 py-3">
              <span className="font-semibold">Écart</span>
              <span
                className={`text-xl font-bold tabular-nums ${liveDifference < 0 ? 'text-destructive' : liveDifference > 0 ? 'text-emerald-700' : ''}`}
              >
                {liveDifference > 0 ? '+' : ''}
                {fmtTND(liveDifference)} TND
              </span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="closing-note">
                Note de clôture{' '}
                <span className="font-normal text-muted-foreground">
                  (optionnelle)
                </span>
              </Label>
              <Textarea
                id="closing-note"
                value={closingNote}
                onChange={event => setClosingNote(event.target.value)}
                placeholder="Ex. erreur de monnaie…"
              />
            </div>
          </POSDialogBody>
          <POSDialogFooter>
            <POSSecondaryButton
              onClick={() => setCloseOpen(false)}
              disabled={closing}
            >
              Annuler
            </POSSecondaryButton>
            <POSPrimaryButton
              onClick={() => void closeSession()}
              disabled={closing || closingAmount.trim() === ''}
            >
              {closing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LockKeyhole className="size-4" />
              )}{' '}
              Clôturer la caisse
            </POSPrimaryButton>
          </POSDialogFooter>
        </POSDialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedHistory)}
        onOpenChange={next => {
          if (!next) {
            setSelectedHistory(null);
            setSelectedHistoryJournal([]);
          }
        }}
      >
        <POSDialogContent size="default">
          <POSDialogHeader
            title="Détail de la journée"
            description={
              selectedHistory
                ? `${formatDate(selectedHistory.business_date)} · ${selectedHistory.sales_channel_name}`
                : ''
            }
            aside={<CalendarDays className="size-6" />}
          />
          {selectedHistory ? (
            <POSDialogBody className="space-y-6">
              <SessionSummary summary={selectedHistory.summary} />
              <Separator />
              <div className="grid gap-4 sm:grid-cols-2">
                <Metric
                  label="Ouvert par"
                  value={selectedHistory.opened_by_name || 'Automatique'}
                  hint={new Date(selectedHistory.opened_at).toLocaleString(
                    'fr-FR'
                  )}
                />
                <Metric
                  label="Clôturé par"
                  value={selectedHistory.closed_by_name || '—'}
                  hint={
                    selectedHistory.closed_at
                      ? new Date(selectedHistory.closed_at).toLocaleString(
                          'fr-FR'
                        )
                      : 'Journée encore ouverte'
                  }
                />
                <Metric
                  label="Montant compté"
                  value={
                    selectedHistory.closing_cash_actual == null
                      ? '—'
                      : `${fmtTND(selectedHistory.closing_cash_actual)} TND`
                  }
                />
                <Metric
                  label="Écart final"
                  value={
                    selectedHistory.cash_difference == null
                      ? '—'
                      : `${Number(selectedHistory.cash_difference) > 0 ? '+' : ''}${fmtTND(selectedHistory.cash_difference)} TND`
                  }
                  tone={
                    Number(selectedHistory.cash_difference || 0) < 0
                      ? 'negative'
                      : Number(selectedHistory.cash_difference || 0) > 0
                        ? 'positive'
                        : 'default'
                  }
                />
              </div>
              {selectedHistory.closing_note ? (
                <div className="rounded-md border p-4">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    Note de clôture
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm">
                    {selectedHistory.closing_note}
                  </p>
                </div>
              ) : null}
              <section>
                <h3 className="font-semibold">Journal de la journée</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ventes, retours et mouvements manuels dans l’ordre
                  chronologique.
                </p>
                {historyDetailLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-5 animate-spin" />
                  </div>
                ) : selectedHistoryJournal.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Aucune opération enregistrée.
                  </p>
                ) : (
                  <div className="mt-4 overflow-x-auto border-y">
                    <table className="w-full min-w-[620px] text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
                          <th className="px-3 py-2 font-medium">Heure</th>
                          <th className="px-3 py-2 font-medium">Type</th>
                          <th className="px-3 py-2 font-medium">Détail</th>
                          <th className="px-3 py-2 font-medium">Utilisateur</th>
                          <th className="px-3 py-2 text-right font-medium">
                            Montant
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedHistoryJournal.map(row => (
                          <tr key={row.id} className="border-b last:border-0">
                            <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                              {new Date(row.occurred_at).toLocaleTimeString(
                                'fr-FR',
                                { hour: '2-digit', minute: '2-digit' }
                              )}
                            </td>
                            <td className="px-3 py-2">{row.type_display}</td>
                            <td className="max-w-72 break-words px-3 py-2">
                              {row.detail}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {row.created_by_name || '—'}
                            </td>
                            <td
                              className={`px-3 py-2 text-right font-semibold tabular-nums ${row.direction === 'in' ? 'text-emerald-700' : 'text-destructive'}`}
                            >
                              {row.direction === 'in' ? '+' : '-'}
                              {fmtTND(row.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </POSDialogBody>
          ) : null}
          <POSDialogFooter className="sm:justify-end">
            <POSPrimaryButton onClick={() => setSelectedHistory(null)}>
              Fermer
            </POSPrimaryButton>
          </POSDialogFooter>
        </POSDialogContent>
      </Dialog>
    </div>
  );
}
