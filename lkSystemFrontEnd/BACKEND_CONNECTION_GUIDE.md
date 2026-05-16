# 🔧 Backend Connection Troubleshooting Guide

## ✅ What Was Fixed

1. **Created `.env` file** with correct backend URL
2. **Added connection logging** to help debug issues
3. **Improved error messages** to show exactly what's wrong
4. **Added connection test utility** that runs automatically in development

## 🚀 Quick Fix Steps

### Step 1: Verify Backend is Running

Open a terminal and check if your Django backend is running:

```bash
# Check if backend is accessible
curl http://localhost:8000

# Or in PowerShell
Invoke-WebRequest -Uri http://localhost:8000
```

**Expected**: Backend should respond (200, 404, or any response)  
**If it fails**: Start your Django backend server first!

### Step 2: Start Your Django Backend

In your Django project directory:

```bash
# Activate virtual environment
source venv/bin/activate  # Linux/Mac
# or
.\venv\Scripts\activate   # Windows

# Run Django server
python manage.py runserver
```

Make sure it says: `Starting development server at http://127.0.0.1:8000/`

### Step 3: Restart the Frontend

**IMPORTANT**: After creating the `.env` file, you MUST restart the Vite dev server:

```bash
# Stop the current server (Ctrl+C)
# Then restart:
npm run dev
```

### Step 4: Check Browser Console

Open your browser console (F12) and look for these messages:

✅ **Good signs:**

```
🌐 API Client configured with base URL: http://localhost:8000
✅ Backend is reachable (Status: 200)
🔐 Attempting login to: /api/v1/auth/login/
```

❌ **Bad signs:**

```
❌ Cannot connect to backend: Failed to fetch
💡 Make sure your backend is running on: http://localhost:8000
```

## 🔍 Debugging Checklist

### 1. Backend Server

- [ ] Django server is running
- [ ] Server is on `http://localhost:8000` (or `127.0.0.1:8000`)
- [ ] No firewall blocking the port
- [ ] Check terminal for Django errors

### 2. Frontend Configuration

- [ ] `.env` file exists in project root
- [ ] `.env` contains `VITE_API_BASE_URL=http://localhost:8000`
- [ ] Vite dev server was restarted after creating `.env`
- [ ] Check browser console for connection test results

### 3. CORS Configuration

If backend is running but requests fail, you might need CORS headers.

**In Django settings.py:**

```python
# Install django-cors-headers
pip install django-cors-headers

# Add to INSTALLED_APPS
INSTALLED_APPS = [
    ...
    'corsheaders',
    ...
]

# Add to MIDDLEWARE (near the top)
MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    ...
]

# Allow frontend origin
CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:5174",
]

# Or for development (not recommended for production)
CORS_ALLOW_ALL_ORIGINS = True
```

### 4. Login Endpoint

Verify your Django endpoint matches:

```python
# urls.py should have:
urlpatterns = [
    path('api/v1/auth/login/', LoginView.as_view(), name='login'),
    # or
    path('api/v1/auth/', include('your_auth_app.urls')),
]
```

## 🐛 Common Errors & Solutions

### Error: "Network error. Please try again."

**Cause**: Cannot reach backend server  
**Solution**:

1. Start Django backend: `python manage.py runserver`
2. Verify it's running on port 8000
3. Check firewall settings

### Error: "ERR_CONNECTION_REFUSED"

**Cause**: Backend server is not running  
**Solution**: Start your Django server

### Error: "CORS policy error"

**Cause**: Backend not configured to accept requests from frontend  
**Solution**: Install and configure `django-cors-headers` (see section 3 above)

### Error: "404 Not Found"

**Cause**: Login endpoint URL doesn't match backend routes  
**Solution**:

1. Check Django URLs configuration
2. Verify endpoint is `/api/v1/auth/login/`
3. Update `AUTH_CONFIG.LOGIN_ENDPOINT` in `src/utils/constants.ts` if needed

### Error: "VITE_API_BASE_URL is undefined"

**Cause**: `.env` file not loaded or dev server not restarted  
**Solution**:

1. Verify `.env` file exists in project root
2. Restart Vite dev server (Ctrl+C, then `npm run dev`)
3. Check variable starts with `VITE_` (required by Vite)

## 📝 Manual Connection Test

You can manually test the connection using the browser console:

```javascript
// Test 1: Check API config
console.log('API Base URL:', import.meta.env.VITE_API_BASE_URL);

// Test 2: Test fetch
fetch('http://localhost:8000')
  .then(res => console.log('✅ Backend reachable:', res.status))
  .catch(err => console.error('❌ Backend unreachable:', err));

// Test 3: Test login endpoint
fetch('http://localhost:8000/api/v1/auth/login/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ matricule: 'test', password: 'test' }),
})
  .then(res => res.json())
  .then(data => console.log('Response:', data))
  .catch(err => console.error('Error:', err));
```

## 🔄 Complete Restart Steps

If nothing works, try a complete restart:

```bash
# 1. Stop frontend dev server (Ctrl+C)

# 2. Stop Django backend (Ctrl+C)

# 3. Clear browser cache and storage
# In browser: F12 → Application → Clear storage

# 4. Start Django backend
cd path/to/django/project
python manage.py runserver

# 5. Start frontend (in a new terminal)
cd path/to/frontend/project
npm run dev

# 6. Open browser to http://localhost:5173 (or shown port)
```

## 📞 Getting Help

If you're still having issues, check:

1. **Browser Console** (F12 → Console tab)
   - Look for error messages
   - Check API base URL log
   - Check connection test results

2. **Network Tab** (F12 → Network tab)
   - Look for failed requests
   - Check request URL
   - Check response status

3. **Django Terminal**
   - Look for incoming requests
   - Check for errors
   - Verify endpoint URLs

## ✨ Success Indicators

You'll know everything is working when:

✅ Browser console shows:

```
🌐 API Client configured with base URL: http://localhost:8000
✅ Backend is reachable (Status: 200)
```

✅ Login form appears without errors

✅ Submitting login shows:

```
🔐 Attempting login to: /api/v1/auth/login/
```

✅ Successful login redirects to dashboard

## 📁 Files Changed

- **Created**: `.env` - Contains backend URL
- **Updated**: `src/services/auth.service.ts` - Better error handling
- **Updated**: `src/services/axios.ts` - Connection logging
- **Created**: `src/utils/testConnection.ts` - Auto connection test
- **Updated**: `src/main.tsx` - Imports connection test

## 🎯 Next Steps After Connection Works

1. Test login with valid credentials
2. Check if tokens are stored (DevTools → Application → Local Storage)
3. Try accessing protected routes
4. Verify API calls include Bearer token

---

**Still stuck?** Share the error message from the browser console and Django terminal!
