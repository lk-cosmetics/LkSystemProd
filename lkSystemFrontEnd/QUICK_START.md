# 🎯 Authentication System - Quick Start Guide

## ✅ What's Been Implemented

A complete, production-ready authentication system with:

1. **Service Layer** (`src/services/`)
   - `axios.ts` - Configured HTTP client with automatic token attachment
   - `auth.service.ts` - Login, logout, and token refresh methods
   - `index.ts` - Clean exports

2. **State Management** (`src/store/`)
   - `authStore.ts` - Zustand store with persistent auth state

3. **Components**
   - `ProtectedRoute.tsx` - Guards authenticated routes
   - `LogoutButton.tsx` - Reusable logout button
   - `UserProfile.tsx` - Example component with role-based rendering
   - `login-form.tsx` - Updated with auth integration

4. **Hooks** (`src/hooks/`)
   - `useAuth.ts` - RBAC utilities and permission checks

5. **Types** (`src/types/index.ts`)
   - Complete TypeScript definitions for auth system

## 🚀 Getting Started

### 1. Start Your Backend

Ensure your Django backend is running on `http://localhost:8000`

### 2. Start the Frontend

```bash
npm run dev
```

### 3. Test the Login Flow

- Navigate to `http://localhost:3000/login`
- Enter credentials (matricule and password)
- On success, redirected to `/dashboard`

## 📝 Common Usage Patterns

### Access Current User

```tsx
import { useAuthStore } from '@/store/authStore';

function MyComponent() {
  const user = useAuthStore(state => state.user);
  return <p>Welcome, {user?.matricule}!</p>;
}
```

### Check Permissions

```tsx
import { useAuth } from '@/hooks/useAuth';

function AdminButton() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('admin');

  if (!isAdmin) return null;
  return <button>Admin Action</button>;
}
```

### Make API Calls

```tsx
import { apiClient } from '@/services/axios';

async function fetchData() {
  // Token is automatically attached!
  const response = await apiClient.get('/api/v1/data');
  return response.data;
}
```

### Add Logout Button

```tsx
import LogoutButton from '@/components/LogoutButton';

<LogoutButton variant="ghost" />;
```

## 🔐 How It Works

### Request Flow

1. User logs in → tokens stored in localStorage
2. Every API request → axios attaches `Authorization: Bearer <token>`
3. Token expires → axios intercepts 401 error
4. Axios calls refresh endpoint → gets new access token
5. Original request retried with new token
6. If refresh fails → user logged out and redirected

### Security Features

- ✅ Automatic token refresh
- ✅ 401 error handling
- ✅ Secure token storage
- ✅ Protected routes
- ✅ Type-safe authentication state

## 📁 File Structure

```
src/
├── services/
│   ├── axios.ts              # HTTP client with interceptors
│   ├── auth.service.ts       # Auth API methods
│   └── index.ts
├── store/
│   └── authStore.ts          # Global auth state
├── components/
│   ├── ProtectedRoute.tsx    # Route guard
│   ├── LogoutButton.tsx      # Logout button
│   ├── UserProfile.tsx       # Example component
│   └── login-form.tsx        # Login form
├── hooks/
│   └── useAuth.ts            # RBAC utilities
├── types/
│   └── index.ts              # Auth types
└── utils/
    └── constants.ts          # API config
```

## 🎨 Components You Can Use

### 1. ProtectedRoute

```tsx
<Route element={<ProtectedRoute />}>
  <Route path="/admin" element={<AdminPanel />} />
</Route>
```

### 2. LogoutButton

```tsx
<LogoutButton variant="destructive" className="w-full" />
```

### 3. UserProfile

```tsx
import { UserProfile } from '@/components/UserProfile';

<UserProfile />;
```

## 🔧 Configuration

### Update Backend URL

In `.env`:

```env
VITE_API_BASE_URL=http://localhost:8000
```

### Customize Endpoints

In `src/utils/constants.ts`:

```typescript
export const AUTH_CONFIG = {
  LOGIN_ENDPOINT: '/api/v1/auth/login/',
  REFRESH_ENDPOINT: '/api/v1/auth/refresh/',
  // ...
};
```

## 🐛 Troubleshooting

### "Network Error"

- Backend not running
- Wrong URL in `.env`
- CORS not configured

### "Invalid Credentials"

- Wrong matricule/password
- Check backend response format

### Infinite Redirects

- Clear localStorage: `localStorage.clear()`
- Check token validity

## 📚 Documentation

Full documentation: [AUTH_DOCUMENTATION.md](./AUTH_DOCUMENTATION.md)

## ✨ Next Steps

Consider adding:

- Password reset flow
- Remember me checkbox
- Session timeout warnings
- Audit logging
- Two-factor authentication

---

**Need help?** Check the full documentation or review example components in `src/components/`.
