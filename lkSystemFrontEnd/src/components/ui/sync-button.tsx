/**
 * SyncButton Component
 *
 * A reusable button component for handling WooCommerce sync operations.
 * Supports three distinct states: Idle, Loading, and Feedback (Success/Error)
 */

import * as React from 'react';
import { Loader2, RefreshCw, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export type SyncState = 'idle' | 'loading' | 'success' | 'error';

export interface SyncButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'onError'
> {
  /** The current sync state */
  state?: SyncState;
  /** Label text for idle state */
  idleLabel?: string;
  /** Label text for loading state */
  loadingLabel?: string;
  /** Label text for success state */
  successLabel?: string;
  /** Label text for error state */
  errorLabel?: string;
  /** Custom icon for idle state */
  idleIcon?: React.ReactNode;
  /** Duration (ms) to show success/error state before returning to idle */
  feedbackDuration?: number;
  /** Callback when sync is triggered */
  onSync?: () => Promise<void>;
  /** Callback after successful sync */
  onSuccess?: () => void;
  /** Callback after failed sync */
  onError?: (error: Error) => void;
  /** Whether to show toast notifications */
  showToast?: boolean;
  /** Custom success toast message */
  successToastMessage?: string;
  /** Custom error toast message */
  errorToastMessage?: string;
  /** Button variant */
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  /** Button size */
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export function SyncButton({
  state: externalState,
  idleLabel = 'Sync with WooCommerce',
  loadingLabel = 'Syncing...',
  successLabel = 'Synced!',
  errorLabel = 'Sync Failed',
  idleIcon,
  feedbackDuration = 2000,
  onSync,
  onSuccess,
  onError,
  showToast = true,
  successToastMessage = 'Data synchronized successfully',
  errorToastMessage = 'Failed to synchronize data',
  variant = 'default',
  size = 'default',
  className,
  disabled,
  ...props
}: Readonly<SyncButtonProps>) {
  const [internalState, setInternalState] = React.useState<SyncState>('idle');

  // Use external state if provided, otherwise use internal state
  const state = externalState ?? internalState;
  const isControlled = externalState !== undefined;

  const handleClick = React.useCallback(async () => {
    if (state === 'loading' || !onSync) return;

    if (!isControlled) {
      setInternalState('loading');
    }

    try {
      await onSync();

      if (!isControlled) {
        setInternalState('success');
      }

      if (showToast) {
        toast.success(successToastMessage);
      }

      onSuccess?.();

      // Reset to idle after feedback duration
      if (!isControlled) {
        setTimeout(() => {
          setInternalState('idle');
        }, feedbackDuration);
      }
    } catch (error) {
      if (!isControlled) {
        setInternalState('error');
      }

      if (showToast) {
        toast.error(errorToastMessage);
      }

      onError?.(error instanceof Error ? error : new Error('Sync failed'));

      // Reset to idle after feedback duration
      if (!isControlled) {
        setTimeout(() => {
          setInternalState('idle');
        }, feedbackDuration);
      }
    }
  }, [
    state,
    isControlled,
    onSync,
    onSuccess,
    onError,
    showToast,
    successToastMessage,
    errorToastMessage,
    feedbackDuration,
  ]);

  const getIcon = () => {
    switch (state) {
      case 'loading':
        return <Loader2 className="size-4 animate-spin" />;
      case 'success':
        return <Check className="size-4" />;
      case 'error':
        return <X className="size-4" />;
      default:
        return idleIcon ?? <RefreshCw className="size-4" />;
    }
  };

  const getLabel = () => {
    switch (state) {
      case 'loading':
        return loadingLabel;
      case 'success':
        return successLabel;
      case 'error':
        return errorLabel;
      default:
        return idleLabel;
    }
  };

  const getVariant = () => {
    switch (state) {
      case 'success':
        return 'default' as const;
      case 'error':
        return 'destructive' as const;
      default:
        return variant;
    }
  };

  return (
    <Button
      variant={getVariant()}
      size={size}
      onClick={handleClick}
      disabled={disabled || state === 'loading'}
      className={cn(
        'gap-2 transition-all duration-200',
        state === 'success' && 'bg-green-600 hover:bg-green-700 text-white',
        className
      )}
      {...props}
    >
      {getIcon()}
      {size !== 'icon' && <span>{getLabel()}</span>}
    </Button>
  );
}

export default SyncButton;
