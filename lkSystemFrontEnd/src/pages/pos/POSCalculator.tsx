import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { fmtTND } from './types';

const DENOMINATIONS = [0.5, 1, 5, 10, 20, 50] as const;
const roundTND = (value: number): number => Math.round(value * 1000) / 1000;

interface POSCalculatorProps {
  total: number;
  amountReceived: number;
  onAmountChange: (amount: number) => void;
  compact?: boolean;
}

export function POSCalculator({
  total,
  amountReceived,
  onAmountChange,
  compact = false,
}: POSCalculatorProps) {
  const normalizedTotal = roundTND(total);
  const normalizedAmountReceived = roundTND(amountReceived);
  const change = roundTND(normalizedAmountReceived - normalizedTotal);
  const isShort = change < -0.001;
  const isExact = Math.abs(change) < 0.001;
  const hasChange = change > 0.001;

  return (
    <div className={`${compact ? 'space-y-2 p-2.5' : 'space-y-2.5 p-3'} rounded-lg bg-muted/50 border`}>
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">Amount Received</Label>
        {amountReceived > 0 && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-5"
            onClick={() => onAmountChange(0)}
            aria-label="Clear amount"
          >
            <X className="size-3" />
          </Button>
        )}
      </div>

      <Input
        type="number"
        min={0}
        step="0.001"
        value={amountReceived || ''}
        onChange={e => onAmountChange(roundTND(Number(e.target.value) || 0))}
        placeholder="0.000"
        className={`${compact ? 'h-9 text-base' : 'h-10 text-lg'} font-semibold tabular-nums`}
      />

      {/* Quick denomination buttons */}
      <div className="flex flex-wrap gap-1.5">
        {DENOMINATIONS.map(d => (
          <Button
            key={d}
            variant="outline"
            size="sm"
            className={`${compact ? 'h-6 px-2' : 'h-7 px-2.5'} text-xs font-medium`}
            onClick={() => onAmountChange(roundTND(amountReceived + d))}
          >
            +{d}
          </Button>
        ))}
        <Button
          variant="secondary"
          size="sm"
          className={`${compact ? 'h-6 px-2' : 'h-7 px-2.5'} text-xs font-medium`}
          onClick={() => onAmountChange(normalizedTotal)}
        >
          Exact
        </Button>
      </div>

      <Separator />

      {/* Change Display */}
      <div
        className={`text-center ${compact ? 'py-1 text-xs' : 'py-1.5 text-sm'} rounded-md font-semibold ${
          amountReceived === 0
            ? 'text-muted-foreground bg-transparent'
            : isExact
              ? 'text-primary bg-primary/10'
              : isShort
                ? 'text-destructive bg-destructive/10'
                : 'text-green-600 bg-green-600/10'
        }`}
      >
        {amountReceived === 0
          ? 'Enter amount received'
          : isExact
            ? 'Exact amount'
            : isShort
              ? `Missing: ${fmtTND(Math.abs(change))} TND`
              : `Change (Be9i): ${fmtTND(change)} TND`}
      </div>

      {/* Quick total reference */}
      {hasChange && (
        <p className="text-[11px] text-center text-muted-foreground">
          {fmtTND(amountReceived)} − {fmtTND(total)} = {fmtTND(change)}
        </p>
      )}
    </div>
  );
}
