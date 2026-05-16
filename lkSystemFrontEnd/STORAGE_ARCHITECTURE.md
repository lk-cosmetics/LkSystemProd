# 🏗️ Storage Architecture Guide

## 📦 Storage Strategy Overview

Your app now uses a **three-tier security architecture** for optimal security and performance:

```
┌─────────────────────────────────────────────────────────────┐
│  TIER 1: Memory (Session Only)                              │
│  🔒 Access Token                                             │
│  ✅ Most Secure - Cleared on page close                     │
│  ✅ Cannot be stolen via XSS                                │
│  ✅ Short-lived (15 minutes typical)                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  TIER 2: HttpOnly Cookies (Backend Managed)                 │
│  🔒 Refresh Token                                            │
│  ✅ Invisible to JavaScript - XSS-proof                     │
│  ✅ Backend sets with HttpOnly=True                         │
│  ✅ Long-lived (24 hours typical)                           │
│  ✅ SameSite=Strict - CSRF protection                       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  TIER 3: LocalStorage (Non-Sensitive UI Data)               │
│  📋 User Display Info (Name, Avatar)                        │
│  🎨 Theme Preference (Dark/Light)                           │
│  🌍 Language Setting (en, fr, ar)                           │
│  📊 Active Brand ID                                          │
│  📐 Sidebar State (Collapsed/Expanded)                      │
│  ✅ Fast access, survives page refresh                      │
│  ⚠️ Visible to JavaScript - NO sensitive data               │
└─────────────────────────────────────────────────────────────┘
```

## 🎯 What Goes Where?

### ❌ NEVER Store in LocalStorage

- ❌ Access tokens
- ❌ Refresh tokens
- ❌ Passwords
- ❌ API keys
- ❌ Full user objects with permissions
- ❌ Any data that could compromise account security

### ✅ LocalStorage (Non-Sensitive Only)

```typescript
// User Display Info (for navbar, UI only)
{
  id: "123",
  matricule: "EMP001",
  firstName: "John",
  lastName: "Doe",
  email: "john@example.com",
  // NO roles, NO permissions, NO sensitive data
}

// UI Preferences
- active_brand: 1
- theme_preference: "dark"
- language: "fr"
- sidebar_state: false
```

### 🍪 HttpOnly Cookies (Backend Managed)

```python
# Django Backend Example
response.set_cookie(
    'refresh_token',
    refresh_token_value,
    httponly=True,      # ✅ Not accessible to JavaScript
    secure=True,        # ✅ HTTPS only
    samesite='Strict',  # ✅ CSRF protection
    max_age=86400       # 24 hours
)
```

### 💾 Memory (In-Memory Only)

```typescript
// Access token stored in memory
// Automatically cleared when:
// - User closes tab/browser
// - Page refresh (then auto-refreshed using HttpOnly cookie)
```

## 🔧 Backend Requirements

### Django Login Endpoint

```python
from rest_framework.decorators import api_view
from rest_framework.response import Response

@api_view(['POST'])
def login(request):
    matricule = request.data.get('matricule')
    password = request.data.get('password')

    # Validate credentials
    user = authenticate(matricule=matricule, password=password)

    if user:
        # Generate tokens
        refresh = RefreshToken.for_user(user)
        access_token = str(refresh.access_token)
        refresh_token = str(refresh)

        # Prepare response
        response = Response({
            'access': access_token,
            'user': {
                'id': user.id,
                'matricule': user.matricule,
                'firstName': user.first_name,
                'lastName': user.last_name,
                'email': user.email,
            }
        })

        # Set HttpOnly cookie for refresh token
        response.set_cookie(
            key='refresh_token',
            value=refresh_token,
            httponly=True,      # ✅ JavaScript cannot access
            secure=True,        # ✅ HTTPS only (use False for localhost dev)
            samesite='Strict',  # ✅ CSRF protection
            max_age=86400       # 24 hours
        )

        return response

    return Response({'detail': 'Invalid credentials'}, status=401)
```

### Django Refresh Endpoint

```python
@api_view(['POST'])
def refresh_token(request):
    # Read refresh token from HttpOnly cookie
    refresh_token = request.COOKIES.get('refresh_token')

    if not refresh_token:
        return Response({'detail': 'No refresh token'}, status=401)

    try:
        refresh = RefreshToken(refresh_token)
        access_token = str(refresh.access_token)

        return Response({
            'access': access_token
        })
    except Exception as e:
        return Response({'detail': 'Invalid token'}, status=401)
```

### Django Logout Endpoint

```python
@api_view(['POST'])
def logout(request):
    response = Response({'detail': 'Logged out successfully'})

    # Clear the HttpOnly cookie
    response.delete_cookie('refresh_token')

    return response
```

### CORS Settings

```python
# settings.py

CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:5174",
]

CORS_ALLOW_CREDENTIALS = True  # ✅ Required for cookies

# For development only (remove in production)
CORS_ALLOW_ALL_ORIGINS = False
```

## 💻 Frontend Usage

### Authentication (Automatic)

```typescript
import { useAuthStore } from '@/store/authStore';

function LoginPage() {
  const { login, isLoading, error } = useAuthStore();

  const handleLogin = async () => {
    try {
      // Backend automatically sets HttpOnly cookie
      await login({ matricule: 'EMP001', password: 'password' });
      // User display data stored in localStorage
      // Access token stored in memory
      navigate('/dashboard');
    } catch (err) {
      console.error('Login failed:', err);
    }
  };

  return <button onClick={handleLogin}>Login</button>;
}
```

### UI Preferences

```typescript
import {
  useActiveBrand,
  useThemePreference,
  useLanguagePreference,
  useSidebarState
} from '@/hooks/usePreferences';

function UserSettings() {
  const [brand, setBrand] = useActiveBrand();
  const [theme, setTheme] = useThemePreference();
  const [language, setLanguage] = useLanguagePreference();
  const [isCollapsed, setCollapsed] = useSidebarState();

  return (
    <div>
      {/* Brand Selection */}
      <select value={brand || ''} onChange={(e) => setBrand(Number(e.target.value))}>
        <option value="1">Brand 1</option>
        <option value="2">Brand 2</option>
      </select>

      {/* Theme Toggle */}
      <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
        {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
      </button>

      {/* Language Selector */}
      <select value={language} onChange={(e) => setLanguage(e.target.value as any)}>
        <option value="en">English</option>
        <option value="fr">Français</option>
        <option value="ar">العربية</option>
      </select>

      {/* Sidebar Toggle */}
      <button onClick={() => setCollapsed(!isCollapsed)}>
        {isCollapsed ? '📂 Expand' : '📁 Collapse'} Sidebar
      </button>
    </div>
  );
}
```

### Custom LocalStorage Data

```typescript
import { useLocalStorage } from '@/hooks/useStorage';

function MyComponent() {
  // Store any non-sensitive data
  const [recentSearches, setRecentSearches] = useLocalStorage<string[]>(
    'recent_searches',
    []
  );

  const addSearch = (query: string) => {
    setRecentSearches(prev => [query, ...prev].slice(0, 10)); // Keep last 10
  };

  return (
    <div>
      {recentSearches.map(search => (
        <div key={search}>{search}</div>
      ))}
    </div>
  );
}
```

## 🔒 Security Benefits

| Storage Type        | XSS Protection | CSRF Protection | Survives Refresh | Use Case       |
| ------------------- | -------------- | --------------- | ---------------- | -------------- |
| **Memory**          | ⭐⭐⭐⭐⭐     | ⭐⭐⭐⭐⭐      | ❌ No            | Access tokens  |
| **HttpOnly Cookie** | ⭐⭐⭐⭐⭐     | ⭐⭐⭐⭐⭐      | ✅ Yes           | Refresh tokens |
| **LocalStorage**    | ❌ Vulnerable  | ⭐⭐⭐⭐⭐      | ✅ Yes           | UI preferences |

## 📊 Data Flow Diagram

### Login Flow

```
1. User submits credentials
   ↓
2. Backend validates & generates tokens
   ↓
3. Backend sends:
   - access token (in response body)
   - refresh token (in HttpOnly cookie) ✅
   - user display data (in response body)
   ↓
4. Frontend stores:
   - access token → Memory ✅
   - user display → LocalStorage ✅
   - refresh token → Already in cookie (backend managed) ✅
   ↓
5. User redirected to dashboard
```

### API Request Flow

```
1. User makes request
   ↓
2. Axios attaches access token from memory
   ↓
3. Request sent to backend
   ↓
4. If 401 (token expired):
   - Send refresh request
   - HttpOnly cookie sent automatically ✅
   - Get new access token
   - Retry original request
   ↓
5. Success
```

### Page Refresh Flow

```
1. Page refreshes
   ↓
2. Access token cleared (was in memory)
   ↓
3. Check localStorage for user display data
   ↓
4. If exists:
   - Call refresh endpoint
   - HttpOnly cookie sent automatically ✅
   - Get new access token
   - Store in memory
   - User stays logged in ✅
   ↓
5. If not exists:
   - Redirect to login
```

## 🐛 Troubleshooting

### "Cannot set HttpOnly cookie from frontend"

✅ **Correct**: Backend must set the cookie  
❌ **Wrong**: JavaScript trying to set HttpOnly cookie (impossible)

### "Cookie not being sent with requests"

Check:

- `withCredentials: true` in axios config ✅
- `CORS_ALLOW_CREDENTIALS = True` in Django ✅
- Same domain or CORS properly configured

### "User logged out after page refresh"

Check:

- Backend is setting HttpOnly cookie correctly
- Cookie expiration is sufficient (24h recommended)
- Refresh endpoint is working

### "LocalStorage data not persisting"

Check:

- Not in incognito/private mode
- Browser not clearing storage
- Using correct storage key

## 📝 Migration Checklist

- [x] Update auth service to use HttpOnly cookies
- [x] Add `withCredentials: true` to axios
- [x] Remove encrypted cookie storage (not needed)
- [x] Create UI preferences hooks
- [x] Update constants with new storage keys
- [ ] **Backend**: Implement HttpOnly cookie in login
- [ ] **Backend**: Implement refresh endpoint with cookie
- [ ] **Backend**: Implement logout to clear cookie
- [ ] **Backend**: Enable CORS with credentials
- [ ] Test login flow
- [ ] Test page refresh persistence
- [ ] Test logout clears everything

## 🎯 Next Steps

1. **Update your Django backend** to set HttpOnly cookies
2. **Test the login flow** with backend
3. **Verify cookies** in DevTools → Application → Cookies
4. **Test page refresh** - should stay logged in
5. **Use preference hooks** for UI settings

---

**Your app now has industry-standard security architecture!** 🎉
