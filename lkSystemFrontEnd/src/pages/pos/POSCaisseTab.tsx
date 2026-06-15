/**
 * POSCaisseTab — full cash-register (caisse) view for the POS page.
 *
 * Renders:
 *  1. **Caisse statement banner** — the real cash-drawer balance, broken down as
 *     opening float + alimentation + cash sales − expenses − refunds = closing.
 *     Card/transfer sales are shown separately (they don't enter the till).
 *  2. **Alimentation de caisse form** — add cash IN (opening float or top-up).
 *  3. **Dépense form** — record cash OUT.
 *  4. **Today's cash-ins + expenses lists** — each with delete.
 *  5. **History table** — day-by-day sales, funding, expenses and closing balance.
 *
 * Self-contained: only needs the selected channel id from the parent.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine, CloudOff, Loader2, Plus, Receipt, RefreshCw, Trash2, Wallet,
} from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import {
  offlineCaisseService,
  type PendingCaisseOp,
} from '@/services/offlineCaisse.service';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  expenseService,
  cashDepositService,
  EXPENSE_CATEGORY_OPTIONS,
  CASH_DEPOSIT_KIND_OPTIONS,
  type Expense,
  type CashDeposit,
  type CashDepositKind,
  type CaisseStats,
  type CaisseMovement,
  type ExpenseCategory,
} from '@/services/expense.service';

const fmtTND = (raw: string | number): string => {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  if (Number.isNaN(n)) return '0.000';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
};

// Per-type badge colour for the caisse journal (Historique de caisse).
const MOVEMENT_BADGE: Record<string, string> = {
  sale: 'border-emerald-200 text-emerald-700',
  return: 'border-red-200 text-red-700',
  expense: 'border-amber-200 text-amber-700',
  deposit: 'border-blue-200 text-blue-700',
};

// A failed request with no HTTP response is a connectivity problem (offline /
// timeout) → safe to queue the write locally and replay it later. A response
// (4xx/5xx) means the server rejected it → surface the error instead.
const isNetworkError = (err: unknown): boolean => {
  const e = err as { response?: unknown; code?: string };
  return !e?.response || e?.code === 'ERR_NETWORK' || e?.code === 'ECONNABORTED';
};

// Pull a human message out of a DRF error body without leaning on `any`.
const extractApiError = (err: unknown, fallback: string): string => {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (typeof data === 'string' && data.trim()) return data;
  if (data && typeof data === 'object') {
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    const joined = Object.values(data as Record<string, unknown>)
      .flat()
      .filter((v): v is string => typeof v === 'string')
      .join(' ');
    if (joined.trim()) return joined;
  }
  return fallback;
};

interface Props {
  channelId: number | null;
  channelName?: string;
  refreshSignal?: number;
  onAfterChange?: () => void; // parent may want to refresh other tiles
}

function StatLine({
  label, value, sign, tone,
}: {
  label: string;
  value: string | number;
  sign: '+' | '−';
  tone?: 'in' | 'out';
}) {
  const color = tone === 'in' ? 'text-emerald-700' : tone === 'out' ? 'text-red-700' : '';
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${color}`}>{sign} {fmtTND(value)}</span>
    </div>
  );
}

export function CaisseStatsBanner({ stats, loading }: { stats: CaisseStats | null; loading: boolean }) {
  if (loading && !stats) {
    return (
      <div className="rounded-md border bg-card/80 p-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Chargement de la caisse…
      </div>
    );
  }
  if (!stats) return null;
  const balance = Number(stats.cash_balance);
  const balColor = balance >= 0 ? 'text-emerald-700' : 'text-red-700';
  const otherExpenses = Number(stats.expenses) - Number(stats.refunds);
  const cardSales = Number(stats.card_sales);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Solde caisse (espèces)</p>
          <p className={`text-3xl font-bold tabular-nums ${balColor}`}>
            {fmtTND(stats.cash_balance)} <span className="text-sm font-normal text-muted-foreground">TND</span>
          </p>
        </div>
        <Wallet className={`size-8 ${balColor}`} />
      </div>

      <Separator className="my-3" />

      <div className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
        <StatLine label="Fond de caisse (ouverture)" value={stats.opening} sign="+" tone="in" />
        <StatLine label="Alimentation (ajouts)" value={stats.cash_added} sign="+" tone="in" />
        <StatLine label={`Ventes espèces (${stats.revenue_count})`} value={stats.cash_sales} sign="+" tone="in" />
        <StatLine label="Dépenses" value={otherExpenses} sign="−" tone="out" />
        <StatLine label="Remboursements" value={stats.refunds} sign="−" tone="out" />
      </div>

      {cardSales > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          + {fmtTND(stats.card_sales)} TND encaissés par carte / virement — hors caisse espèces.
        </p>
      )}
    </Card>
  );
}

export default function POSCaisseTab({ channelId, channelName, refreshSignal = 0, onAfterChange }: Props) {
  const [stats, setStats] = useState<CaisseStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [journal, setJournal] = useState<CaisseMovement[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [deposits, setDeposits] = useState<CashDeposit[]>([]);
  const [listLoading, setListLoading] = useState(false);

  // Dépense (cash-out) form
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('OTHER');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Alimentation (cash-in) form
  const [depAmount, setDepAmount] = useState('');
  const [depKind, setDepKind] = useState<CashDepositKind>('TOP_UP');
  const [depNote, setDepNote] = useState('');
  const [depSubmitting, setDepSubmitting] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  // ── Offline (queued) cash operations ─────────────────────────────────────
  const online = useOnlineStatus();
  const [pending, setPending] = useState<PendingCaisseOp[]>([]);
  const [syncing, setSyncing] = useState(false);
  // Guards against a second sync starting before the first finishes (which
  // could double-POST a queued op) — refs don't trigger re-renders.
  const syncingRef = useRef(false);

  const pendingDeposits = useMemo(() => pending.filter(p => p.kind === 'deposit'), [pending]);
  const pendingExpenses = useMemo(() => pending.filter(p => p.kind === 'expense'), [pending]);
  // Net effect of not-yet-synced ops on the cash drawer (deposits in, expenses out).
  const pendingNet = useMemo(
    () =>
      pendingDeposits.reduce((s, p) => s + p.amount, 0) -
      pendingExpenses.reduce((s, p) => s + p.amount, 0),
    [pendingDeposits, pendingExpenses],
  );
  const estimatedBalance = useMemo(
    () => (stats ? Number(stats.cash_balance) + pendingNet : pendingNet),
    [stats, pendingNet],
  );

  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const refresh = useCallback(async () => {
    if (!channelId) {
      setStats(null);
      setJournal([]);
      setExpenses([]);
      setDeposits([]);
      setPending([]);
      return;
    }
    setStatsLoading(true);
    setListLoading(true);
    setHistoryLoading(true);
    try {
      const [s, journalRes, expList, depList, pendingOps] = await Promise.all([
        expenseService.caisseStats(channelId).catch(() => null),
        expenseService.caisseJournal(channelId).catch(() => null),
        expenseService.list({ sales_channel: channelId, date_from: todayISO, date_to: todayISO })
          .catch(() => [] as Expense[]),
        cashDepositService.list({ sales_channel: channelId, date_from: todayISO, date_to: todayISO })
          .catch(() => [] as CashDeposit[]),
        offlineCaisseService.listPending(channelId).catch(() => [] as PendingCaisseOp[]),
      ]);
      setStats(s);
      setJournal(journalRes?.movements ?? []);
      setExpenses(expList);
      setDeposits(depList);
      setPending(pendingOps);
    } finally {
      setStatsLoading(false);
      setListLoading(false);
      setHistoryLoading(false);
    }
  }, [channelId, todayISO]);

  useEffect(() => { void refresh(); }, [refresh, refreshSignal]);

  const parseAmount = (raw: string) => Number(raw.replace(',', '.'));

  const submitExpense = useCallback(async () => {
    setError(null);
    setOkMessage(null);
    if (!channelId) { setError('Sélectionnez d\'abord une caisse.'); return; }
    const n = parseAmount(amount);
    if (!n || n <= 0) { setError('Le montant de la dépense doit être strictement positif.'); return; }
    const payload = { sales_channel: channelId, amount: n, category, note: note.trim() };
    const label = EXPENSE_CATEGORY_OPTIONS.find(o => o.value === category)?.label ?? category;
    const queueOffline = async () => {
      await offlineCaisseService.queueExpense(payload, label);
      setAmount(''); setNote(''); setCategory('OTHER');
      setOkMessage(`Dépense de ${fmtTND(n)} TND enregistrée hors ligne — synchronisation à la reconnexion.`);
      await refresh();
    };
    setSubmitting(true);
    try {
      if (!online) { await queueOffline(); return; }
      await expenseService.create(payload);
      setAmount(''); setNote(''); setCategory('OTHER');
      setOkMessage(`Dépense de ${fmtTND(n)} TND enregistrée.`);
      await refresh();
      onAfterChange?.();
    } catch (err) {
      if (isNetworkError(err)) { await queueOffline(); return; }
      setError(extractApiError(err, 'Échec de l\'enregistrement de la dépense.'));
    } finally {
      setSubmitting(false);
    }
  }, [amount, category, note, channelId, online, refresh, onAfterChange]);

  const submitDeposit = useCallback(async () => {
    setError(null);
    setOkMessage(null);
    if (!channelId) { setError('Sélectionnez d\'abord une caisse.'); return; }
    const n = parseAmount(depAmount);
    if (!n || n <= 0) { setError('Le montant de l\'alimentation doit être strictement positif.'); return; }
    const payload = { sales_channel: channelId, amount: n, kind: depKind, note: depNote.trim() };
    const label = CASH_DEPOSIT_KIND_OPTIONS.find(o => o.value === depKind)?.label ?? depKind;
    const queueOffline = async () => {
      await offlineCaisseService.queueDeposit(payload, label);
      setDepAmount(''); setDepNote(''); setDepKind('TOP_UP');
      setOkMessage(`Alimentation de ${fmtTND(n)} TND enregistrée hors ligne — synchronisation à la reconnexion.`);
      await refresh();
    };
    setDepSubmitting(true);
    try {
      if (!online) { await queueOffline(); return; }
      await cashDepositService.create(payload);
      setDepAmount(''); setDepNote(''); setDepKind('TOP_UP');
      setOkMessage(`Alimentation de ${fmtTND(n)} TND enregistrée.`);
      await refresh();
      onAfterChange?.();
    } catch (err) {
      if (isNetworkError(err)) { await queueOffline(); return; }
      setError(extractApiError(err, 'Échec de l\'enregistrement de l\'alimentation.'));
    } finally {
      setDepSubmitting(false);
    }
  }, [depAmount, depKind, depNote, channelId, online, refresh, onAfterChange]);

  const handleDeleteExpense = useCallback(async (id: number) => {
    if (!confirm('Supprimer cette dépense ? Le solde sera ajusté.')) return;
    try {
      await expenseService.remove(id);
      await refresh();
      onAfterChange?.();
    } catch {
      setError('Impossible de supprimer la dépense.');
    }
  }, [refresh, onAfterChange]);

  const handleDeleteDeposit = useCallback(async (id: number) => {
    if (!confirm('Supprimer cette alimentation ? Le solde sera ajusté.')) return;
    try {
      await cashDepositService.remove(id);
      await refresh();
      onAfterChange?.();
    } catch {
      setError('Impossible de supprimer l\'alimentation.');
    }
  }, [refresh, onAfterChange]);

  // Drop a not-yet-synced (offline) operation from the local queue.
  const handleRemovePending = useCallback(async (localId: string) => {
    await offlineCaisseService.remove(localId);
    await refresh();
  }, [refresh]);

  // On reconnect, flush any queued cash operations to the backend, then refresh.
  useEffect(() => {
    if (!online || !channelId || syncingRef.current) return;
    let cancelled = false;
    void (async () => {
      const queued = await offlineCaisseService.listPending(channelId).catch(() => []);
      if (cancelled || queued.length === 0 || syncingRef.current) return;
      syncingRef.current = true;
      setSyncing(true);
      try {
        const res = await offlineCaisseService.sync(channelId);
        if (cancelled) return;
        if (res.synced > 0) {
          setOkMessage(`${res.synced} opération(s) de caisse synchronisée(s).`);
          onAfterChange?.();
        }
        await refresh();
      } finally {
        syncingRef.current = false;
        if (!cancelled) setSyncing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [online, channelId, refresh, onAfterChange]);

  if (!channelId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Sélectionnez une caisse en haut de la page pour gérer le fond, les alimentations et les dépenses.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-1">
      {/* Cash register statement */}
      <CaisseStatsBanner stats={stats} loading={statsLoading} />

      {/* Offline / pending-sync status */}
      {(!online || pending.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span className="flex items-center gap-1.5 font-medium">
            {syncing
              ? <RefreshCw className="size-3.5 animate-spin" />
              : <CloudOff className="size-3.5" />}
            {!online ? 'Hors ligne' : syncing ? 'Synchronisation…' : 'Reconnecté'}
          </span>
          {pending.length > 0 ? (
            <span>
              {pending.length} opération(s) en attente · solde estimé{' '}
              <span className="font-semibold tabular-nums">{fmtTND(estimatedBalance)} TND</span>
            </span>
          ) : (
            <span className="text-amber-800">
              Dépenses et alimentations seront enregistrées localement et synchronisées à la reconnexion.
            </span>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Wallet className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Caisse du jour {channelName ? `· ${channelName}` : ''}</h2>
        </div>
        <Badge variant="outline" className="text-[11px]">Date: {todayISO}</Badge>
      </div>

      {/* Forms: alimentation (in) + dépense (out) */}
      <div className="grid gap-3 lg:grid-cols-2">
        {/* Alimentation de caisse */}
        <Card className="p-4 border-emerald-200">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-emerald-800">
            <ArrowDownToLine className="size-4" /> Alimentation de caisse
          </p>
          <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
            <div>
              <label className="text-[11px] text-muted-foreground">Montant (TND)</label>
              <Input
                type="number" inputMode="decimal" step="0.001" min="0"
                value={depAmount} onChange={e => setDepAmount(e.target.value)}
                placeholder="0.000" className="mt-1 h-9 tabular-nums"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Type</label>
              <Select value={depKind} onValueChange={v => setDepKind(v as CashDepositKind)}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CASH_DEPOSIT_KIND_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Textarea
            value={depNote} onChange={e => setDepNote(e.target.value)}
            placeholder="Note (optionnel) — ex: fond de caisse matin…"
            className="mt-3 min-h-[44px] resize-none"
          />
          <Button type="button" onClick={submitDeposit} disabled={depSubmitting} className="mt-3 h-9 w-full gap-2">
            {depSubmitting ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Ajouter à la caisse
          </Button>
        </Card>

        {/* Dépense */}
        <Card className="p-4 border-red-200">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-red-800">
            <Receipt className="size-4" /> Ajouter une dépense
          </p>
          <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
            <div>
              <label className="text-[11px] text-muted-foreground">Montant (TND)</label>
              <Input
                type="number" inputMode="decimal" step="0.001" min="0"
                value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0.000" className="mt-1 h-9 tabular-nums"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Catégorie</label>
              <Select value={category} onValueChange={v => setCategory(v as ExpenseCategory)}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORY_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Textarea
            value={note} onChange={e => setNote(e.target.value)}
            placeholder="Note (optionnel) — ex: Taxi pour livraison express…"
            className="mt-3 min-h-[44px] resize-none"
          />
          <Button type="button" onClick={submitExpense} disabled={submitting} className="mt-3 h-9 w-full gap-2" variant="secondary">
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Enregistrer la dépense
          </Button>
        </Card>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {okMessage && <p className="text-xs text-emerald-700">{okMessage}</p>}

      {/* Today's movements */}
      <div className="grid gap-3 lg:grid-cols-2">
        {/* Cash-ins */}
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium">Alimentations aujourd&apos;hui</p>
            <span className="text-xs text-muted-foreground">
              {deposits.length + pendingDeposits.length} ligne{deposits.length + pendingDeposits.length === 1 ? '' : 's'}
            </span>
          </div>
          <Separator className="mb-2" />
          {listLoading ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              <Loader2 className="mr-1.5 inline size-4 animate-spin" /> Chargement…
            </div>
          ) : deposits.length === 0 && pendingDeposits.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">Aucune alimentation aujourd&apos;hui.</p>
          ) : (
            <ul className="divide-y">
              {pendingDeposits.map(op => (
                <li key={op.local_id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">{op.label}</Badge>
                      <Badge variant="secondary" className="gap-1 text-[10px] text-amber-700">
                        <CloudOff className="size-3" /> En attente
                      </Badge>
                    </div>
                    {op.note && <p className="mt-1 break-words text-xs">{op.note}</p>}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-emerald-700">+ {fmtTND(op.amount)}</span>
                    <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => handleRemovePending(op.local_id)} title="Retirer de la file d'attente">
                      <Trash2 className="size-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                </li>
              ))}
              {deposits.map(dep => (
                <li key={dep.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">{dep.kind_display}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(dep.occurred_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {dep.created_by_name && <span className="text-[11px] text-muted-foreground">· {dep.created_by_name}</span>}
                    </div>
                    {dep.note && <p className="mt-1 break-words text-xs">{dep.note}</p>}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-emerald-700">+ {fmtTND(dep.amount)}</span>
                    <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => handleDeleteDeposit(dep.id)} title="Supprimer">
                      <Trash2 className="size-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Cash-outs */}
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium">Dépenses aujourd&apos;hui</p>
            <span className="text-xs text-muted-foreground">
              {expenses.length + pendingExpenses.length} ligne{expenses.length + pendingExpenses.length === 1 ? '' : 's'}
            </span>
          </div>
          <Separator className="mb-2" />
          {listLoading ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              <Loader2 className="mr-1.5 inline size-4 animate-spin" /> Chargement…
            </div>
          ) : expenses.length === 0 && pendingExpenses.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">Aucune dépense aujourd&apos;hui.</p>
          ) : (
            <ul className="divide-y">
              {pendingExpenses.map(op => (
                <li key={op.local_id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">{op.label}</Badge>
                      <Badge variant="secondary" className="gap-1 text-[10px] text-amber-700">
                        <CloudOff className="size-3" /> En attente
                      </Badge>
                    </div>
                    {op.note && <p className="mt-1 break-words text-xs">{op.note}</p>}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-red-700">− {fmtTND(op.amount)}</span>
                    <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => handleRemovePending(op.local_id)} title="Retirer de la file d'attente">
                      <Trash2 className="size-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                </li>
              ))}
              {expenses.map(exp => (
                <li key={exp.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">{exp.category_display}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(exp.occurred_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {exp.created_by_name && <span className="text-[11px] text-muted-foreground">· {exp.created_by_name}</span>}
                    </div>
                    {exp.note && <p className="mt-1 break-words text-xs">{exp.note}</p>}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-red-700">− {fmtTND(exp.amount)}</span>
                    <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => handleDeleteExpense(exp.id)} title="Supprimer">
                      <Trash2 className="size-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* History */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Historique de caisse</p>
            <p className="text-xs text-muted-foreground">Ventes, retours, dépenses et alimentations — par transaction.</p>
          </div>
          <Badge variant="secondary" className="text-[11px]">14 jours</Badge>
        </div>
        <Separator className="mb-2" />
        {historyLoading ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            <Loader2 className="mr-1.5 inline size-4 animate-spin" /> Chargement…
          </div>
        ) : journal.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Aucun mouvement de caisse.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 font-medium">Date &amp; heure</th>
                  <th className="py-2 font-medium">Type</th>
                  <th className="py-2 font-medium">Détail</th>
                  <th className="py-2 text-right font-medium">Montant</th>
                </tr>
              </thead>
              <tbody>
                {journal.map(m => {
                  const isIn = m.direction === 'in';
                  return (
                    <tr key={m.id} className="border-b last:border-0">
                      <td className="py-2 whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(m.occurred_at).toLocaleString('fr-FR', {
                          day: '2-digit', month: '2-digit', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td className="py-2">
                        <Badge variant="outline" className={`text-[10px] ${MOVEMENT_BADGE[m.type] ?? ''}`}>
                          {m.type_display}
                        </Badge>
                      </td>
                      <td className="py-2">
                        <span className="break-words">{m.detail}</span>
                        {m.type === 'sale' && m.payment_method && (
                          <span className="ml-1.5 text-[11px] text-muted-foreground">· {m.payment_method}</span>
                        )}
                        {m.created_by_name && (
                          <span className="ml-1.5 text-[11px] text-muted-foreground">· {m.created_by_name}</span>
                        )}
                      </td>
                      <td className={`py-2 text-right font-semibold tabular-nums ${isIn ? 'text-emerald-700' : 'text-red-700'}`}>
                        {isIn ? '+' : '−'} {fmtTND(m.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
