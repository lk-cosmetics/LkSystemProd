/**
 * Logout Button Component
 * Can be used in navigation or user menus
 */

import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { Button } from '@/components/ui/button';

interface LogoutButtonProps {
  readonly className?: string;
  readonly variant?: 'default' | 'outline' | 'ghost' | 'link' | 'destructive';
}

export function LogoutButton({
  className,
  variant = 'ghost',
}: Readonly<LogoutButtonProps>) {
  const logout = useAuthStore(state => state.logout);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <Button onClick={handleLogout} variant={variant} className={className}>
      Logout
    </Button>
  );
}

export default LogoutButton;
