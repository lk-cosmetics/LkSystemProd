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
import { Badge } from '@/components/ui/badge';
import { useState, useEffect, FormEvent } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { apiClient } from '@/services/axios';
import { Building2, Shield } from 'lucide-react';

export default function AcceptInvitationPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';
  const emailFromUrl = searchParams.get('email') || '';

  // Validation state
  const [isValidating, setIsValidating] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [roleName, setRoleName] = useState('');
  const [companyName, setCompanyName] = useState('');

  // Form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [matricule, setMatricule] = useState('');

  // Validate token on mount
  useEffect(() => {
    const validateToken = async () => {
      if (!token || !emailFromUrl) {
        setError('Invalid invitation link. Please contact your administrator.');
        setIsValidating(false);
        return;
      }

      try {
        const response = await apiClient.post('/api/v1/auth/validate-invitation/', {
          token,
          email: emailFromUrl,
        });
        setTokenValid(response.data.valid);
        setRoleName(response.data.role_name || '');
        setCompanyName(response.data.company_name || '');
      } catch {
        setTokenValid(false);
        setError('This invitation link is invalid or has expired.');
      } finally {
        setIsValidating(false);
      }
    };

    validateToken();
  }, [token, emailFromUrl]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!firstName.trim() || !lastName.trim()) {
      setError('First name and last name are required.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (/^\d+$/.test(password)) {
      setError('Password cannot be entirely numeric.');
      return;
    }

    setIsLoading(true);

    try {
      const response = await apiClient.post('/api/v1/auth/accept-invitation/', {
        token,
        email: emailFromUrl,
        first_name: firstName,
        last_name: lastName,
        password,
        password_confirm: confirmPassword,
      });
      setMatricule(response.data.matricule || '');
      setSuccess(true);
    } catch (err: any) {
      const data = err?.response?.data;
      if (data && typeof data === 'object') {
        const messages = Object.entries(data)
          .map(([key, val]) => {
            const msg = Array.isArray(val) ? val.join(', ') : String(val);
            return key === 'non_field_errors' ? msg : `${key}: ${msg}`;
          })
          .join('\n');
        setError(messages || 'Failed to create account.');
      } else {
        setError('Failed to create account. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state
  if (isValidating) {
    return (
      <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-md">
          <Card>
            <CardHeader>
              <CardTitle>Validating invitation...</CardTitle>
              <CardDescription>
                Please wait while we verify your invitation link
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

  // Invalid token
  if (!tokenValid) {
    return (
      <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-md">
          <Card>
            <CardHeader>
              <CardTitle>Invalid invitation</CardTitle>
              <CardDescription>
                {error || 'This invitation link is invalid or has expired.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  Invitation links expire after 72 hours. Please contact your
                  administrator to receive a new invitation.
                </p>
                <Link to="/login">
                  <Button variant="ghost" className="w-full">
                    Go to login
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Success
  if (success) {
    return (
      <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-md">
          <Card>
            <CardHeader>
              <CardTitle>Account created!</CardTitle>
              <CardDescription>
                Your account has been set up successfully
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                <div className="rounded-md bg-green-50 dark:bg-green-900/20 p-4 space-y-2">
                  <p className="text-sm text-green-800 dark:text-green-200">
                    Welcome to <strong>{companyName}</strong>!
                  </p>
                  {matricule && (
                    <p className="text-sm text-green-800 dark:text-green-200">
                      Your matricule: <code className="font-mono font-bold">{matricule}</code>
                    </p>
                  )}
                  <p className="text-sm text-green-800 dark:text-green-200">
                    You can now log in with your email and password.
                  </p>
                </div>
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

  // Registration form
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-md">
        <div className={cn('flex flex-col gap-6')}>
          <Card>
            <CardHeader>
              <CardTitle>Complete your registration</CardTitle>
              <CardDescription>
                You've been invited to join <strong>{companyName}</strong>
              </CardDescription>
              <div className="flex gap-2 pt-2">
                <Badge variant="secondary" className="gap-1">
                  <Building2 className="size-3" />
                  {companyName}
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <Shield className="size-3" />
                  {roleName}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit}>
                <FieldGroup>
                  {error && (
                    <div className="rounded-md bg-red-50 p-4 dark:bg-red-900/20">
                      <p className="text-sm text-red-800 dark:text-red-200 whitespace-pre-line">
                        {error}
                      </p>
                    </div>
                  )}

                  <div className="rounded-md bg-muted/50 p-3">
                    <p className="text-sm text-muted-foreground">
                      Email: <strong>{emailFromUrl}</strong>
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <Field>
                      <FieldLabel htmlFor="firstName">First name</FieldLabel>
                      <Input
                        id="firstName"
                        placeholder="John"
                        required
                        value={firstName}
                        onChange={e => setFirstName(e.target.value)}
                        disabled={isLoading}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="lastName">Last name</FieldLabel>
                      <Input
                        id="lastName"
                        placeholder="Doe"
                        required
                        value={lastName}
                        onChange={e => setLastName(e.target.value)}
                        disabled={isLoading}
                      />
                    </Field>
                  </div>

                  <Field>
                    <FieldLabel htmlFor="password">Password</FieldLabel>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Create a password"
                      required
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      disabled={isLoading}
                      minLength={8}
                    />
                    <FieldDescription>
                      Min 8 characters, not all numbers
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="confirmPassword">
                      Confirm password
                    </FieldLabel>
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder="Confirm your password"
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
                      {isLoading ? 'Creating account...' : 'Create account'}
                    </Button>
                    <div className="text-center mt-4">
                      <Link
                        to="/login"
                        className="text-sm underline-offset-4 hover:underline"
                      >
                        Already have an account? Log in
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
