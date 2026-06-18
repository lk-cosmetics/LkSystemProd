import { LoginForm } from '@/components/login-form';

export default function Page() {
  return (
    <div className="login-page flex min-h-screen min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="login-panel w-full max-w-sm">
        <LoginForm />
      </div>
    </div>
  );
}
