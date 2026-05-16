import { memo, useMemo } from 'react';
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
  IconTrendingDown,
  IconTrendingUp,
} from '@tabler/icons-react';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import type { BISummary } from '@/services/bi.service';

import { fmtPercent } from './utils';

interface Props {
  summary: BISummary | undefined;
  isLoading: boolean;
}

interface InsightItem {
  icon: React.ReactNode;
  title: string;
  description: string;
  tone: 'positive' | 'negative' | 'neutral' | 'warning';
}

function toneClasses(tone: InsightItem['tone']) {
  switch (tone) {
    case 'positive':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
    case 'negative':
      return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300';
    case 'warning':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
    default:
      return 'border-border bg-muted/30 text-foreground';
  }
}

function healthBadge(health: BISummary['insights']['brand_health']) {
  if (health === 'healthy') {
    return (
      <Badge className="gap-1 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300">
        <IconCircleCheck className="size-3.5" /> Healthy
      </Badge>
    );
  }
  if (health === 'critical') {
    return (
      <Badge variant="destructive" className="gap-1">
        <IconAlertTriangle className="size-3.5" /> Critical
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300">
      <IconAlertTriangle className="size-3.5" /> Watch
    </Badge>
  );
}

function BIInsightsPanelImpl({ summary, isLoading }: Props) {
  const items: InsightItem[] = useMemo(() => {
    if (!summary) return [];
    const list: InsightItem[] = [];

    // Revenue trend
    const r = summary.growth.revenue;
    list.push({
      icon: r >= 0 ? <IconTrendingUp className="size-4" /> : <IconTrendingDown className="size-4" />,
      title: r >= 0 ? 'Revenue is growing' : 'Revenue is shrinking',
      description: `Revenue ${fmtPercent(r)} vs the previous period.`,
      tone: r >= 0 ? 'positive' : 'negative',
    });

    // Orders trend
    const o = summary.growth.orders;
    list.push({
      icon: o >= 0 ? <IconTrendingUp className="size-4" /> : <IconTrendingDown className="size-4" />,
      title: o >= 0 ? 'Orders are up' : 'Orders are down',
      description: `Order count ${fmtPercent(o)} vs the previous period.`,
      tone: o >= 0 ? 'positive' : 'negative',
    });

    // Best channel
    if (summary.insights.best_channel) {
      list.push({
        icon: <IconInfoCircle className="size-4" />,
        title: `Best channel: ${summary.insights.best_channel}`,
        description: `${summary.insights.best_channel} leads revenue this period.`,
        tone: 'neutral',
      });
    }

    // AOV trend
    const aov = summary.growth.average_order_value;
    list.push({
      icon: aov >= 0 ? <IconTrendingUp className="size-4" /> : <IconTrendingDown className="size-4" />,
      title: aov >= 0 ? 'Avg. order value rising' : 'Avg. order value falling',
      description: `AOV ${fmtPercent(aov)} vs the previous period.`,
      tone: aov >= 0 ? 'positive' : 'negative',
    });

    // Concentration warnings (from backend)
    for (const w of summary.insights.warnings) {
      list.push({
        icon: <IconAlertTriangle className="size-4" />,
        title: 'Channel concentration risk',
        description: w.message,
        tone: 'warning',
      });
    }

    return list;
  }, [summary]);

  return (
    <div className="px-4 lg:px-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="text-base">Decision support</CardTitle>
            <CardDescription>
              Quick read on what changed and what to watch this period.
            </CardDescription>
          </div>
          {summary ? healthBadge(summary.insights.brand_health) : null}
        </CardHeader>
        <CardContent>
          {isLoading && !summary ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-md" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="py-4 text-sm text-muted-foreground">
              No data yet — insights will appear once there are orders.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {items.map((item, idx) => (
                <div
                  key={idx}
                  className={`flex items-start gap-3 rounded-md border p-3 ${toneClasses(item.tone)}`}
                >
                  <div className="mt-0.5 shrink-0">{item.icon}</div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-xs opacity-80">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export const BIInsightsPanel = memo(BIInsightsPanelImpl);
