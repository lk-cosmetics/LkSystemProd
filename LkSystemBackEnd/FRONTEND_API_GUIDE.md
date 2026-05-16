# API Integration Guide for Frontend

## Quick Start

### 1. Login and Get Token
```javascript
// POST /api/v1/auth/login/
const response = await fetch('http://localhost:8000/api/v1/auth/login/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    matricule: 'user_login',
    password: 'user_password'
  })
});

const { access, refresh } = await response.json();
localStorage.setItem('access_token', access);
localStorage.setItem('refresh_token', refresh);
```

### 2. Use Token in API Calls
```javascript
const apiCall = (endpoint, options = {}) => {
  const token = localStorage.getItem('access_token');
  
  return fetch(`http://localhost:8000/api/v1${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers
    }
  });
};

// Usage
const users = await apiCall('/users/', { method: 'GET' });
```

### 3. Refresh Expired Token
```javascript
const refreshToken = async () => {
  const refresh = localStorage.getItem('refresh_token');
  
  const response = await fetch('http://localhost:8000/api/v1/auth/refresh/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh })
  });
  
  const { access } = await response.json();
  localStorage.setItem('access_token', access);
};
```

---

## Access API Documentation

Once logged in, you can:
1. Visit `http://localhost:8000/api/docs/` (Swagger UI)
2. Or `http://localhost:8000/api/redoc/` (ReDoc)
3. Click **Authorize** button and paste `Bearer YOUR_TOKEN`
4. Explore and test all endpoints

---

## Axios Example (Recommended)
```javascript
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8000/api/v1',
  headers: {
    'Content-Type': 'application/json',
  }
});

// Add token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 errors (token expired)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response.status === 401) {
      try {
        const { data } = await axios.post(
          'http://localhost:8000/api/v1/auth/refresh/',
          { refresh: localStorage.getItem('refresh_token') }
        );
        localStorage.setItem('access_token', data.access);
        // Retry original request
        return api(error.config);
      } catch {
        // Redirect to login
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
```

---

## Environment Setup

Create `.env` file in frontend root:
```
VITE_API_URL=http://localhost:8000
VITE_API_TIMEOUT=30000
```

Use in code:
```javascript
const API_URL = import.meta.env.VITE_API_URL;
```

---

## POS Real-Time Inventory & Promotions

### Inventory (initial load + real-time updates)
1. **Initial load (REST)**
   ```
   GET /api/v1/inventory/store-inventory/?sales_channel=<POS_CHANNEL_ID>
   ```
2. **Real-time updates (WebSocket)**
   ```
   ws://localhost:8000/ws/inventory/
   ```
   Example payload:
   ```json
   {
     "event": "updated",
     "inventory_id": 12,
     "sales_channel_id": 3,
     "product_id": 45,
     "quantity": 18,
     "reserved_quantity": 0,
     "available_quantity": 18,
     "minimum_quantity": 2,
     "maximum_quantity": 50,
     "updated_at": "2026-04-23T10:22:11.123Z"
   }
   ```

### Promotions (POS-only)
Use the discount calculator from the POS page:
```
POST /api/v1/promotions/calculate_discount/
{
  "product_id": 45,
  "sales_channel_id": 3,
  "original_price": "19.99"
}
```
Only POS channels are accepted.

### POS Order Creation (with discounts)
```
POST /api/v1/orders/pos/
{
  "sales_channel": 3,
  "line_items": [...],
  "discount_type": "PERCENTAGE",
  "discount_value": "10.00"
}
```

### WooCommerce Order Sync
WooCommerce sync/preview endpoints now only ingest orders with status **completed**.

---

## Testing Authentication

### Check if Token is Valid
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8000/api/v1/users/
```

### Check Schema (No Auth Needed)
```bash
curl http://localhost:8000/api/schema/ | json_pp
```

### Check API Docs (Auth Needed)
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8000/api/docs/
```

---

## Common Issues

| Issue | Solution |
|-------|----------|
| 401 Unauthorized | Token expired or invalid → refresh or re-login |
| 403 Forbidden | Missing permissions → check user role |
| 404 Not Found | Endpoint doesn't exist → check schema |
| 500 Internal Error | Server error → check backend logs |
| CORS Error | Frontend URL not in CORS_ALLOWED_ORIGINS |

---

## API Endpoints Overview

Available at: `http://localhost:8000/`

Example endpoints:
- **Auth**: `/api/v1/auth/login/`, `/api/v1/auth/refresh/`
- **Users**: `/api/v1/users/`
- **Companies**: `/api/v1/company/`
- **Brands**: `/api/v1/brands/`
- **Products**: `/api/v1/products/`
- **Orders**: `/api/v1/orders/`
- **Inventory**: `/api/v1/inventory/`

---

## Notes for Developers

1. **Always use JWT tokens** for API calls (except login/refresh)
2. **Store tokens securely** (localStorage is acceptable for development)
3. **Implement token refresh logic** to handle expiration gracefully
4. **Set up CORS properly** on both frontend and backend
5. **Use environment variables** for API URL (production vs development)
6. **Handle 401 errors** by redirecting to login
