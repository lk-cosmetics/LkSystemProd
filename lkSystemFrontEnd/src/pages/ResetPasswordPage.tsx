import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useState, useEffect, FormEvent } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { authService } from '@/services/auth.service';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';
  const emailFromUrl = searchParams.get('email') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tokenValid, setTokenValid] = useState(false);
  const [success, setSuccess] = useState(false);
  const [userEmail, setUserEmail] = useState<string>(emailFromUrl);

  // Validate token on mount
  useEffect(() => {
    const validateToken = async () => {
      if (!token || !emailFromUrl) {
        setError(
          'Invalid reset link. Please request a new password reset link.'
        );
        setIsValidating(false);
        return;
      }

      try {
        const result = await authService.validateResetToken({
          token,
          email: emailFromUrl,
        });
        setTokenValid(result.valid);
        if (result.email) setUserEmail(result.email);
        if (!result.valid) {
          setError(
            result.message ||
              'Invalid or expired reset token. Please request a new password reset link.'
          );
        }
      } catch (err) {
        const error = err as Error;
        setError(error.message || 'Failed to validate token.');
        setTokenValid(false);
      } finally {
        setIsValidating(false);
      }
    };

    validateToken();
  }, [token, emailFromUrl]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    // Validate passwords match
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    // Validate password strength
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    // Check if password is not entirely numeric
    if (/^\d+$/.test(password)) {
      setError('Password cannot be entirely numeric.');
      return;
    }

    // Check for common passwords
    const commonPasswords = [
      'password',
      'password123',
      '12345678',
      'qwerty123',
      'admin123',
    ];
    if (commonPasswords.includes(password.toLowerCase())) {
      setError(
        'This password is too common. Please choose a stronger password.'
      );
      return;
    }

    setIsLoading(true);

    try {
      await authService.resetPassword({
        token,
        email: userEmail,
        new_password: password,
        new_password_confirm: confirmPassword,
      });
      setSuccess(true);
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to reset password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state while validating token
  if (isValidating) {
    return (
      <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm">
          <Card>
            <CardHeader>
              <CardTitle>Validating reset link...</CardTitle>
              <CardDescription>
                Please wait while we verify your password reset link
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex justify-center py-8">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Invalid token state
  if (!tokenValid) {
    return (
      <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm">
          <Card>
            <CardHeader>
              <CardTitle>Invalid reset link</CardTitle>
              <CardDescription>
                {error || 'This password reset link is invalid or has expired.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  Password reset links expire after 1 hour for security reasons.
                </p>
                <div className="flex flex-col gap-2">
                  <Link to="/forgot-password">
                    <Button className="w-full">Request new reset link</Button>
                  </Link>
                  <Link to="/login">
                    <Button variant="ghost" className="w-full">
                      Back to login
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Success state
  if (success) {
    return (
      <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm">
          <Card>
            <CardHeader>
              <CardTitle>Password reset successful!</CardTitle>
              <CardDescription>
                Your password has been changed successfully
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  You can now log in with your new password.
                </p>
                <Button onClick={() => navigate('/login')} className="w-full">
                  Go to login
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Reset password form
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className={cn('flex flex-col gap-6')}>
          <Card>
            <CardHeader>
              <CardTitle>Reset your password</CardTitle>
              <CardDescription>
                {userEmail ? (
                  <>
                    Enter a new password for <strong>{userEmail}</strong>
                  </>
                ) : (
                  'Enter your new password below'
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit}>
                <FieldGroup>
                  {error && (
                    <div className="rounded-md bg-red-50 p-4 dark:bg-red-900/20">
                      <p className="text-sm text-red-800 dark:text-red-200">
                        {error}
                      </p>
                    </div>
                  )}

                  <Field>
                    <FieldLabel htmlFor="password">New password</FieldLabel>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter your new password"
                      required
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      disabled={isLoading}
                      minLength={8}
                    />
                    <FieldDescription>
                      Min 8 characters, not all numbers, include letters
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="confirmPassword">
                      Confirm password
                    </FieldLabel>
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder="Confirm your new password"
                      required
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      disabled={isLoading}
                      minLength={8}
                    />
                  </Field>

                  <Field>
                    <Button
                      type="submit"
                      disabled={isLoading}
                      className="w-full"
                    >
                      {isLoading ? 'Resetting password...' : 'Reset password'}
                    </Button>
                    <div className="text-center mt-4">
                      <Link
                        to="/login"
                        className="text-sm underline-offset-4 hover:underline"
                      >
                        Back to login
                      </Link>
                    </div>
                  </Field>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
