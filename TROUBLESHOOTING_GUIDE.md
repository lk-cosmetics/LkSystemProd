# LkSystem - Advanced Troubleshooting Guide 🔧

Comprehensive troubleshooting for common and advanced issues.

---

## 📋 Table of Contents

1. [Installation Issues](#installation-issues)
2. [Backend Issues](#backend-issues)
3. [Frontend Issues](#frontend-issues)
4. [Database Issues](#database-issues)
5. [Docker Issues](#docker-issues)
6. [Performance Issues](#performance-issues)
7. [Security Issues](#security-issues)

---

## Installation Issues

### "python: command not found"

**Problem**: Python is not installed or not in PATH.

**Solutions**:

```powershell
# 1. Check Python installation
python --version

# 2. If not found, install from python.org
# Or use Windows installer

# 3. Add Python to PATH (Windows)
# Control Panel → System → Environment Variables
# Add C:\Users\Username\AppData\Local\Programs\Python\Python312

# 4. Verify PATH
$env:Path -split ';' | findstr Python

# 5. Restart PowerShell after installation
```

### "node: command not found"

**Problem**: Node.js is not installed or not in PATH.

**Solutions**:

```powershell
# 1. Check Node installation
node --version

# 2. Install from nodejs.org

# 3. Verify installation
npm --version

# 4. If still not found, add to PATH:
# Control Panel → System → Environment Variables
# Add C:\Program Files\nodejs

# 5. Close and reopen PowerShell
```

### "pip: command not found or not recognized"

**Problem**: venv is not activated or pip is not available.

**Solutions**:

```powershell
# 1. Ensure venv is created
python -m venv venv

# 2. Activate venv
.\venv\Scripts\Activate.ps1

# 3. Verify pip is available
python -m pip --version

# 4. If venv activation fails, check execution policy
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# 5. Use alternative activation
.\venv\Scripts\activate.bat  # Using CMD instead

# 6. Use python -m pip instead of pip directly
python -m pip install -r requirements.txt
```

---

## Backend Issues

### "ModuleNotFoundError: No module named 'django'"

**Problem**: Django not installed or venv not activated.

**Solutions**:

```powershell
# 1. Ensure venv is activated
.\venv\Scripts\Activate.ps1

# 2. Verify (venv) prefix in terminal

# 3. Install requirements
pip install -r requirements.txt

# 4. Verify installation
python -c "import django; print(django.VERSION)"

# 5. If still failing, reinstall
pip install --force-reinstall -r requirements.txt
```

### "django.db.utils.OperationalError: could not connect to server"

**Problem**: PostgreSQL is not running or connection credentials are wrong.

**Solutions**:

```powershell
# 1. Check if PostgreSQL is running
pg_isready -h localhost -p 5432

# 2. Start PostgreSQL service
# Option A: Windows Service
net start postgresql-x64-15

# Option B: Docker
docker-compose up -d db

# Option C: Manual startup
postgres -D "C:\Program Files\PostgreSQL\15\data"

# 3. Check .env credentials
cat .env | findstr POSTGRES_

# 4. Verify database exists
psql -U lksystem_user -d lksystem -h localhost

# 5. Create database if missing
psql -U postgres -h localhost

# In psql prompt:
CREATE DATABASE lksystem OWNER lksystem_user;

# 6. Test connection
python manage.py dbshell
```

### "ERROR: Could not find a version that satisfies the requirement"

**Problem**: Package version doesn't exist or PyPI is down.

**Solutions**:

```powershell
# 1. Check available versions
pip index versions django

# 2. Install compatible version
pip install django==5.0

# 3. Use more flexible version constraints
pip install "django>=4.2,<6.0"

# 4. Clear pip cache
pip cache purge

# 5. Use specific PyPI mirror
pip install -i https://pypi.org/simple/ -r requirements.txt

# 6. Install from requirements with specific index
pip install -r requirements.txt --index-url https://pypi.org/simple/
```

### "SECRET_KEY must be specified"

**Problem**: .env file is missing or not loaded.

**Solutions**:

```powershell
# 1. Check .env file exists in LkSystemBackEnd
ls -la .env

# 2. Check .env is in correct directory
pwd  # Should be LkSystemBackEnd directory

# 3. Verify .env has SECRET_KEY
cat .env | findstr SECRET_KEY

# 4. Check DJANGO_SETTINGS_MODULE
python -c "import os; print(os.getenv('DJANGO_SETTINGS_MODULE'))"

# 5. Reload environment
# Exit Python shell, deactivate and reactivate venv
deactivate
.\venv\Scripts\Activate.ps1

# 6. Verify environment variables are loaded
python -c "from decouple import config; print(config('SECRET_KEY'))"
```

### "No migrations detected. Did you create a migration?"

**Problem**: makemigrations wasn't run after model changes.

**Solutions**:

```powershell
# 1. Create migrations
python manage.py makemigrations

# 2. Check migration files were created
ls apps/users/migrations/

# 3. Review migration file
type apps/users/migrations/000X_auto_*.py

# 4. Apply migrations
python manage.py migrate

# 5. If specific app migrations missing
python manage.py makemigrations users  # for users app

# 6. Check migration status
python manage.py showmigrations
```

### "RuntimeError: The connection did not use SSL, all queries to localhost..."

**Problem**: SSL required but not configured in development.

**Solutions**:

```powershell
# 1. In .env for development
DEBUG=True

# 2. In settings.py, add:
if not DEBUG:
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

# 3. For development, ensure
# settings.py has:
SECURE_SSL_REDIRECT = False
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False

# 4. Verify in Django shell
python manage.py shell
from django.conf import settings
print(f"DEBUG: {settings.DEBUG}")
print(f"SECURE_SSL_REDIRECT: {settings.SECURE_SSL_REDIRECT}")
```

### "Port 8000 is already in use"

**Problem**: Another process is using port 8000.

**Solutions**:

```powershell
# 1. Find process using port
netstat -ano | findstr :8000

# 2. Kill the process (replace PID)
taskkill /PID 12345 /F

# 3. Use different port
python manage.py runserver 0.0.0.0:8080

# 4. Check if stale Django process
Get-Process python | Stop-Process -Force

# 5. Restart Windows networking
ipconfig /release
ipconfig /renew
```

---

## Frontend Issues

### "npm: command not found"

**See**: [Installation Issues - Node](#node-command-not-found)

### "CORS error: Access-Control-Allow-Origin"

**Problem**: Frontend can't access backend API due to CORS restrictions.

**Solutions**:

```powershell
# 1. Check backend .env
cat .env | findstr CORS

# 2. Update CORS_ALLOWED_ORIGINS in .env
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173

# 3. Restart backend
# Ctrl+C and rerun: python manage.py runserver

# 4. Check Django CORS middleware is installed
python -c "import corsheaders; print(corsheaders.__version__)"

# 5. Verify CORS is in INSTALLED_APPS
python manage.py shell
from django.conf import settings
print('corsheaders' in settings.INSTALLED_APPS)

# 6. Browser console check (F12)
# Network tab → XHR requests
# Look for: Access-Control-Allow-Origin header
```

### "API returns 401 Unauthorized"

**Problem**: JWT token is missing, invalid, or expired.

**Solutions**:

```powershell
# 1. Clear browser storage
# F12 → Application → Storage → Clear All

# 2. Login again at frontend (http://localhost:5173)

# 3. Check token is stored
# F12 → Application → Local Storage
# Look for: 'token' or 'access' key

# 4. Verify token format in request
# F12 → Network → Select API request
# Headers tab → Look for: Authorization: Bearer TOKEN

# 5. Check token expiration
# In browser console:
# localStorage.getItem('token')
# If missing, login again at http://localhost:5173

# 6. Refresh token if expired
# POST to http://localhost:8000/api/v1/auth/refresh/
# with refresh token from localStorage

# 7. Check backend JWT settings
cat .env | findstr JWT
```

### "Cannot find module '@/...' or similar"

**Problem**: TypeScript path aliases are not configured.

**Solutions**:

```powershell
# 1. Check tsconfig.json exists
cat tsconfig.json | findstr baseUrl

# 2. Check vite.config.ts has alias
cat vite.config.ts | findstr "@"

# 3. Example fix in vite.config.ts:
# resolve: {
#   alias: {
#     '@': fileURLToPath(new URL('./src', import.meta.url)),
#   },
# },

# 4. Restart dev server
# Ctrl+C and rerun: npm run dev

# 5. Clear node_modules and reinstall
rm -Recurse -Force node_modules
npm install
npm run dev
```

### "Node version too old"

**Problem**: Node.js version is below 18.x requirement.

**Solutions**:

```powershell
# 1. Check Node version
node --version

# 2. Upgrade Node.js
# Download latest from nodejs.org

# 3. Or use nvm (Node Version Manager)
# Windows: https://github.com/coreybutler/nvm-windows
nvm install 20.11.0
nvm use 20.11.0

# 4. Verify
node --version  # Should be 20.11.0+
npm --version   # Should be 10.2.0+
```

### "npm install fails with peer dependencies"

**Problem**: Conflicting package versions.

**Solutions**:

```powershell
# 1. Force override peer dependencies
npm install --legacy-peer-deps

# 2. Check package-lock.json
rm package-lock.json
npm install

# 3. Update npm itself
npm install -g npm@latest

# 4. Clean npm cache
npm cache clean --force
npm install

# 5. Use npm ci (clean install)
rm -Recurse -Force node_modules, package-lock.json
npm ci
```

---

## Database Issues

### "FATAL: password authentication failed for user 'lksystem_user'"

**Problem**: PostgreSQL password is incorrect.

**Solutions**:

```powershell
# 1. Verify password in .env
cat .env | findstr POSTGRES_PASSWORD

# 2. Connect as postgres (admin)
psql -U postgres

# 3. Change user password
# In psql:
ALTER USER lksystem_user WITH PASSWORD 'lksystem_password';

# 4. Verify connection
psql -U lksystem_user -d lksystem -h localhost -W
# (Enter password when prompted)

# 5. Update .env with new password
# POSTGRES_PASSWORD=new_password_here

# 6. Restart backend
python manage.py migrate
```

### "FATAL: database 'lksystem' does not exist"

**Problem**: Database was not created.

**Solutions**:

```powershell
# 1. List existing databases
psql -U postgres -l

# 2. Create database
psql -U postgres

# In psql:
CREATE DATABASE lksystem OWNER lksystem_user;

# 3. Grant privileges
GRANT ALL PRIVILEGES ON DATABASE lksystem TO lksystem_user;

# 4. Verify creation
\l

# 5. Migrate data
python manage.py migrate

# 6. Test connection
python manage.py dbshell
```

### "column 'xxx' does not exist"

**Problem**: Database schema is out of sync with models.

**Solutions**:

```powershell
# 1. Check migration status
python manage.py showmigrations

# 2. Check unmigrated changes
python manage.py makemigrations --dry-run

# 3. Create and apply new migrations
python manage.py makemigrations
python manage.py migrate

# 4. If migration is corrupted, rollback and reapply
python manage.py migrate app_name 0001  # Go back to migration
python manage.py migrate app_name       # Reapply all

# 5. Check database directly
python manage.py dbshell
# \d users_user (shows table structure)
# \dt (lists all tables)
```

### "Unique constraint violation"

**Problem**: Attempting to insert duplicate data.

**Solutions**:

```powershell
# 1. Check unique constraints
python manage.py dbshell
# \d users_user

# 2. Find duplicate data
SELECT email, COUNT(*) FROM users_user GROUP BY email HAVING COUNT(*) > 1;

# 3. Delete duplicates (be careful!)
DELETE FROM users_user 
WHERE id NOT IN (
  SELECT MIN(id) FROM users_user 
  GROUP BY email
);

# 4. In Django admin, ensure unique_together is set
# models.py:
class User(models.Model):
    email = models.EmailField(unique=True)
    
    class Meta:
        unique_together = (('email', 'company'),)

# 5. Create migration
python manage.py makemigrations
python manage.py migrate
```

### "Database is locked" (SQLite only)

**Solutions**:

```powershell
# 1. Stop all Django processes
Get-Process python | Stop-Process -Force

# 2. Remove -wal and -shm files
rm db.sqlite3-wal, db.sqlite3-shm

# 3. Restart Django
python manage.py runserver
```

---

## Docker Issues

### "docker: command not found"

**Problem**: Docker is not installed or not in PATH.

**Solutions**:

```powershell
# 1. Install Docker Desktop
# Download from https://www.docker.com/products/docker-desktop

# 2. Add to PATH
# Control Panel → System → Environment Variables
# Add C:\Program Files\Docker\Docker\resources\bin

# 3. Start Docker Desktop application
# Wait for "Docker Engine running" notification

# 4. Verify in new PowerShell window
docker --version
docker-compose --version
```

### "Cannot connect to Docker daemon"

**Problem**: Docker Desktop is not running.

**Solutions**:

```powershell
# 1. Start Docker Desktop application
# Click Docker icon in system tray

# 2. Wait for engine to initialize (may take 30s)

# 3. Check status
docker info

# 4. If still failing, restart Docker
# System Tray → Docker → Settings → Reset

# 5. Restart Windows if needed
```

### "docker-compose: command not found"

**Problem**: docker-compose is not installed.

**Solutions**:

```powershell
# 1. Docker Desktop includes docker-compose
# Ensure Docker Desktop is fully installed

# 2. Use modern syntax (docker compose instead of docker-compose)
docker compose up -d

# 3. If using old format, install manually
pip install docker-compose

# 4. Verify installation
docker compose --version
```

### "ERROR: network mynet could not be found"

**Problem**: Docker network was deleted or wasn't created.

**Solutions**:

```powershell
# 1. List networks
docker network ls

# 2. Create custom network
docker network create lksystem_network

# 3. In docker-compose.yml, specify
networks:
  default:
    name: lksystem_network
    driver: bridge

# 4. Recreate containers
docker-compose down
docker-compose up -d
```

### "Port is already allocated"

**Problem**: Another Docker container is using the port.

**Solutions**:

```powershell
# 1. List running containers
docker-compose ps

# 2. Stop conflicting container
docker-compose stop web

# 3. Check port usage
netstat -ano | findstr :8000

# 4. Kill process
taskkill /PID 12345 /F

# 5. Change port in docker-compose.yml
# ports:
#   - "8001:8000"  # Use 8001 instead

# 6. Restart
docker-compose restart web
```

### "denied: requested access to the resource is denied"

**Problem**: Docker image pull requires authentication.

**Solutions**:

```powershell
# 1. Login to Docker Hub
docker login
# Enter username and password

# 2. For private registries
docker login myregistry.com

# 3. If token expired, re-login
docker logout
docker login

# 4. Rebuild image (uses cached layers)
docker-compose build --no-cache
```

### "Disk space is full"

**Problem**: Docker images/containers are consuming too much space.

**Solutions**:

```powershell
# 1. Check disk usage
docker system df

# 2. Remove unused containers
docker container prune

# 3. Remove unused images
docker image prune -a

# 4. Remove unused volumes
docker volume prune

# 5. Full cleanup (remove everything unused)
docker system prune --volumes -a

# 6. Check disk space
Get-PSDrive

# 7. If still full, remove old backups
rm -Recurse -Force *.sql.backup
rm -Recurse -Force *.tar.gz
```

---

## Performance Issues

### "Backend is slow to respond"

**Problem**: High response times from Django API.

**Solutions**:

```powershell
# 1. Enable Django Debug Toolbar
pip install django-debug-toolbar

# 2. Check database queries
python manage.py shell
from django.test.utils import CaptureQueriesContext
from django.db import connection

with CaptureQueriesContext(connection) as context:
    # Your code here
    pass
print(f"Total queries: {len(context)}")
for query in context:
    print(query)

# 3. Optimize querysets
# Use select_related() for foreign keys
# Use prefetch_related() for reverse relations
# Use only() and defer() to limit fields

users = User.objects.select_related('company').only('id', 'email', 'company__id')

# 4. Add database indexes
class User(models.Model):
    email = models.EmailField(db_index=True)
    created_at = models.DateTimeField(db_index=True)

# 5. Increase Gunicorn workers
gunicorn core.wsgi:application \
  --workers 4 \
  --timeout 180 \
  --bind 0.0.0.0:8000

# 6. Enable caching
CACHES = {
    'default': {
        'BACKEND': 'django_redis.cache.RedisCache',
        'LOCATION': 'redis://redis:6379/0',
    }
}

# 7. Monitor Redis
redis-cli INFO stats
```

### "Frontend is slow to load"

**Problem**: Long initial page load time.

**Solutions**:

```powershell
# 1. Analyze bundle size
npm run build:analyze

# 2. Use code splitting
const Home = React.lazy(() => import('./pages/Home'))

# 3. Optimize images
# Use WebP format
# Compress images
# Use lazy loading

# 4. Enable efficient caching
# In nginx.conf or vite.config.ts

# 5. Minify and compress
npm run build

# 6. Check network tab (F12)
# Look for large files or slow requests

# 7. Profile with React DevTools
# https://react.dev/learn/react-developer-tools
```

### "Database is slow"

**Problem**: Slow database queries.

**Solutions**:

```powershell
# 1. Enable query logging
# In settings.py:
LOGGING = {
    'loggers': {
        'django.db.backends': {
            'level': 'DEBUG',
        },
    },
}

# 2. Analyze slow queries
psql -U lksystem_user -d lksystem
# \timing  # Enable timing
# SELECT * FROM users_user;  # See execution time

# 3. Explain query plan
EXPLAIN ANALYZE SELECT * FROM users_user WHERE email = 'test@example.com';

# 4. Add indexes
CREATE INDEX idx_user_email ON users_user(email);

# 5. Vacuum and analyze
VACUUM ANALYZE;

# 6. Check table size
SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) 
FROM pg_tables 
WHERE schemaname != 'pg_catalog' 
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

# 7. Monitor PostgreSQL
psql -U lksystem_user -d lksystem
# SELECT datname, numbackends FROM pg_stat_database;
```

---

## Security Issues

### "DEBUG=True in production"

**Problem**: Security risk exposing sensitive information.

**Solutions**:

```powershell
# 1. Set DEBUG=False in .env
DEBUG=False

# 2. Run security check
python manage.py check --deploy

# 3. Fix reported issues
# Report example:
# W005 (DEBUG=False): Disable if possible
# W008 (SECRET_KEY_FALLBACK): No fallback SECRET_KEY

# 4. Update settings
SECRET_KEY = config('SECRET_KEY')  # Must be in .env

ALLOWED_HOSTS = config('ALLOWED_HOSTS', cast=Csv())

SECURE_SSL_REDIRECT = not DEBUG
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
```

### "SECRET_KEY is weak or exposed"

**Problem**: SECRET_KEY is too short or committed to git.

**Solutions**:

```powershell
# 1. Generate strong SECRET_KEY
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"

# 2. Update .env
SECRET_KEY=<generated-key>

# 3. Remove from git history (if accidentally committed)
git filter-branch --tree-filter 'rm -f .env' HEAD

# 4. Rotate SECRET_KEY after exposing
# Update .env
# All sessions will be invalidated
# Users must login again
```

### "SQL Injection vulnerability"

**Problem**: User input in raw SQL queries.

**Solutions**:

```python
# ❌ WRONG - Vulnerable to SQL injection
user = User.objects.raw(f"SELECT * FROM users_user WHERE email = '{email}'")

# ✅ CORRECT - Parameterized queries
user = User.objects.filter(email=email)

# If you must use raw SQL:
users = User.objects.raw(
    'SELECT * FROM users_user WHERE email = %s',
    [email]
)
```

### "CORS allows all origins (*)"

**Problem**: Security risk allowing any origin.

**Solutions**:

```powershell
# 1. Whitelist specific origins in .env
CORS_ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# Never use:
# CORS_ALLOWED_ORIGINS=*

# 2. In settings.py
CORS_ALLOWED_ORIGINS = [
    'https://yourdomain.com',
    'https://www.yourdomain.com',
]

# 3. Add CORS headers
# 'corsheaders' must be in INSTALLED_APPS
# 'corsheaders.middleware.CorsMiddleware' must be in MIDDLEWARE
```

---

## Performance Profiling Commands

```powershell
# Django shell with timing
python manage.py shell

# Profile a view
from django.test import Client
import timeit

client = Client()
time = timeit.timeit(
    lambda: client.get('/api/v1/users/'),
    number=10
)
print(f"Average time: {time/10}s")

# Memory profiling
pip install memory-profiler

# Test specific function
python -m memory_profiler script.py
```

---

## Emergency Recovery

### Complete Reset (WARNING: DATA LOSS)

```powershell
# 1. Stop all services
docker-compose down -v

# 2. Remove all data
rm -Recurse -Force LkSystemBackEnd/venv
rm -Recurse -Force LkSystemBackEnd/mediafiles
rm -Recurse -Force LkSystemBackEnd/staticfiles
rm -Recurse -Force lkSystemFrontEnd/node_modules

# 3. Reinstall
python .\setup.py

# 4. Reinitialize
docker-compose up -d
docker-compose exec web python manage.py migrate
```

### Restore from Backup

```powershell
# 1. Restore database
docker-compose exec -T db psql -U lksystem_user lksystem < backup.sql

# 2. Verify restoration
docker-compose exec web python manage.py dbshell

# 3. Collect static files
docker-compose exec web python manage.py collectstatic --noinput

# 4. Check logs
docker-compose logs -f web
```

---

## When All Else Fails

1. **Check the logs**: `docker-compose logs -f` or `python manage.py runserver` output
2. **Read the error message carefully**: Most errors have clear messages
3. **Search online**: Most issues have been solved before
4. **Create minimal reproduction**: Isolate the problem
5. **Ask for help**: Share logs, .env (without secrets), and error messages

---

**Remember**: Most issues are solved by:
1. Checking `.env` file
2. Restarting services
3. Clearing caches
4. Checking logs
5. Searching documentation

---

**Last Updated**: March 30, 2026

