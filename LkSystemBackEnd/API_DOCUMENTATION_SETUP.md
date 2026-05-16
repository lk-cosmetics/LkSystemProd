# LkSystem API Documentation Setup & Authentication Guide

## ✅ Fixed Issues
This document outlines the fixes applied to resolve the API documentation (Swagger/ReDoc) errors and add proper authentication.

### Problem Fixed
**Error:** `Failed to load API definition` at `/api/docs/` with "Fetch error Internal Server Error /api/schema/"

**Root Cause:** Incorrect permission class configuration in URL patterns. The `permission_classes` parameter was being passed to `.as_view()` which doesn't properly override permissions.

**Solution:** Created dedicated view classes that properly override `permission_classes` as class attributes.

---

## 🔐 Authentication Architecture

### Endpoints
| Endpoint | Access | Purpose |
|----------|--------|---------|
| `/api/schema/` | **Public (AllowAny)** | OpenAPI schema (used by clients) |
| `/api/docs/` | **Authenticated (JWT)** | Swagger UI interface |
| `/api/redoc/` | **Authenticated (JWT)** | ReDoc UI interface |
| `/api/v1/auth/login/` | **Public** | Get JWT token |
| `/api/v1/auth/refresh/` | **Public** | Refresh expired token |
| All other endpoints | **Authenticated** | Business logic endpoints |

---

## 🚀 How to Access API Documentation

### Step 1: Get JWT Token
```bash
curl -X POST http://localhost:8000/api/v1/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{
    "matricule": "your_login",
    "password": "your_password"
  }'
```

**Response:**
```json
{
  "access": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "refresh": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9..."
}
```

### Step 2: Access API Documentation
1. Go to `http://localhost:8000/api/docs/`
2. Click **"Authorize"** button (top-right)
3. Paste the `access` token in the format:
   ```
   Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...
   ```
4. Click **"Authorize"** and then **"Close"**

Now you can:
- ✅ View all API endpoints
- ✅ See request/response schemas
- ✅ Test endpoints directly from the UI
- ✅ Copy curl commands for API calls

### Alternative: ReDoc
- **ReDoc UI**: `http://localhost:8000/api/redoc/` (same authentication)
- Better for reading documentation
- Less interactive than Swagger

---

## 📝 API Authentication for Clients

### Using JWT Tokens
```bash
curl -X GET http://localhost:8000/api/v1/users/ \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Token Expiration & Refresh
Tokens typically expire after 1 hour. Refresh them using:
```bash
curl -X POST http://localhost:8000/api/v1/auth/refresh/ \
  -H "Content-Type: application/json" \
  -d '{
    "refresh": "YOUR_REFRESH_TOKEN"
  }'
```

---

## 🔧 Technical Details

### View Classes
The following custom view classes handle authentication properly:

```python
# core/urls.py

class PublicSpectacularAPIView(SpectacularAPIView):
    """Public schema endpoint (no authentication required)."""
    permission_classes = [AllowAny]

class AuthenticatedSwaggerView(SpectacularSwaggerView):
    """Swagger UI - requires authentication."""
    permission_classes = [IsAuthenticated]

class AuthenticatedReDocView(SpectacularRedocView):
    """ReDoc UI - requires authentication."""
    permission_classes = [IsAuthenticated]
```

### URL Configuration
```python
# API Schema (used by clients to fetch OpenAPI spec)
path('api/schema/', PublicSpectacularAPIView.as_view(), name='schema'),

# Documentation UIs (require JWT authentication)
path('api/docs/', AuthenticatedSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
path('api/redoc/', AuthenticatedReDocView.as_view(url_name='schema'), name='redoc'),
```

---

## 🔒 Security Benefits

1. **Schema is Public**: Tools and clients can fetch the OpenAPI specification for client generation
2. **Documentation is Authenticated**: Only authorized users can access the interactive documentation
3. **JWT-Based**: Secure, stateless authentication using industry-standard tokens
4. **CORS Enabled**: Frontend can make authenticated requests

---

## 🛠️ Testing the Setup

### Test Schema Generation
```bash
curl http://localhost:8000/api/schema/ | python -m json.tool
```

### Test Swagger UI (requires auth)
```bash
# This will fail without token (403 Forbidden)
curl http://localhost:8000/api/docs/

# With token (will load HTML page)
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:8000/api/docs/
```

### Test API Endpoint with Auth
```bash
curl -X GET http://localhost:8000/api/v1/users/ \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json"
```

---

## ✨ What's Now Working

| Feature | Status |
|---------|--------|
| OpenAPI Schema Generation | ✅ Fixed |
| Swagger UI Load | ✅ Fixed |
| ReDoc UI Load | ✅ Fixed |
| JWT Authentication | ✅ Configured |
| API Docs Security | ✅ Secured |
| CORS for Frontend | ✅ Enabled |

---

## 📚 Additional Resources

- **OpenAPI Spec**: `http://localhost:8000/api/schema/`
- **Swagger UI**: `http://localhost:8000/api/docs/`
- **ReDoc UI**: `http://localhost:8000/api/redoc/`
- **Django Admin**: `http://localhost:8000/admin/`
- **API Root**: `http://localhost:8000/` (lists all endpoints)

---

## 🐛 Troubleshooting

### Still Getting 500 Error?
1. Check Django logs: `python manage.py runserver` (should show errors)
2. Ensure database is running: `docker-compose up db redis` (if using Docker)
3. Run migrations: `python manage.py migrate`
4. Check settings: `INSTALLED_APPS` must be correct

### Token Invalid Error?
- Token may be expired → use `/api/v1/auth/refresh/` to get new one
- Check token format: should be `Bearer YOUR_TOKEN` (with space)
- Verify token is from same server instance

### CORS Issues on Frontend?
- Check `CORS_ALLOWED_ORIGINS` in settings.py
- Ensure frontend URL is in the list
- Check `CSRF_TRUSTED_ORIGINS` for form submissions

---

## 📞 Support

For issues with the API, check:
1. Server logs: `python manage.py runserver`
2. Browser console: F12 → Network tab
3. `/api/` endpoint: Shows all available endpoints
4. Django Admin: `/admin/` for database verification
