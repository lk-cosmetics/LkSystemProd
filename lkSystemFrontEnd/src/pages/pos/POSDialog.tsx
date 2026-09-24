import type {
  ButtonHTMLAttributes,
  ComponentProps,
  HTMLAttributes,
  ReactNode,
} from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type DialogSize = 'compact' | 'default' | 'payment';

const SIZE_CLASSES: Record<DialogSize, string> = {
  compact: 'sm:max-w-[620px]',
  default: 'sm:max-w-[820px]',
  payment: 'sm:max-w-[920px]',
};

export function POSDialogContent({
  size = 'default',
  className,
  children,
  ...props
}: ComponentProps<typeof DialogContent> & { size?: DialogSize }) {
  return (
    <DialogContent
      className={cn(
        'flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-md p-0 shadow-xl sm:max-h-[calc(100dvh-3rem)]',
        SIZE_CLASSES[size],
        className
      )}
      {...props}
    >
      {children}
    </DialogContent>
  );
}

export function POSDialogHeader({
  title,
  description,
  aside,
}: {
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <DialogHeader className="shrink-0 border-b px-5 py-4 text-left sm:px-6 sm:py-4">
      <div className="flex items-start justify-between gap-5 pr-7">
        <div className="min-w-0">
          <DialogTitle className="text-xl font-semibold leading-tight sm:text-[1.375rem]">
            {title}
          </DialogTitle>
          {description ? (
            <DialogDescription className="mt-1 text-sm leading-5">
              {description}
            </DialogDescription>
          ) : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </div>
    </DialogHeader>
  );
}

export function POSDialogBody({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5',
        className
      )}
      {...props}
    />
  );
}

export function POSDialogFooter({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-col-reverse gap-3 border-t bg-background px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6',
        className
      )}
      {...props}
    />
  );
}

export function POSPrimaryButton({
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      className={cn('h-11 min-w-48 px-6 text-sm font-semibold', className)}
      {...props}
    />
  );
}

export function POSSecondaryButton({
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      variant="outline"
      className={cn('h-11 px-5 text-sm font-medium', className)}
      {...props}
    />
  );
}

export function POSStepIndicator({
  current,
  steps,
}: {
  current: number;
  steps: string[];
}) {
  return (
    <ol className="flex items-center" aria-label="Étapes de l'encaissement">
      {steps.map((label, index) => {
        const number = index + 1;
        const active = number === current;
        const complete = number < current;
        return (
          <li key={label} className="flex items-center">
            {index > 0 ? (
              <span
                className="mx-2 h-px w-5 bg-border sm:w-8"
                aria-hidden="true"
              />
            ) : null}
            <div
              className={cn(
                'flex items-center gap-2',
                !active && !complete && 'text-muted-foreground'
              )}
            >
              <span
                className={cn(
                  'flex size-7 items-center justify-center rounded-full border text-xs font-semibold',
                  active && 'border-foreground bg-foreground text-background',
                  complete &&
                    'border-emerald-600 bg-emerald-50 text-emerald-700'
                )}
                aria-current={active ? 'step' : undefined}
              >
                {complete ? <Check className="size-3.5" /> : number}
              </span>
              <span className="hidden text-sm font-medium sm:inline">
                {label}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function POSActionCard({
  icon,
  title,
  description,
  selected = false,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  selected?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex min-h-20 w-full items-center gap-3 rounded-md border bg-background p-3 text-left outline-none transition-colors',
        'hover:border-foreground/40 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        selected && 'border-foreground bg-muted/50 ring-1 ring-foreground',
        className
      )}
      aria-pressed={selected}
      {...props}
    >
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted/40',
          selected && 'border-foreground bg-foreground text-background'
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-5">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      {selected ? (
        <Check className="size-5 shrink-0" aria-hidden="true" />
      ) : null}
    </button>
  );
}
