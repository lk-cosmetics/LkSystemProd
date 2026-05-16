import { memo } from 'react';
import { IconTrendingDown, IconTrendingUp } from '@tabler/icons-react';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import type { BISummary } from '@/services/bi.service';

import { fmtMoneyCompact, fmtNumber, fmtPercent } from './utils';

interface KpiCardProps {
  label: string;
  value: string;
  delta: number;
  hint: string;
}

function trendBadge(delta: number) {
  const variant = delta >= 0 ? 'default' : 'destructive';
  const Icon = delta >= 0 ? IconTrendingUp : IconTrendingDown;
  return (
    <Badge variant={variant === 'default' ? 'outline' : 'destructive'} className="gap-1">
      <Icon className="size-3.5" />
      {fmtPercent(delta)}
    </Badge>
  );
}

function trendText(delta: number, kind: string) {
  if (delta > 0) return `${kind} up vs previous period`;
  if (delta < 0) return `${kind} down vs previous period`;
  return `${kind} flat vs previous period`;
}

function KpiCard({ label, value, delta, hint }: KpiCardProps) {
  const Icon = delta >= 0 ? IconTrendingUp : IconTrendingDown;
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[200px]/card:text-3xl">
          {value}
        </CardTitle>
        <CardAction>{trendBadge(delta)}</CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1.5 text-sm">
        <div className="line-clamp-1 flex gap-2 font-medium">
          {trendText(delta, label)} <Icon className="size-4" />
        </div>
        <div className="text-muted-foreground">{hint}</div>
      </CardFooter>
    </Card>
  );
}

function KpiSkeleton() {
  return (
    <Card className="@container/card">
      <CardHeader>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-2 h-8 w-32" />
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-32" />
      </CardFooter>
    </Card>
  );
}

interface Props {
  summary: BISummary | undefined;
  isLoading: boolean;
}

function BIKpiCardsImpl({ summary, isLoading }: Props) {
  const baseGrid =
    'grid grid-cols-1 gap-4 px-4 sm:grid-cols-2 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4';

  if (!summary && isLoading) {
    return (
      <div className={baseGrid}>
        <KpiSkeleton /><KpiSkeleton /><KpiSkeleton /><KpiSkeleton />
      </div>
    );
  }

  if (!summary) return null;

  const cards: KpiCardProps[] = [
    {
      label: 'Total Revenue',
      value: fmtMoneyCompact(summary.total_revenue),
      delta: summary.growth.revenue,
      hint: `Website ${fmtMoneyCompact(summary.website_revenue)} · POS ${fmtMoneyCompact(summary.pos_revenue)}`,
    },
    {
      label: 'Orders',
      value: fmtNumber(summary.orders_count),
      delta: summary.growth.orders,
      hint: `Previous period: ${fmtNumber(summary.previous.orders_count)}`,
    },
    {
      label: 'Customers',
      value: fmtNumber(summary.customers_count),
      delta: summary.growth.customers,
      hint: `Previous period: ${fmtNumber(summary.previous.customers_count)}`,
    },
    {
      label: 'Avg. Order Value',
      value: fmtMoneyCompact(summary.average_order_value),
      delta: summary.growth.average_order_value,
      hint: `Previous: ${fmtMoneyCompact(summary.previous.average_order_value)}`,
    },
  ];

  return (
    <div className={baseGrid}>
      {cards.map(c => (
        <KpiCard key={c.label} {...c} />
      ))}
    </div>
  );
}

export const BIKpiCards = memo(BIKpiCardsImpl);
