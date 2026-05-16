# LkSystem - Complete Setup & Deployment Guide 🚀

**Professional Django + React Full-Stack Application**
- **Backend**: Django 5+ REST Framework with Micro-App Architecture
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS
- **Database**: PostgreSQL 15
- **Caching**: Redis 7
- **Task Queue**: Celery (optional)
- **Real-time**: WebSockets via Channels

---

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Setup (Without Docker)](#local-setup-without-docker)
3. [Docker Setup](#docker-setup)
4. [Environment Configuration](#environment-configuration)
5. [Running the Application](#running-the-application)
6. [Verification & Testing](#verification--testing)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| Python    | 3.10    | 3.12+       |
| Node.js   | 18.x    | 20.x LTS    |
| npm       | 9.x     | 10.x        |
| Git       | 2.30+   | Latest      |
| PostgreSQL| 13      | 15+         |
| Redis     | 6       | 7+          |

### System Packages (Windows)

**Option 1: Using Chocolatey (Recommended)**
```powershell
# Run as Administrator
choco install python nodejs postgresql redis-64 git

# Verify installations
python --version
node --version
npm --version
pg_isready
redis-cli --version
```

**Option 2: Manual Installation**
- **Python**: Download from [python.org](https://www.python.org/downloads/)
- **Node.js**: Download from [nodejs.org](https://nodejs.org/)
- **PostgreSQL**: Download from [postgresql.org](https://www.postgresql.org/download/windows/)
- **Redis**: Download from [github.com/microsoftarchive/redis](https://github.com/microsoftarchive/redis/releases)

---

## Local Setup (Without Docker)

### Step 1: Clone & Navigate

```powershell
cd C:\Users\saker\Desktop\StagePfe
```

### Step 2: Backend Setup

#### 2.1 Create Python Virtual Environment (VENV Best Practices)

```powershell
# Navigate to backend directory
cd LkSystemBackEnd

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows PowerShell:
.\venv\Scripts\Activate.ps1

# If you get execution policy error, run:
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# You should see (venv) in your terminal prompt
# Example: (venv) PS C:\...\LkSystemBackEnd>
```

#### 2.2 Install Python Dependencies

```powershell
# Upgrade pip first
python -m pip install --upgrade pip setuptools wheel

# Install requirements
pip install -r requirements.txt

# Verify installation
pip list
```

#### 2.3 Database & Services Setup

**A. PostgreSQL Setup**

```powershell
# Start PostgreSQL service (if installed)
# Windows: net start postgresql-x64-15
# Or use pgAdmin 4 GUI

# Test PostgreSQL connection
psql -U postgres -h localhost

# Create database and user
psql -U postgres -h localhost

# In PostgreSQL prompt, run:
CREATE USER lksystem_user WITH PASSWORD 'lksystem_password';
CREATE DATABASE lksystem OWNER lksystem_user;
ALTER ROLE lksystem_user SET client_encoding TO 'utf8';
ALTER ROLE lksystem_user SET default_transaction_isolation TO 'read committed';
ALTER ROLE lksystem_user SET default_transaction_deferrable TO on;
ALTER ROLE lksystem_user SET default_transaction_level TO 'read committed';
ALTER ROLE lksystem_user SET timezone TO 'UTC';
GRANT ALL PRIVILEGES ON DATABASE lksystem TO lksystem_user;
\q
```

**B. Redis Setup**

```powershell
# Start Redis service
# Windows: redis-server.exe
# Or if installed as service: 
# net start Redis

# Test Redis connection
redis-cli ping
# Expected output: PONG
```

#### 2.4 Create `.env` File

```powershell
# Navigate to LkSystemBackEnd if not already there
cd LkSystemBackEnd

# Create .env file with your favorite editor
# Or use PowerShell:
New-Item -Path ".env" -ItemType File -Force
```

**Content for `.env`:**

```
# ===== SECURITY =====
SECRET_KEY=your-secret-key-change-in-production-use-50-chars-minimum
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1,127.0.0.1:3000,127.0.0.1:5173

# ===== DATABASE =====
POSTGRES_ENGINE=django.db.backends.postgresql
POSTGRES_DB=lksystem
POSTGRES_USER=lksystem_user
POSTGRES_PASSWORD=lksystem_password
POSTGRES_HOST=localhost
POSTGRES_PORT=5432

# ===== REDIS & CACHE =====
REDIS_URL=redis://localhost:6379/0
CACHE_URL=redis://localhost:6379/1

# ===== CELERY (Optional) =====
CELERY_BROKER_URL=redis://localhost:6379/1
CELERY_RESULT_BACKEND=redis://localhost:6379/1

# ===== CORS =====
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173

# ===== JWT =====
JWT_SECRET_KEY=your-jwt-secret-key-change-in-production
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=60
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7

# ===== EMAIL (Optional) =====
EMAIL_BACKEND=django.core.mail.backends.console.EmailBackend
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=your-email@gmail.com
EMAIL_HOST_PASSWORD=your-app-password

# ===== WooCommerce (Optional) =====
WOOCOMMERCE_API_URL=https://your-woocommerce-store.com
WOOCOMMERCE_CONSUMER_KEY=your-consumer-key
WOOCOMMERCE_CONSUMER_SECRET=your-consumer-secret

# ===== AUTO ADMIN =====
AUTO_CREATE_DEFAULT_ADMIN=True
DEFAULT_ADMIN_MATRICULE=SUPERADMIN-0001
DEFAULT_ADMIN_EMAIL=admin@lksystem.local
DEFAULT_ADMIN_PASSWORD=ChangeMe123!
DEFAULT_ADMIN_FIRST_NAME=Super
DEFAULT_ADMIN_LAST_NAME=Admin

# ===== LOGGING =====
LOG_LEVEL=INFO
```

#### 2.5 Database Migrations

```powershell
# From LkSystemBackEnd directory with venv activated
python manage.py makemigrations

# Apply migrations
python manage.py migrate

# Expected output:
# Running migrations:
#   Applying contenttypes.0001_initial... OK
#   Applying users.0001_initial... OK
#   ... (many more migrations)
```

#### 2.6 Create Superuser & Collect Static Files

```powershell
# Create superuser (interactive)
python manage.py createsuperuser

# Or use the auto-created admin from .env
# Username: SUPERADMIN-0001
# Password: ChangeMe123!

# Collect static files
python manage.py collectstatic --noinput

# Expected output:
# Collected static files (xxx files, xxx directories).
```

### Step 3: Frontend Setup

```powershell
# Navigate to frontend directory (from root)
cd ..\lkSystemFrontEnd

# Install Node.js dependencies
npm install

# Verify installation
npm list --depth=0
```

#### 3.1 Create Frontend `.env` File

```powershell
# Create .env file
New-Item -Path ".env.local" -ItemType File -Force
```

**Content for `.env.local`:**

```
# Backend API Configuration
VITE_API_BASE_URL=http://localhost:8000/api/v1
VITE_API_TIMEOUT=30000

# App Configuration
VITE_APP_TITLE=LkSystem ERP
VITE_APP_ENVIRONMENT=development

# Feature Flags
VITE_ENABLE_ANALYTICS=false
VITE_ENABLE_NOTIFICATIONS=true
```

---

## Running the Application

### Local Development (Without Docker)

#### Terminal 1: PostgreSQL & Redis

```powershell
# Option A: Using services (if installed as Windows services)
# PostgreSQL and Redis should auto-start

# Option B: Manual startup
# Terminal 1A:
postgres -D "C:\Program Files\PostgreSQL\15\data"

# Terminal 1B:
redis-server.exe
```

#### Terminal 2: Django Backend

```powershell
cd C:\Users\saker\Desktop\StagePfe\LkSystemBackEnd

# Activate venv
.\venv\Scripts\Activate.ps1

# Run development server
python manage.py runserver 0.0.0.0:8000

# Expected output:
# Starting development server at http://127.0.0.1:8000/
# Quit the server with CONTROL-C.
```

#### Terminal 3: React Frontend

```powershell
cd C:\Users\saker\Desktop\StagePfe\lkSystemFrontEnd

# Start development server
npm run dev

# Expected output:
#   VITE v5.x.x  ready in XXX ms
#   
#   ➜  Local:   http://localhost:5173/
#   ➜  Press h + enter to show help
```

#### Terminal 4: Celery (Optional - Background Tasks)

```powershell
cd C:\Users\saker\Desktop\StagePfe\LkSystemBackEnd

# Activate venv
.\venv\Scripts\Activate.ps1

# Start Celery worker
celery -A core worker -l info

# Expected output:
# celery@hostname ready.
```

### Access the Application

| Service      | URL                            | Purpose              |
|--------------|--------------------------------|----------------------|
| Frontend     | http://localhost:5173          | React application    |
| Backend API  | http://localhost:8000/api/v1   | REST API endpoints   |
| API Docs     | http://localhost:8000/api/docs | Swagger documentation|
| Django Admin | http://localhost:8000/admin    | Django admin panel   |
| pgAdmin      | http://localhost:5050          | PostgreSQL GUI       |

**Default Credentials** (from `.env`):
- **Admin Matricule**: `SUPERADMIN-0001`
- **Admin Password**: `ChangeMe123!`

---

## Docker Setup

### Step 1: Install Docker Desktop

1. Download [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop)
2. Install and restart your computer
3. Verify installation:

```powershell
docker --version
docker-compose --version
```

### Step 2: Prepare Docker Environment

```powershell
# Navigate to project root
cd C:\Users\saker\Desktop\StagePfe\LkSystemBackEnd

# Create .env file (same as local setup)
New-Item -Path ".env" -ItemType File -Force

# Copy content from Step 2.4 above, but change:
DEBUG=False
POSTGRES_HOST=db
POSTGRES_PORT=5432
REDIS_URL=redis://redis:6379/0
CELERY_BROKER_URL=redis://redis:6379/1
```

### Step 3: Run Docker Compose

```powershell
# From LkSystemBackEnd directory

# Build and start all services
docker-compose up -d

# Or with live logs
docker-compose up

# Expected services:
# - PostgreSQL (port 5433)
# - Redis (port 6379)
# - Django Backend (port 8000)
```

### Step 4: Docker Service Management

```powershell
# View running containers
docker-compose ps

# View logs
docker-compose logs -f web

# Restart a service
docker-compose restart web

# Stop all services
docker-compose down

# Stop and remove volumes (WARNING: DELETES DATA)
docker-compose down -v

# Execute command in container
docker-compose exec web python manage.py migrate

# Create superuser in container
docker-compose exec web python manage.py createsuperuser
```

---

## Environment Configuration

### Backend Environment Variables

**Required Variables:**

```
SECRET_KEY              # Django secret key (50+ chars)
DEBUG                   # True/False
ALLOWED_HOSTS          # Comma-separated domains
POSTGRES_*             # Database credentials
REDIS_URL              # Redis connection
JWT_SECRET_KEY         # JWT signing key
```

**Optional Variables:**

```
CELERY_BROKER_URL      # For background tasks
CELERY_RESULT_BACKEND  # For task results
EMAIL_*                # Email configuration
WOOCOMMERCE_*          # WooCommerce API
LOG_LEVEL              # INFO/DEBUG/WARNING/ERROR
```

### Frontend Environment Variables

```
VITE_API_BASE_URL      # Backend API URL
VITE_API_TIMEOUT       # Request timeout (ms)
VITE_APP_TITLE         # Application title
VITE_APP_ENVIRONMENT   # development/production
VITE_ENABLE_ANALYTICS  # Enable analytics
VITE_ENABLE_NOTIFICATIONS  # Enable notifications
```

---

## Verification & Testing

### Backend Health Check

```powershell
# Test API is running
curl http://localhost:8000/api/v1/

# Get JWT Token
curl -X POST http://localhost:8000/api/v1/auth/login/ `
  -H "Content-Type: application/json" `
  -d '{"matricule":"SUPERADMIN-0001","password":"ChangeMe123!"}'

# Expected response:
# {
#   "access": "eyJ0eXAiOiJKV1QiLC...",
#   "refresh": "eyJ0eXAiOiJKV1QiLC..."
# }

# Test authenticated endpoint (replace TOKEN with actual token)
curl -H "Authorization: Bearer TOKEN" `
  http://localhost:8000/api/v1/users/

# API Documentation
# http://localhost:8000/api/docs/
```

### Database Verification

```powershell
# Connect to database
psql -U lksystem_user -d lksystem -h localhost

# List tables
\dt

# Check user count
SELECT COUNT(*) FROM users_user;

# Exit
\q
```

### Redis Verification

```powershell
# Test Redis connection
redis-cli ping
# Expected: PONG

# Check Redis info
redis-cli info server

# View all keys
redis-cli KEYS "*"
```

### Frontend Health Check

```powershell
# Navigate to http://localhost:5173
# You should see the React application loaded

# Open browser console (F12) and check for:
# ✅ No CORS errors
# ✅ API calls to http://localhost:8000 succeed
# ✅ Authentication token is stored in localStorage
```

---

## Project Structure Overview

### Backend Architecture

```
LkSystemBackEnd/
├── core/                           # Django Core Configuration
│   ├── settings.py                 # Settings (DATABASE, INSTALLED_APPS, etc.)
│   ├── urls.py                     # URL routing
│   ├── asgi.py                     # WebSocket support
│   ├── wsgi.py                     # WSGI application
│   ├── celery.py                   # Celery configuration
│   ├── services/                   # Centralized services
│   │   ├── base.py                 # BaseWooCommerceService[T]
│   │   └── exceptions.py           # Custom exceptions
│   └── webhooks/                   # Webhook system
│       ├── registry.py             # Webhook registration
│       ├── validators.py           # HMAC validation
│       └── dispatcher.py           # Webhook dispatching
│
├── apps/                           # Micro-app architecture
│   ├── users/                      # User & RBAC management
│   ├── company/                    # Company management
│   ├── brands/                     # Brand management
│   ├── sales_channels/             # Sales channel management
│   ├── categories/                 # WooCommerce categories
│   ├── products/                   # WooCommerce products
│   ├── inventory/                  # Inventory management
│   ├── orders/                     # Order management
│   ├── clients/                    # Client management
│   ├── promotions/                 # Promotions engine
│   └── rbac/                       # Role-based access control
│
├── manage.py                       # Django management script
├── requirements.txt                # Python dependencies
├── docker-compose.yml              # Docker configuration
├── Dockerfile                      # Docker build instructions
└── entrypoint.sh                   # Docker entrypoint
```

### Frontend Architecture

```
lkSystemFrontEnd/
├── src/
│   ├── main.tsx                    # Entry point
│   ├── app/                        # Root layout
│   ├── components/                 # Reusable components
│   ├── pages/                      # Page components
│   ├── services/                   # API services
│   ├── hooks/                      # Custom hooks
│   ├── contexts/                   # React contexts
│   ├── store/                      # State management
│   ├── lib/                        # Utilities & helpers
│   ├── types/                      # TypeScript types
│   └── styles/                     # Global styles
│
├── package.json                    # Dependencies & scripts
├── vite.config.ts                  # Vite configuration
├── tsconfig.json                   # TypeScript configuration
└── index.html                      # HTML entry point
```

---

## Common Commands

### Backend Commands

```powershell
# Run migrations
python manage.py migrate

# Create new migration
python manage.py makemigrations app_name

# Create superuser
python manage.py createsuperuser

# Run tests
python manage.py test

# Collect static files
python manage.py collectstatic --noinput

# Database shell
python manage.py dbshell

# Python shell
python manage.py shell

# List all URL patterns
python manage.py show_urls
```

### Frontend Commands

```powershell
# Install dependencies
npm install

# Development server
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview

# Run type checking
npm run type-check

# Lint code
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format:all

# Analyze bundle size
npm run build:analyze
```

### Docker Commands

```powershell
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f [service_name]

# Stop all services
docker-compose down

# Rebuild images
docker-compose build --no-cache

# Execute command in container
docker-compose exec web [command]

# Remove all containers and volumes
docker-compose down -v
```

---

## Troubleshooting

### Backend Issues

#### "ModuleNotFoundError: No module named 'xxx'"

```powershell
# Activate venv and reinstall requirements
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt --force-reinstall
```

#### "django.db.utils.OperationalError: could not connect to server"

```powershell
# PostgreSQL is not running. Check:
# 1. PostgreSQL service status
net start postgresql-x64-15

# 2. Test connection
psql -U postgres

# 3. Check POSTGRES_HOST and POSTGRES_PORT in .env
```

#### "redis.ConnectionError: Error 111 connecting to localhost:6379"

```powershell
# Redis is not running. Start it:
redis-server.exe

# Or test connection:
redis-cli ping
# Should return: PONG
```

#### "SECRET_KEY must be specified"

```powershell
# .env file is missing or incorrect
# Make sure .env exists in LkSystemBackEnd directory
# Check SECRET_KEY is defined
```

### Frontend Issues

#### "CORS error when calling backend API"

```powershell
# 1. Check CORS_ALLOWED_ORIGINS in backend .env
# 2. Ensure frontend URL is in the list (http://localhost:5173)
# 3. Restart backend: Ctrl+C and python manage.py runserver

# Add to .env:
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
```

#### "API calls return 401 Unauthorized"

```powershell
# 1. Clear browser localStorage: F12 → Application → Storage → Clear All
# 2. Login again at http://localhost:5173
# 3. Check token is stored: F12 → Application → Local Storage → look for 'token'
```

#### "npm: command not found"

```powershell
# Node.js is not installed or not in PATH
# 1. Install Node.js from nodejs.org
# 2. Restart PowerShell
# 3. Verify: node --version
```

### Docker Issues

#### "docker: command not found"

```powershell
# Docker Desktop is not installed or not running
# 1. Download Docker Desktop from docker.com
# 2. Install and restart computer
# 3. Start Docker Desktop application
```

#### "Unexpected end of JSON input error" when building

```powershell
# Clear Docker cache and rebuild
docker system prune -a
docker-compose build --no-cache
```

#### "Port already in use"

```powershell
# Find process using port and kill it
# For port 8000:
netstat -ano | findstr :8000

# Kill process (replace PID with actual ID)
taskkill /PID PID /F

# Or change port in docker-compose.yml:
# ports:
#   - "8001:8000"  # Use 8001 instead
```

---

## Performance Optimization

### Backend

```python
# settings.py optimizations:
DATABASES = {
    'default': {
        'CONN_MAX_AGE': 600,  # Connection pooling
        'ATOMIC_REQUESTS': True,
    }
}

# Use select_related() for foreign keys
# Use prefetch_related() for reverse relations
# Use only() and defer() to limit fields
queryset = Model.objects.select_related('fk_field').only('id', 'name')
```

### Frontend

```powershell
# Check bundle size
npm run build:analyze

# Lazy load routes
# Use React.lazy() for code splitting
# Use React Query caching
# Enable production mode: npm run build
```

---

## Security Best Practices

### 1. Environment Variables

- ✅ **DO**: Use `.env` files with strong keys
- ❌ **DON'T**: Commit `.env` to git
- ✅ **DO**: Use environment-specific .env files

### 2. Database

- ✅ **DO**: Use strong passwords (20+ chars)
- ✅ **DO**: Restrict database networks
- ❌ **DON'T**: Use default credentials in production

### 3. JWT Tokens

- ✅ **DO**: Use HTTPS in production
- ✅ **DO**: Set short expiration times (60 min)
- ✅ **DO**: Use secure refresh token rotation

### 4. CORS

- ✅ **DO**: Whitelist specific origins
- ❌ **DON'T**: Allow all origins (`*`)
- ✅ **DO**: Disable in production debugging

### 5. Production Settings

```python
# settings.py for production
DEBUG = False
ALLOWED_HOSTS = ['yourdomain.com', 'www.yourdomain.com']
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
```

---

## Deployment Guide (Quick Reference)

### Production Checklist

- [ ] Set `DEBUG=False` in `.env`
- [ ] Generate strong `SECRET_KEY`
- [ ] Update `ALLOWED_HOSTS`
- [ ] Configure PostgreSQL with backups
- [ ] Set up Redis with persistence
- [ ] Enable HTTPS/SSL
- [ ] Configure email service
- [ ] Set up logging & monitoring
- [ ] Run Django security check: `python manage.py check --deploy`
- [ ] Collect static files: `python manage.py collectstatic`
- [ ] Use Gunicorn + Nginx in production

### Production Docker Commands

```powershell
# Use production compose file
docker-compose -f docker-compose.fullstack.yml up -d

# View logs
docker-compose logs -f

# Backup database
docker-compose exec db pg_dump -U lksystem_user lksystem > backup.sql

# Restore database
docker-compose exec -T db psql -U lksystem_user lksystem < backup.sql
```

---

## Additional Resources

| Resource                 | Link                              | Purpose                |
|--------------------------|-----------------------------------|------------------------|
| Django Docs              | https://docs.djangoproject.com    | Framework documentation|
| DRF Docs                 | https://www.django-rest-framework.org | API framework docs    |
| React Docs               | https://react.dev                 | React documentation    |
| Vite Docs                | https://vitejs.dev                | Build tool docs        |
| PostgreSQL Docs          | https://www.postgresql.org/docs   | Database docs          |
| Docker Docs              | https://docs.docker.com           | Container documentation|

---

## Support & Contact

For issues or questions:
1. Check [Troubleshooting](#troubleshooting) section
2. Review error logs: `docker-compose logs [service]`
3. Check `.env` configuration
4. Verify all services are running
5. Review Django debug messages at `http://localhost:8000`

---

## Version Information

- **Django**: 5.0+
- **Django REST Framework**: 3.14+
- **Python**: 3.10+
- **Node.js**: 18+
- **React**: 19
- **PostgreSQL**: 15
- **Redis**: 7
- **Docker**: 20.10+

---

**Last Updated**: March 30, 2026  
**Status**: Production Ready ✅

---

# Quick Start Summary

## 🚀 TL;DR - Get Running in 10 Minutes

### Local (Without Docker)

```powershell
# 1. Backend setup
cd LkSystemBackEnd
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

# 2. Create .env (see template above)

# 3. Database
python manage.py migrate

# 4. Start server
python manage.py runserver

# 5. Frontend (separate terminal)
cd lkSystemFrontEnd
npm install
npm run dev

# 6. Access at http://localhost:5173
```

### Docker

```powershell
# 1. Create .env in LkSystemBackEnd

# 2. Start
docker-compose up -d

# 3. Access at http://localhost:8000
```

---

**Questions? Check Troubleshooting section above! ⬆️**
