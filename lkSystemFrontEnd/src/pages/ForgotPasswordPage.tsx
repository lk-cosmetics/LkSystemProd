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
import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { authService } from '@/services/auth.service';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      await authService.forgotPassword({ email });
      setSuccess(true);
    } catch (err) {
      const error = err as Error;
      setError(
        error.message || 'Failed to send reset email. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm">
          <Card>
            <CardHeader>
              <CardTitle>Check your email</CardTitle>
              <CardDescription>
                We've sent a password reset link to <strong>{email}</strong>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  Didn't receive the email? Check your spam folder or try again
                  with a different email address.
                </p>
                <p className="text-sm text-muted-foreground">
                  The reset link will expire in 1 hour.
                </p>
                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSuccess(false);
                      setEmail('');
                    }}
                  >
                    Try another email
                  </Button>
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

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className={cn('flex flex-col gap-6')}>
          <Card>
            <CardHeader>
              <CardTitle>Forgot your password?</CardTitle>
              <CardDescription>
                Enter your email address and we'll send you a link to reset your
                password
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
                    <FieldLabel htmlFor="email">Email address</FieldLabel>
                    <Input
                      id="email"
                      type="email"
                      placeholder="Enter your email"
                      required
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      disabled={isLoading}
                    />
                    <FieldDescription>
                      Enter the email associated with your account
                    </FieldDescription>
                  </Field>

                  <Field>
                    <Button
                      type="submit"
                      disabled={isLoading}
                      className="w-full"
                    >
                      {isLoading ? 'Sending...' : 'Send reset link'}
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
