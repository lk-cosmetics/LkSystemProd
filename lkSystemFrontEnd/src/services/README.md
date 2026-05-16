# Services Directory

This directory contains all API-related services and configurations for the application.

## Files

### `axios.ts`

Configured Axios instance with automatic authentication and token refresh.

**Features:**

- Automatic Bearer token attachment to all requests
- 401 error interception and token refresh
- Request/response type safety
- Automatic logout on refresh failure

**Usage:**

```tsx
import { apiClient } from '@/services/axios';

// GET request
const users = await apiClient.get('/api/v1/users');

// POST request
const newUser = await apiClient.post('/api/v1/users', userData);

// PUT request
const updated = await apiClient.put(`/api/v1/users/${id}`, userData);

// DELETE request
await apiClient.delete(`/api/v1/users/${id}`);
```

### `auth.service.ts`

Authentication service with login, logout, and token management.

**Methods:**

- `login(credentials)` - Authenticate user and store tokens
- `logout()` - Clear all auth data
- `refreshToken()` - Refresh expired access token
- `getStoredUser()` - Get user from localStorage
- `getStoredAccessToken()` - Get access token
- `isAuthenticated()` - Check if user is authenticated

**Usage:**

```tsx
import { authService } from '@/services/auth.service';

// Login
try {
  const response = await authService.login({
    matricule: 'EMP001',
    password: 'password123',
  });
  console.log('Logged in:', response.user);
} catch (error) {
  console.error('Login failed:', error);
}

// Logout
authService.logout();

// Check authentication
const isAuth = authService.isAuthenticated();
```

### `index.ts`

Barrel export file for clean imports.

**Usage:**

```tsx
// Instead of:
import { apiClient } from '@/services/axios';
import { authService } from '@/services/auth.service';

// Use:
import { apiClient, authService } from '@/services';
```

## Adding New Services

To add a new service (e.g., user service):

1. Create `user.service.ts`:

```tsx
import { apiClient } from './axios';

class UserService {
  async getAll() {
    const response = await apiClient.get('/api/v1/users');
    return response.data;
  }

  async getById(id: string) {
    const response = await apiClient.get(`/api/v1/users/${id}`);
    return response.data;
  }

  async create(data: CreateUserDto) {
    const response = await apiClient.post('/api/v1/users', data);
    return response.data;
  }

  async update(id: string, data: UpdateUserDto) {
    const response = await apiClient.put(`/api/v1/users/${id}`, data);
    return response.data;
  }

  async delete(id: string) {
    await apiClient.delete(`/api/v1/users/${id}`);
  }
}

export const userService = new UserService();
export default userService;
```

2. Export from `index.ts`:

```tsx
export { apiClient } from './axios';
export { authService } from './auth.service';
export { userService } from './user.service';
```

3. Use in components:

```tsx
import { userService } from '@/services';

const users = await userService.getAll();
```

## Best Practices

1. **Always use `apiClient`** instead of raw axios
   - Ensures tokens are attached
   - Handles refresh automatically

2. **Keep services focused**
   - One service per resource/domain
   - Clear, descriptive method names

3. **Type your responses**

   ```tsx
   async getUser(id: string): Promise<User> {
     const response = await apiClient.get<User>(`/users/${id}`);
     return response.data;
   }
   ```

4. **Handle errors in services**

   ```tsx
   async createUser(data: CreateUserDto) {
     try {
       const response = await apiClient.post('/users', data);
       return response.data;
     } catch (error) {
       if (error.response?.status === 409) {
         throw new Error('User already exists');
       }
       throw error;
     }
   }
   ```

5. **Use singleton pattern**
   ```tsx
   export const userService = new UserService();
   ```

## Error Handling

The axios instance automatically handles:

- 401 Unauthorized → Token refresh
- Network errors → Logged to console
- Refresh failures → Logout + redirect

For custom error handling:

```tsx
try {
  await apiClient.post('/api/endpoint', data);
} catch (error) {
  if (error.response?.status === 400) {
    // Handle validation error
  } else if (error.response?.status === 403) {
    // Handle permission error
  }
}
```

## Testing Services

Example service test:

```tsx
import { apiClient } from '@/services/axios';
import { userService } from '@/services/user.service';

jest.mock('@/services/axios');

describe('UserService', () => {
  it('should fetch all users', async () => {
    const mockUsers = [{ id: '1', name: 'John' }];
    (apiClient.get as jest.Mock).mockResolvedValue({
      data: mockUsers,
    });

    const users = await userService.getAll();
    expect(users).toEqual(mockUsers);
  });
});
```
