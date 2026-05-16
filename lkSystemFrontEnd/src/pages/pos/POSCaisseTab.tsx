/**
 * POSCaisseTab — Dépenses (caisse expenses) tab content for the POS page.
 *
 * Renders three things:
 *  1. **Caisse Stats banner** — today's revenue, today's expenses, net balance.
 *  2. **Add Dépense form** — amount + category + optional note. Saves via the
 *     /sales-channels/expenses/ endpoint and immediately refreshes the stats.
 *  3. **Today's expenses list** — most-recent first, with delete (which also
 *     refreshes the stats so the net balance stays accurate).
 *
 * The component is intentionally self-contained: it only needs the selected
 * POS channel id from the parent.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Receipt, TrendingDown, TrendingUp, Trash2, Wallet } from 'lucide-react';

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
  EXPENSE_CATEGORY_OPTIONS,
  type Expense,
  type CaisseStats,
  type CaisseHistoryRow,
  type ExpenseCategory,
} from '@/services/expense.service';

const fmtTND = (raw: string | number): string => {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  if (Number.isNaN(n)) return '0.000';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
};

interface Props {
  channelId: number | null;
  channelName?: string;
  refreshSignal?: number;
  onAfterChange?: () => void; // parent may want to refresh other tiles
}

export function CaisseStatsBanner({ stats, loading, compact }: { stats: CaisseStats | null; loading: boolean; compact?: boolean }) {
  if (loading && !stats) {
    return (
      <div className="rounded-md border bg-card/80 p-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading caisse stats…
      </div>
    );
  }
  if (!stats) return null;
  const net = Number(stats.net_balance);
  const netColor = net >= 0 ? 'text-emerald-700' : 'text-red-700';
  return (
    <div className={`grid gap-2 ${compact ? 'grid-cols-3' : 'grid-cols-1 sm:grid-cols-3'}`}>
      <Card className="p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Recettes aujourd'hui</p>
          <TrendingUp className="size-4 text-emerald-600" />
        </div>
        <p className="mt-1 text-xl font-semibold tabular-nums">{fmtTND(stats.revenue)} <span className="text-xs font-normal text-muted-foreground">TND</span></p>
        <p className="text-[11px] text-muted-foreground">{stats.revenue_count} ticket{stats.revenue_count === 1 ? '' : 's'}</p>
      </Card>
      <Card className="p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Dépenses aujourd'hui</p>
          <TrendingDown className="size-4 text-red-600" />
        </div>
        <p className="mt-1 text-xl font-semibold tabular-nums">{fmtTND(stats.expenses)} <span className="text-xs font-normal text-muted-foreground">TND</span></p>
        <p className="text-[11px] text-muted-foreground">{stats.expenses_count} sortie{stats.expenses_count === 1 ? '' : 's'}</p>
      </Card>
      <Card className="p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Net caisse</p>
          <Wallet className={`size-4 ${netColor}`} />
        </div>
        <p className={`mt-1 text-xl font-semibold tabular-nums ${netColor}`}>{fmtTND(stats.net_balance)} <span className="text-xs font-normal text-muted-foreground">TND</span></p>
        <p className="text-[11px] text-muted-foreground">Recettes − Dépenses</p>
      </Card>
    </div>
  );
}

export default function POSCaisseTab({ channelId, channelName, refreshSignal = 0, onAfterChange }: Props) {
  const [stats, setStats] = useState<CaisseStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [historyRows, setHistoryRows] = useState<CaisseHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('OTHER');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const refresh = useCallback(async () => {
    if (!channelId) {
      setStats(null);
      setHistoryRows([]);
      setExpenses([]);
      return;
    }
    setStatsLoading(true);
    setListLoading(true);
    setHistoryLoading(true);
    try {
      const [s, history, list] = await Promise.all([
        expenseService.caisseStats(channelId).catch(() => null),
        expenseService.caisseHistory(channelId).catch(() => [] as CaisseHistoryRow[]),
        expenseService.list({
          sales_channel: channelId,
          date_from: todayISO,
          date_to: todayISO,
        }).catch(() => [] as Expense[]),
      ]);
      setStats(s);
      setHistoryRows(history);
      setExpenses(list);
    } finally {
      setStatsLoading(false);
      setListLoading(false);
      setHistoryLoading(false);
    }
  }, [channelId, todayISO]);

  useEffect(() => { void refresh(); }, [refresh, refreshSignal]);

  const submit = useCallback(async () => {
    setError(null);
    setOkMessage(null);
    if (!channelId) {
      setError('Sélectionnez d\'abord une caisse POS.');
      return;
    }
    const n = Number(amount.replace(',', '.'));
    if (!n || n <= 0) {
      setError('Le montant doit être strictement positif.');
      return;
    }
    setSubmitting(true);
    try {
      await expenseService.create({
        sales_channel: channelId,
        amount: n,
        category,
        note: note.trim(),
      });
      setAmount('');
      setNote('');
      setCategory('OTHER');
      setOkMessage(`Dépense de ${fmtTND(n)} TND enregistrée.`);
      await refresh();
      onAfterChange?.();
    } catch (err: any) {
      const data = err?.response?.data;
      setError(
        (typeof data === 'string' && data) ||
        data?.detail ||
        (data && Object.values(data).flat().join(' ')) ||
        'Échec de l\'enregistrement de la dépense.'
      );
    } finally {
      setSubmitting(false);
    }
  }, [amount, category, note, channelId, refresh, onAfterChange]);

  const handleDelete = useCallback(async (id: number) => {
    if (!confirm('Supprimer cette dépense ? Le solde net sera ajusté.')) return;
    try {
      await expenseService.remove(id);
      await refresh();
      onAfterChange?.();
    } catch {
      setError('Impossible de supprimer la dépense.');
    }
  }, [refresh, onAfterChange]);

  if (!channelId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Sélectionnez une caisse POS en haut de la page pour gérer ses dépenses.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-1">
      {/* Stats banner */}
      <CaisseStatsBanner stats={stats} loading={statsLoading} />

      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Receipt className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Dépenses du jour {channelName ? `· ${channelName}` : ''}</h2>
        </div>
        <Badge variant="outline" className="text-[11px]">Date: {todayISO}</Badge>
      </div>

      {/* Add expense form */}
      <Card className="p-4">
        <p className="text-sm font-medium mb-3">Ajouter une dépense</p>
        <div className="grid gap-3 md:grid-cols-[160px_1fr_auto]">
          <div>
            <label className="text-[11px] text-muted-foreground">Montant (TND)</label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.001"
              min="0"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.000"
              className="mt-1 h-9 tabular-nums"
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Catégorie</label>
            <Select value={category} onValueChange={v => setCategory(v as ExpenseCategory)}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORY_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="h-9 gap-2"
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Enregistrer
            </Button>
          </div>
        </div>
        <div className="mt-3">
          <label className="text-[11px] text-muted-foreground">Note (optionnel)</label>
          <Textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Ex: Taxi pour livraison express…"
            className="mt-1 min-h-[60px] resize-none"
          />
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        {okMessage && <p className="mt-2 text-xs text-emerald-700">{okMessage}</p>}
      </Card>

      {/* Today's expenses list */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium">Sorties d'argent aujourd'hui</p>
          <span className="text-xs text-muted-foreground">
            {expenses.length} ligne{expenses.length === 1 ? '' : 's'}
          </span>
        </div>
        <Separator className="mb-2" />
        {listLoading ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin inline mr-1.5" /> Chargement…
          </div>
        ) : expenses.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Aucune dépense enregistrée aujourd'hui.</p>
        ) : (
          <ul className="divide-y">
            {expenses.map(exp => (
              <li key={exp.id} className="py-2 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px]">{exp.category_display}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(exp.occurred_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {exp.created_by_name && (
                      <span className="text-[11px] text-muted-foreground">· {exp.created_by_name}</span>
                    )}
                  </div>
                  {exp.note && <p className="mt-1 text-xs whitespace-normal break-words">{exp.note}</p>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-sm font-semibold tabular-nums text-red-700">
                    − {fmtTND(exp.amount)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => handleDelete(exp.id)}
                    title="Supprimer"
                  >
                    <Trash2 className="size-3.5 text-muted-foreground" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Receipt history */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Historique des recettes</p>
            <p className="text-xs text-muted-foreground">Derniers jours, recettes, dépenses et solde net.</p>
          </div>
          <Badge variant="secondary" className="text-[11px]">14 jours</Badge>
        </div>
        <Separator className="mb-2" />
        {historyLoading ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            <Loader2 className="mr-1.5 inline size-4 animate-spin" /> Chargement…
          </div>
        ) : historyRows.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Aucun historique de caisse.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 text-right font-medium">Tickets</th>
                  <th className="py-2 text-right font-medium">Recettes</th>
                  <th className="py-2 text-right font-medium">Dépenses</th>
                  <th className="py-2 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map(row => {
                  const net = Number(row.net_balance);
                  const netColor = net >= 0 ? 'text-emerald-700' : 'text-red-700';
                  return (
                    <tr key={row.date} className="border-b last:border-0">
                      <td className="py-2 font-medium">
                        {new Date(`${row.date}T00:00:00`).toLocaleDateString('fr-FR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="py-2 text-right tabular-nums">{row.revenue_count}</td>
                      <td className="py-2 text-right tabular-nums">{fmtTND(row.revenue)} TND</td>
                      <td className="py-2 text-right tabular-nums text-red-700">
                        - {fmtTND(row.expenses)} TND
                      </td>
                      <td className={`py-2 text-right font-semibold tabular-nums ${netColor}`}>
                        {fmtTND(row.net_balance)} TND
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
