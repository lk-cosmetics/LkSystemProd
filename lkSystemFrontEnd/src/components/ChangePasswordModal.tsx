import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { userService } from '@/services/user.service';
import { AxiosError } from 'axios';

// API error response types
interface FieldErrors {
  old_password?: string[];
  new_password?: string[];
  new_password_confirm?: string[];
  detail?: string;
}

interface ParsedError {
  message: string;
  fieldErrors: FieldErrors;
}

// Extract field errors from API response
function extractFieldErrors(data: FieldErrors): FieldErrors {
  const fieldErrors: FieldErrors = {};
  if (data.old_password) fieldErrors.old_password = data.old_password;
  if (data.new_password) fieldErrors.new_password = data.new_password;
  if (data.new_password_confirm) fieldErrors.new_password_confirm = data.new_password_confirm;
  return fieldErrors;
}

// Helper to parse API errors
function parseApiError(error: unknown): ParsedError {
  const defaultError: ParsedError = { message: 'Failed to change password', fieldErrors: {} };
  
  if (!(error instanceof AxiosError) || !error.response?.data) {
    return error instanceof Error 
      ? { message: error.message, fieldErrors: {} }
      : defaultError;
  }

  const { status, data } = error.response;
  const apiData = data as FieldErrors;

  // Handle rate limiting (429)
  if (status === 429) {
    return {
      message: apiData.detail || 'Too many password change attempts. Please try again in 15 minutes.',
      fieldErrors: {},
    };
  }

  // Handle permission denied (403)
  if (status === 403) {
    return {
      message: apiData.detail || 'You do not have permission to change this user\'s password.',
      fieldErrors: {},
    };
  }

  // Handle validation errors (400)
  if (status === 400) {
    const fieldErrors = extractFieldErrors(apiData);
    const hasFieldErrors = Object.keys(fieldErrors).length > 0;
    const message = apiData.detail || (hasFieldErrors ? '' : 'Password change failed. Please check your input.');
    return { message, fieldErrors };
  }

  return defaultError;
}

// Admin Reset Password Schema (no old password required)
const adminResetSchema = z.object({
  new_password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/^(?!\d+$)/, 'Password cannot be entirely numeric'),
  new_password_confirm: z.string(),
}).refine((data) => data.new_password === data.new_password_confirm, {
  message: "Passwords don't match",
  path: ['new_password_confirm'],
});

type AdminResetData = z.infer<typeof adminResetSchema>;

interface ChangePasswordModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: number;
  userName: string;
  isAdminReset?: boolean; // If true, admin is resetting password (no old password needed)
  onSuccess?: () => void;
}

// Admin Reset Password Component (Superadmin/CEO/Manager)
function AdminResetForm({
  userId,
  onSuccess,
  onClose,
}: Readonly<{
  userId: number;
  onSuccess?: () => void;
  onClose: () => void;
}>) {
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<AdminResetData>({
    resolver: zodResolver(adminResetSchema),
  });

  const onSubmit = async (data: AdminResetData) => {
    setGeneralError(null);
    setFieldErrors({});
    
    try {
      console.log('Admin Reset Password Request:', { userId, data });
      await userService.adminResetPassword(userId, {
        new_password: data.new_password,
        new_password_confirm: data.new_password_confirm,
      });
      reset();
      onSuccess?.();
      onClose();
    } catch (err) {
      console.error('Admin Reset Password Error:', err);
      // Log the full response for debugging
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { status?: number; data?: unknown } };
        console.error('API Error Response:', JSON.stringify(axiosErr.response?.data, null, 2));
      }
      const { message, fieldErrors: apiFieldErrors } = parseApiError(err);
      setGeneralError(message);
      setFieldErrors(apiFieldErrors);
    }
  };

  // Combine client and server validation errors
  const newPasswordError = errors.new_password?.message || fieldErrors.new_password?.[0];
  const confirmPasswordError = errors.new_password_confirm?.message || fieldErrors.new_password_confirm?.[0];

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="grid gap-4 py-4">
        {generalError && (
          <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 dark:bg-red-900/20">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
            <p className="text-sm text-red-800 dark:text-red-200">{generalError}</p>
          </div>
        )}

        {/* New Password */}
        <div className="grid gap-2">
          <Label htmlFor="new_password">New Password</Label>
          <div className="relative">
            <Input
              id="new_password"
              type={showNewPassword ? 'text' : 'password'}
              {...register('new_password')}
              disabled={isSubmitting}
              className={newPasswordError ? 'border-red-500' : ''}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 h-full px-3"
              onClick={() => setShowNewPassword(!showNewPassword)}
            >
              {showNewPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
          </div>
          {newPasswordError && (
            <p className="text-sm text-red-500">{newPasswordError}</p>
          )}
          {/* Show all password validation errors from API */}
          {fieldErrors.new_password && fieldErrors.new_password.length > 1 && (
            <ul className="list-inside list-disc text-sm text-red-500">
              {fieldErrors.new_password.slice(1).map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Min 8 characters, not all numbers, include letters
          </p>
        </div>

        {/* Confirm Password */}
        <div className="grid gap-2">
          <Label htmlFor="new_password_confirm">Confirm Password</Label>
          <div className="relative">
            <Input
              id="new_password_confirm"
              type={showConfirmPassword ? 'text' : 'password'}
              {...register('new_password_confirm')}
              disabled={isSubmitting}
              className={confirmPasswordError ? 'border-red-500' : ''}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 h-full px-3"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            >
              {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
          </div>
          {confirmPasswordError && (
            <p className="text-sm text-red-500">{confirmPasswordError}</p>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : 'Reset Password'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// User Change Password Schema (old password required)
const userChangeSchema = z.object({
  old_password: z.string().min(1, 'Current password is required'),
  new_password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/^(?!\d+$)/, 'Password cannot be entirely numeric'),
  new_password_confirm: z.string(),
}).refine((data) => data.new_password === data.new_password_confirm, {
  message: "Passwords don't match",
  path: ['new_password_confirm'],
});

type UserChangeData = z.infer<typeof userChangeSchema>;

// User Change Password Component (requires old password)
function UserChangeForm({
  userId,
  onSuccess,
  onClose,
}: Readonly<{
  userId: number;
  onSuccess?: () => void;
  onClose: () => void;
}>) {
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<UserChangeData>({
    resolver: zodResolver(userChangeSchema),
  });

  const onSubmit = async (data: UserChangeData) => {
    setGeneralError(null);
    setFieldErrors({});
    
    try {
      await userService.changePassword(userId, {
        old_password: data.old_password,
        new_password: data.new_password,
        new_password_confirm: data.new_password_confirm,
      });
      reset();
      onSuccess?.();
      onClose();
    } catch (err) {
      const { message, fieldErrors: apiFieldErrors } = parseApiError(err);
      setGeneralError(message);
      setFieldErrors(apiFieldErrors);
    }
  };

  // Combine client and server validation errors
  const oldPasswordError = errors.old_password?.message || fieldErrors.old_password?.[0];
  const newPasswordError = errors.new_password?.message || fieldErrors.new_password?.[0];
  const confirmPasswordError = errors.new_password_confirm?.message || fieldErrors.new_password_confirm?.[0];

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="grid gap-4 py-4">
        {generalError && (
          <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 dark:bg-red-900/20">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
            <p className="text-sm text-red-800 dark:text-red-200">{generalError}</p>
          </div>
        )}

        {/* Old Password */}
        <div className="grid gap-2">
          <Label htmlFor="old_password">Current Password</Label>
          <div className="relative">
            <Input
              id="old_password"
              type={showOldPassword ? 'text' : 'password'}
              {...register('old_password')}
              disabled={isSubmitting}
              className={oldPasswordError ? 'border-red-500' : ''}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 h-full px-3"
              onClick={() => setShowOldPassword(!showOldPassword)}
            >
              {showOldPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
          </div>
          {oldPasswordError && (
            <p className="text-sm text-red-500">{oldPasswordError}</p>
          )}
        </div>

        {/* New Password */}
        <div className="grid gap-2">
          <Label htmlFor="new_password">New Password</Label>
          <div className="relative">
            <Input
              id="new_password"
              type={showNewPassword ? 'text' : 'password'}
              {...register('new_password')}
              disabled={isSubmitting}
              className={newPasswordError ? 'border-red-500' : ''}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 h-full px-3"
              onClick={() => setShowNewPassword(!showNewPassword)}
            >
              {showNewPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
          </div>
          {newPasswordError && (
            <p className="text-sm text-red-500">{newPasswordError}</p>
          )}
          {/* Show all password validation errors from API */}
          {fieldErrors.new_password && fieldErrors.new_password.length > 1 && (
            <ul className="list-inside list-disc text-sm text-red-500">
              {fieldErrors.new_password.slice(1).map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Min 8 characters, not all numbers, include letters
          </p>
        </div>

        {/* Confirm Password */}
        <div className="grid gap-2">
          <Label htmlFor="new_password_confirm">Confirm Password</Label>
          <div className="relative">
            <Input
              id="new_password_confirm"
              type={showConfirmPassword ? 'text' : 'password'}
              {...register('new_password_confirm')}
              disabled={isSubmitting}
              className={confirmPasswordError ? 'border-red-500' : ''}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 h-full px-3"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            >
              {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
          </div>
          {confirmPasswordError && (
            <p className="text-sm text-red-500">{confirmPasswordError}</p>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : 'Change Password'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ChangePasswordModal({
  open,
  onOpenChange,
  userId,
  userName,
  isAdminReset = false,
  onSuccess,
}: Readonly<ChangePasswordModalProps>) {
  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="size-5" />
            {isAdminReset ? 'Reset Password' : 'Change Password'}
          </DialogTitle>
          <DialogDescription>
            {isAdminReset
              ? `Set a new password for ${userName}`
              : 'Enter your current password and a new password'}
          </DialogDescription>
        </DialogHeader>

        {isAdminReset ? (
          <AdminResetForm userId={userId} onSuccess={onSuccess} onClose={handleClose} />
        ) : (
          <UserChangeForm userId={userId} onSuccess={onSuccess} onClose={handleClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}
