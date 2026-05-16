import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';

import type {
  BISalesChannelChart,
  BISalesChannelRevenue,
  BISalesChart,
} from '@/services/bi.service';

import { fmtMoney, fmtMoneyCompact, fmtNumber, fmtShortDate } from './utils';

/**
 * shadcn/ui charts — driven by ChartConfig.
 *
 * Pattern:
 *   1. Declare ChartConfig — keys map to dataKeys in Recharts.
 *   2. ChartContainer auto-injects `--color-<key>` CSS vars from the config.
 *   3. Recharts series reference those vars via `fill="var(--color-<key>)"`.
 *
 * The per-channel charts build their config dynamically from the channel
 * list returned by the API, cycling through --chart-1..5.
 */

const revenueConfig = {
  revenue: { label: 'Revenue', color: 'var(--chart-1)' },
} satisfies ChartConfig;

const ordersConfig = {
  orders: { label: 'Orders', color: 'var(--chart-2)' },
} satisfies ChartConfig;

const PALETTE = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

function paletteColor(idx: number) {
  return PALETTE[idx % PALETTE.length];
}

interface ChartSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

function ChartSection({ title, description, children }: ChartSectionProps) {
  return (
    <Card className="@container/card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="px-2 pt-2 sm:px-4">{children}</CardContent>
    </Card>
  );
}

function ChartSkeleton({ title }: { title: string }) {
  return (
    <ChartSection title={title}>
      <Skeleton className="h-[280px] w-full" />
    </ChartSection>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-[280px] w-full items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
      No data for the selected period.
    </div>
  );
}

interface Props {
  chart: BISalesChart | undefined;
  channelChart: BISalesChannelChart | undefined;
  channelRevenue: BISalesChannelRevenue | undefined;
  isLoading: boolean;
}

export function BICharts({ chart, channelChart, channelRevenue, isLoading }: Props) {
  const series = useMemo(
    () =>
      (chart?.series ?? []).map(p => ({
        date: p.date,
        dateLabel: fmtShortDate(p.date),
        revenue: Number(p.revenue),
        orders: p.orders_count,
      })),
    [chart],
  );

  // Per-channel chart config (one entry per channel, cycling colors).
  const channelConfig = useMemo<ChartConfig>(() => {
    const cfg: ChartConfig = {};
    (channelChart?.channels ?? []).forEach((ch, i) => {
      cfg[ch.key] = { label: ch.name, color: paletteColor(i) };
    });
    return cfg;
  }, [channelChart]);

  const channelSeries = useMemo(() => {
    return (channelChart?.series ?? []).map(row => ({
      ...row,
      dateLabel: fmtShortDate(String(row.date)),
    }));
  }, [channelChart]);

  // Donut data: derived from the per-channel revenue endpoint (already
  // sorted by revenue desc on the backend).
  const donutData = useMemo(() => {
    return (channelRevenue?.results ?? []).map((row, i) => ({
      key: `ch_${row.sales_channel_id}`,
      name: row.name,
      value: Number(row.revenue),
      fill: paletteColor(i),
    }));
  }, [channelRevenue]);

  const donutConfig = useMemo<ChartConfig>(() => {
    const cfg: ChartConfig = {};
    donutData.forEach(slice => {
      cfg[slice.key] = { label: slice.name, color: slice.fill };
    });
    return cfg;
  }, [donutData]);

  const totalRevenueNumber = useMemo(
    () => donutData.reduce((acc, s) => acc + s.value, 0),
    [donutData],
  );

  const noDailyData =
    !isLoading && series.length > 0 && series.every(p => p.revenue === 0 && p.orders === 0);
  const noChannelChannelData =
    !isLoading &&
    (channelChart?.channels?.length ?? 0) === 0;
  const noChannelDonutData =
    !isLoading && donutData.every(s => s.value === 0);

  if (!chart && isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 px-4 lg:px-6">
        <ChartSkeleton title="Revenue trend" />
        <ChartSkeleton title="Orders trend" />
        <ChartSkeleton title="Revenue by sales channel" />
        <ChartSkeleton title="Sales channel comparison" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 px-4 lg:px-6">
      {/* ── Revenue trend ── */}
      <ChartSection title="Revenue trend" description="Daily revenue over the period">
        {noDailyData ? (
          <EmptyChart />
        ) : (
          <ChartContainer config={revenueConfig} className="aspect-auto h-[280px] w-full">
            <AreaChart data={series} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="biRevenueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-revenue)" stopOpacity={0.55} />
                  <stop offset="95%" stopColor="var(--color-revenue)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="dateLabel" tickLine={false} axisLine={false}
                     tickMargin={8} minTickGap={32} />
              <YAxis tickLine={false} axisLine={false} width={56}
                     tickFormatter={v => fmtMoneyCompact(v as number)} />
              <ChartTooltip
                cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
                content={
                  <ChartTooltipContent
                    indicator="line"
                    labelFormatter={(_, payload) => {
                      const iso = (payload?.[0]?.payload as { date?: string } | undefined)?.date;
                      return iso ? fmtShortDate(iso) : '';
                    }}
                    formatter={value => (
                      <span className="tabular-nums">{fmtMoney(value as number)}</span>
                    )}
                  />
                }
              />
              <Area
                type="natural"
                dataKey="revenue"
                stroke="var(--color-revenue)"
                fill="url(#biRevenueGrad)"
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </ChartSection>

      {/* ── Orders trend ── */}
      <ChartSection title="Orders trend" description="Number of orders per day">
        {noDailyData ? (
          <EmptyChart />
        ) : (
          <ChartContainer config={ordersConfig} className="aspect-auto h-[280px] w-full">
            <BarChart data={series} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="dateLabel" tickLine={false} axisLine={false}
                     tickMargin={8} minTickGap={32} />
              <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
              <ChartTooltip
                cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    labelFormatter={(_, payload) => {
                      const iso = (payload?.[0]?.payload as { date?: string } | undefined)?.date;
                      return iso ? fmtShortDate(iso) : '';
                    }}
                    formatter={value => (
                      <span className="tabular-nums">{fmtNumber(value as number)} orders</span>
                    )}
                  />
                }
              />
              <Bar dataKey="orders" fill="var(--color-orders)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </ChartSection>

      {/* ── Revenue by sales channel (per-channel stacked area) ── */}
      <ChartSection
        title="Revenue by sales channel"
        description="Daily revenue split across every individual sales channel"
      >
        {noChannelChannelData ? (
          <EmptyChart />
        ) : (
          <ChartContainer config={channelConfig} className="aspect-auto h-[300px] w-full">
            <AreaChart data={channelSeries} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
              <defs>
                {(channelChart?.channels ?? []).map(ch => (
                  <linearGradient key={ch.key} id={`grad-${ch.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={`var(--color-${ch.key})`} stopOpacity={0.55} />
                    <stop offset="95%" stopColor={`var(--color-${ch.key})`} stopOpacity={0.05} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="dateLabel" tickLine={false} axisLine={false}
                     tickMargin={8} minTickGap={32} />
              <YAxis tickLine={false} axisLine={false} width={56}
                     tickFormatter={v => fmtMoneyCompact(v as number)} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    indicator="line"
                    labelFormatter={(_, payload) => {
                      const iso = (payload?.[0]?.payload as { date?: string } | undefined)?.date;
                      return iso ? fmtShortDate(iso) : '';
                    }}
                    formatter={value => (
                      <span className="tabular-nums">{fmtMoney(value as number)}</span>
                    )}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              {(channelChart?.channels ?? []).map(ch => (
                <Area
                  key={ch.key}
                  type="natural"
                  stackId="rev"
                  dataKey={ch.key}
                  stroke={`var(--color-${ch.key})`}
                  fill={`url(#grad-${ch.key})`}
                  strokeWidth={2}
                />
              ))}
            </AreaChart>
          </ChartContainer>
        )}
      </ChartSection>

      {/* ── Channel donut ── */}
      <ChartSection
        title="Sales channel comparison"
        description="Share of total revenue across every individual sales channel"
      >
        {noChannelDonutData ? (
          <EmptyChart />
        ) : (
          <ChartContainer
            config={donutConfig}
            className="mx-auto aspect-square h-[300px] w-full max-w-[360px]"
          >
            <PieChart>
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    hideLabel
                    formatter={(value, _name, item) => (
                      <span className="tabular-nums">
                        {item?.payload?.name}: {fmtMoney(value as number)}
                      </span>
                    )}
                  />
                }
              />
              <Pie
                data={donutData}
                dataKey="value"
                nameKey="key"
                innerRadius={72}
                outerRadius={112}
                paddingAngle={2}
                strokeWidth={2}
              >
                {donutData.map(entry => (
                  <Cell key={entry.key} fill={entry.fill} />
                ))}
                <Label
                  content={({ viewBox }) => {
                    if (!viewBox || !('cx' in viewBox)) return null;
                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy as number) - 6}
                          className="fill-foreground text-lg font-semibold"
                        >
                          {fmtMoneyCompact(totalRevenueNumber)}
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy as number) + 14}
                          className="fill-muted-foreground text-[11px]"
                        >
                          Total
                        </tspan>
                      </text>
                    );
                  }}
                />
              </Pie>
              <ChartLegend content={<ChartLegendContent nameKey="key" />} />
            </PieChart>
          </ChartContainer>
        )}
      </ChartSection>
    </div>
  );
}
