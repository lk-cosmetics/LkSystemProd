# Authentication System Documentation

## Overview

A robust, production-ready authentication system for React + TypeScript applications with the following features:

- 🔐 JWT-based authentication with access and refresh tokens
- 🛡️ Protected routes with automatic redirect
- 🔄 Automatic token refresh on 401 errors
- 💾 Persistent auth state with Zustand
- 🎯 Clean separation of concerns (services, store, components)
- 🚀 TypeScript support with full type safety

## Architecture

### Key Components

1. **Auth Service** (`src/services/auth.service.ts`)
   - Handles all authentication API calls
   - Manages token storage
   - Provides user authentication status

2. **Axios Instance** (`src/services/axios.ts`)
   - Configures base API client
   - Automatically attaches Bearer tokens
   - Intercepts 401 errors and refreshes tokens
   - Redirects to login on refresh failure

3. **Auth Store** (`src/store/authStore.ts`)
   - Zustand-based global state management
   - Persists user data (not tokens)
   - Provides login, logout, and token refresh actions

4. **Protected Route** (`src/components/ProtectedRoute.tsx`)
   - Guards dashboard and protected routes
   - Redirects unauthenticated users to login

## Usage Examples

### 1. Using the Login Form

The login form is already integrated. Users enter their matricule and password:

```tsx
// Already implemented in src/components/login-form.tsx
// Handles loading states, error messages, and redirects
```

### 2. Protecting Routes

Wrap routes that require authentication:

```tsx
import ProtectedRoute from '@/components/ProtectedRoute';

<Route element={<ProtectedRoute />}>
  <Route path="/dashboard" element={<Dashboard />} />
  <Route path="/profile" element={<Profile />} />
</Route>;
```

### 3. Accessing Auth State

Use the Zustand store hook:

```tsx
import { useAuthStore } from '@/store/authStore';

function MyComponent() {
  const { user, isAuthenticated, logout } = useAuthStore();

  return (
    <div>
      {isAuthenticated && <p>Welcome, {user?.firstName}!</p>}
      <button onClick={logout}>Logout</button>
    </div>
  );
}
```

### 4. Making Authenticated API Calls

Use the configured axios instance:

```tsx
import { apiClient } from '@/services/axios';

// Token is automatically attached
async function fetchUserData() {
  const response = await apiClient.get('/api/v1/users/me');
  return response.data;
}

// POST request example
async function updateProfile(data: ProfileData) {
  const response = await apiClient.post('/api/v1/users/profile', data);
  return response.data;
}
```

### 5. Using the Logout Button

```tsx
import LogoutButton from '@/components/LogoutButton';

function Header() {
  return (
    <nav>
      <LogoutButton variant="ghost" />
    </nav>
  );
}
```

### 6. Checking User Permissions

```tsx
import { useAuthStore } from '@/store/authStore';

function AdminPanel() {
  const user = useAuthStore(state => state.user);

  const hasPermission = (permission: string) =>
    user?.permissions.includes(permission);

  const isAdmin = user?.roles.includes('admin');

  if (!isAdmin) {
    return <p>Access denied</p>;
  }

  return <div>Admin Content</div>;
}
```

## API Response Structure

The backend should return this structure on login:

```json
{
  "access": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "123",
    "matricule": "EMP001",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "roles": ["user", "admin"],
    "permissions": ["read:users", "write:users"]
  }
}
```

## Token Refresh Flow

1. User makes an API request
2. Request includes `Authorization: Bearer <access_token>`
3. If token is expired, backend returns 401
4. Axios interceptor catches 401
5. Interceptor calls refresh endpoint with refresh token
6. New access token is stored
7. Original request is retried with new token
8. If refresh fails, user is logged out and redirected to login

## Security Considerations

✅ **What's Implemented:**

- Access tokens stored in memory (localStorage as fallback)
- Refresh tokens stored in localStorage
- Automatic token refresh on expiry
- Secure axios configuration
- HTTPS recommended for production

⚠️ **Production Recommendations:**

- Use HttpOnly cookies for refresh tokens (backend implementation)
- Implement CSRF protection
- Add rate limiting on login endpoint
- Use secure HTTPS connections
- Consider implementing 2FA

## Environment Variables

Add to your `.env` file:

```env
VITE_API_BASE_URL=http://localhost:8000
```

## Testing the Authentication

1. Start your backend server on `http://localhost:8000`
2. Start the React app: `npm run dev`
3. Navigate to `http://localhost:3000/login`
4. Enter valid credentials (matricule and password)
5. On success, you'll be redirected to `/dashboard`
6. Try accessing `/dashboard` directly - you'll be redirected to login if not authenticated

## Error Handling

The system handles these error scenarios:

- ❌ **Invalid credentials**: Shows error message on login form
- ❌ **Network errors**: Shows generic error message
- ❌ **Token expired**: Automatically refreshes token
- ❌ **Refresh token expired**: Logs out user and redirects to login
- ❌ **401 Unauthorized**: Triggers token refresh flow

## Troubleshooting

### Login not working

- Check backend is running on `http://localhost:8000`
- Verify API endpoint is `/api/v1/auth/login/`
- Check browser console for errors
- Verify credentials are correct

### Token not attached to requests

- Check localStorage for `access_token`
- Verify axios interceptor is configured
- Check browser network tab for Authorization header

### Infinite redirect loop

- Clear localStorage: `localStorage.clear()`
- Check if refresh token is valid
- Verify ProtectedRoute logic

## File Structure

```
src/
├── services/
│   ├── axios.ts              # Axios instance with interceptors
│   ├── auth.service.ts       # Authentication API calls
│   └── index.ts              # Service exports
├── store/
│   └── authStore.ts          # Zustand auth state management
├── components/
│   ├── ProtectedRoute.tsx    # Route guard component
│   ├── LogoutButton.tsx      # Logout button component
│   └── login-form.tsx        # Login form with auth integration
├── types/
│   └── index.ts              # Auth TypeScript types
└── utils/
    └── constants.ts          # API and auth constants
```

## Next Steps

Consider implementing:

- [ ] Remember me functionality
- [ ] Password reset flow
- [ ] Email verification
- [ ] Two-factor authentication
- [ ] Session timeout warnings
- [ ] Audit logging
- [ ] Role-based UI rendering
