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
import { useAuthStore } from '@/store/authStore';
import { useNavigate, Link } from 'react-router-dom';

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  const [matricule, setMatricule] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading, error, clearError } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    clearError();

    try {
      // Trim + upper-case the matricule client-side so a copy-pasted value
      // with surrounding whitespace still resolves the user. The backend
      // does the same normalisation in ``LkSystemTokenObtainPairSerializer``,
      // but doing it here too gives the user instant feedback in the input.
      const cleanMatricule = matricule.trim().toUpperCase();
      if (cleanMatricule !== matricule) {
        setMatricule(cleanMatricule);
      }
      await login({ matricule: cleanMatricule, password });
      navigate('/dashboard');
    } catch (err) {
      // Error is already set in the store
      console.error('Login failed:', err);
    }
  };

  return (
    <div className={cn('login-form flex flex-col gap-6', className)} {...props}>
      <Card className="login-card">
        <CardHeader className="login-card-header">
          <CardTitle className="login-card-title">Login to your account</CardTitle>
          <CardDescription className="login-card-description">
            Enter your matricule and password to access your account
          </CardDescription>
        </CardHeader>
        <CardContent className="login-card-content">
          <form onSubmit={handleSubmit} className="login-form-inner">
            <FieldGroup className="login-field-group">
              {error && (
                <div className="login-error rounded-md bg-red-50 p-4 dark:bg-red-900/20">
                  <p className="login-error-text text-sm text-red-800 dark:text-red-200">
                    {error}
                  </p>
                </div>
              )}

              <Field className="login-field">
                <FieldLabel htmlFor="matricule">Matricule</FieldLabel>
                <Input
                  className="login-input"
                  id="matricule"
                  type="text"
                  placeholder="Enter your matricule"
                  required
                  value={matricule}
                  onChange={e => setMatricule(e.target.value)}
                  disabled={isLoading}
                />
              </Field>

              <Field className="login-field">
                <div className="login-password-label-row flex items-center">
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <Link
                    to="/forgot-password"
                    className="login-forgot-link ml-auto inline-block text-sm underline-offset-4 hover:underline"
                  >
                    Forgot your password?
                  </Link>
                </div>
                <Input
                  className="login-input"
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={isLoading}
                />
              </Field>

              <Field className="login-actions">
                <Button className="login-submit" type="submit" disabled={isLoading}>
                  {isLoading ? 'Logging in...' : 'Login'}
                </Button>
                <FieldDescription className="login-help-text text-center">
                  Don&apos;t have an account? Contact your administrator
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
