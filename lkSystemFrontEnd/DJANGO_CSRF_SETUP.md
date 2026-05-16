# Django Backend Configuration for CSRF and CORS

## ⚠️ Required Django Settings

Add these configurations to your Django `settings.py`:

```python
# CORS Configuration
CORS_ALLOWED_ORIGINS = [
    "http://localhost:5174",  # Vite dev server
    "http://localhost:3000",  # Alternative port
    "http://127.0.0.1:5174",
    "http://127.0.0.1:3000",
]

CORS_ALLOW_CREDENTIALS = True  # REQUIRED for cookies

# CSRF Configuration
CSRF_TRUSTED_ORIGINS = [
    "http://localhost:5174",
    "http://localhost:3000",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:3000",
]

# Cookie Settings
CSRF_COOKIE_HTTPONLY = False  # IMPORTANT: Frontend needs to read this
CSRF_COOKIE_SECURE = False    # Set to True in production with HTTPS
CSRF_COOKIE_SAMESITE = 'Lax'  # or 'None' if cross-domain

SESSION_COOKIE_SECURE = False  # Set to True in production
SESSION_COOKIE_SAMESITE = 'Lax'

# For development only - disable CSRF check (NOT RECOMMENDED)
# CSRF_USE_SESSIONS = False
# CSRF_COOKIE_NAME = 'csrftoken'
```

## 🔧 Install and Configure CORS

```bash
pip install django-cors-headers
```

Add to `INSTALLED_APPS`:

```python
INSTALLED_APPS = [
    ...
    'corsheaders',
    ...
]
```

Add to `MIDDLEWARE` (near the top, before CommonMiddleware):

```python
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',  # Add this
    'django.middleware.common.CommonMiddleware',
    ...
]
```

## 📝 Create CSRF Token Endpoint

Create a view to provide CSRF token:

**`your_app/views.py`:**

```python
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import ensure_csrf_cookie

@ensure_csrf_cookie
@require_http_methods(["GET"])
def get_csrf_token(request):
    return JsonResponse({'detail': 'CSRF cookie set'})
```

**`your_app/urls.py`:**

```python
from django.urls import path
from .views import get_csrf_token

urlpatterns = [
    path('api/v1/csrf/', get_csrf_token, name='csrf'),
    # ... other urls
]
```

## 🔐 Authentication Endpoints

Ensure your login endpoint sets the CSRF cookie:

```python
from django.views.decorators.csrf import ensure_csrf_cookie

@ensure_csrf_cookie
def login_view(request):
    # Your login logic
    # Django automatically sets csrftoken cookie with @ensure_csrf_cookie
    return JsonResponse({
        'access': access_token,
        'user': {...}
    })
```

## ✅ Testing Configuration

1. **Check CSRF cookie is set:**
   - Open browser DevTools → Application → Cookies
   - You should see `csrftoken` cookie from your backend

2. **Check CORS headers:**
   - In Network tab, check response headers include:
     - `Access-Control-Allow-Origin: http://localhost:5174`
     - `Access-Control-Allow-Credentials: true`

3. **Test POST request:**
   ```bash
   curl -X POST http://localhost:8000/api/v1/company/ \
     -H "Content-Type: application/json" \
     -H "X-CSRFToken: <token-from-cookie>" \
     -b "csrftoken=<token-from-cookie>" \
     --data '{"name":"Test"}'
   ```

## 🚀 Production Settings

For production with HTTPS:

```python
# Production settings
CSRF_COOKIE_SECURE = True
CSRF_COOKIE_HTTPONLY = False  # Keep False for frontend access
CSRF_COOKIE_SAMESITE = 'None'  # Required for cross-origin

SESSION_COOKIE_SECURE = True
SESSION_COOKIE_SAMESITE = 'None'

CORS_ALLOWED_ORIGINS = [
    "https://yourdomain.com",
]

CSRF_TRUSTED_ORIGINS = [
    "https://yourdomain.com",
]
```

## 🔍 Troubleshooting

### Issue: "CSRF Failed: Origin checking failed"

**Solution:** Add frontend URL to `CSRF_TRUSTED_ORIGINS`

### Issue: CSRF cookie not being sent

**Solution:**

- Ensure `CORS_ALLOW_CREDENTIALS = True`
- Ensure `withCredentials: true` in axios (already configured)

### Issue: Cookie not visible in browser

**Solution:**

- Check `CSRF_COOKIE_HTTPONLY = False`
- Clear browser cookies and try again

### Issue: CORS errors

**Solution:**

- Ensure `django-cors-headers` is installed
- Check middleware order (CorsMiddleware before CommonMiddleware)
- Verify `CORS_ALLOWED_ORIGINS` includes your frontend URL

## 📚 References

- [Django CORS Headers](https://github.com/adamchainz/django-cors-headers)
- [Django CSRF Protection](https://docs.djangoproject.com/en/stable/ref/csrf/)
- [MDN: CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
