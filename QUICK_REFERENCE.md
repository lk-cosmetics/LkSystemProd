# LkSystem - Quick Reference Guide ⚡

Quick commands and workflows for development, Docker, and troubleshooting.

---

## 🚀 Quick Start

### Use Setup Script (Easiest)

```powershell
# Windows PowerShell
.\setup.ps1

# Python (any OS)
python setup.py
```

### Manual Quick Start

```powershell
# Backend
cd LkSystemBackEnd
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver

# Frontend (separate terminal)
cd lkSystemFrontEnd
npm install
npm run dev

# Access: http://localhost:5173
```

---

## 📋 Backend Commands

### Virtual Environment

```powershell
# Create & activate
python -m venv venv
.\venv\Scripts\Activate.ps1

# Deactivate
deactivate

# Verify activation
python -c "import sys; print(sys.executable)"
# Should show: .../venv/Scripts/python.exe
```

### Dependency Management

```powershell
# Install all dependencies
pip install -r requirements.txt

# Install single package
pip install django-cors-headers

# Upgrade pip
python -m pip install --upgrade pip

# Check for outdated packages
pip list --outdated

# Export current packages
pip freeze > requirements.txt
```

### Database Operations

```powershell
# Create migrations from model changes
python manage.py makemigrations

# Apply migrations
python manage.py migrate

# Show migration history
python manage.py showmigrations

# Rollback to previous migration
python manage.py migrate app_name 0001

# Database shell
python manage.py dbshell

# Check database connections
python manage.py check --database default
```

### User & Admin

```powershell
# Create superuser
python manage.py createsuperuser

# Change password
python manage.py changepassword username

# Create test data
python manage.py shell
# Then:
from apps.users.models import User
User.objects.create_superuser('admin', 'admin@example.com', 'password')
exit()
```

### Server & Development

```powershell
# Development server
python manage.py runserver

# On specific port
python manage.py runserver 0.0.0.0:8080

# Production WSGI server (Gunicorn)
gunicorn core.wsgi:application --bind 0.0.0.0:8000

# Celery worker (background tasks)
celery -A core worker -l info

# Celery beat (scheduled tasks)
celery -A core beat -l info
```

### Static & Media Files

```powershell
# Collect static files (production)
python manage.py collectstatic --noinput

# Collect with cleanup
python manage.py collectstatic --clear --noinput

# Find static files
python manage.py findstatic style.css

# Remove untracked static files
python manage.py cleanstaticfiles
```

### Testing & Debugging

```powershell
# Run tests
python manage.py test

# Run specific test
python manage.py test apps.users.tests.TestUserModel

# Test with coverage
pip install coverage
coverage run --source='.' manage.py test
coverage report

# Check security issues
python manage.py check --deploy

# List all routes
python manage.py show_urls

# Django shell
python manage.py shell
# Then:
from apps.users.models import User
User.objects.count()
exit()
```

### Code Quality

```powershell
# Code style check (if Black installed)
black .

# Import sorting (if isort installed)
isort .

# Find potential issues
pip install flake8
flake8 apps/
```

---

## 🎨 Frontend Commands

### Dependency Management

```powershell
# Install all dependencies
npm install

# Install specific package
npm install react-query

# Save to package.json
npm install --save package-name
npm install --save-dev package-name

# Update specific package
npm update package-name

# List installed packages
npm list
npm list --depth=0  # Top-level only
```

### Development Server

```powershell
# Start dev server with hot reload
npm run dev

# On specific port
npm run dev -- --port 3000

# Build for production
npm run build

# Preview production build locally
npm run preview

# Type checking only
npm run type-check
```

### Code Quality

```powershell
# Lint code
npm run lint

# Fix linting issues
npm run lint:fix

# Format code with Prettier
npm run format:all

# Format check
npm run format:check

# Fix all issues at once
npm run fix-all
```

### Build & Optimization

```powershell
# Build with source maps (development)
npm run build

# Analyze bundle size
npm run build:analyze

# View bundle in interactive explorer
npx vite-bundle-analyzer dist

# Clean build
rm -r dist
npm run build
```

---

## 🐳 Docker Commands

### Docker Compose

```powershell
# Start all services in background
docker-compose up -d

# Start with live logs
docker-compose up

# Stop all services (keep data)
docker-compose stop

# Stop and remove containers
docker-compose down

# Remove containers and volumes (DELETE DATA)
docker-compose down -v

# Restart specific service
docker-compose restart web

# Rebuild images without cache
docker-compose build --no-cache
```

### Docker Logs & Inspection

```powershell
# View logs from all services
docker-compose logs

# Follow logs (live)
docker-compose logs -f

# Logs from specific service
docker-compose logs -f web

# View last 100 lines
docker-compose logs --tail 100 web

# List running containers
docker-compose ps

# Inspect container
docker-compose exec web python manage.py shell
```

### Docker Cleanup

```powershell
# Remove stopped containers
docker container prune

# Remove unused images
docker image prune

# Remove everything (be careful!)
docker system prune -a

# Remove volumes (DELETE DATA)
docker volume prune

# Get disk usage
docker system df
```

### Database Backup & Restore

```powershell
# Backup PostgreSQL
docker-compose exec -T db pg_dump -U lksystem_user lksystem > backup.sql

# Restore PostgreSQL
docker-compose exec -T db psql -U lksystem_user lksystem < backup.sql

# Backup Redis
docker-compose exec redis redis-cli BGSAVE

# Get Redis backup
docker-compose exec redis redis-cli --rdb /path/to/dump.rdb
```

---

## 🔍 Troubleshooting Commands

### Check Service Status

```powershell
# PostgreSQL running?
psql -U lksystem_user -d lksystem -h localhost -c "SELECT version();"

# Redis running?
redis-cli ping
# Expected: PONG

# Backend running?
curl http://localhost:8000/api/v1/

# Frontend running?
curl http://localhost:5173
```

### Port Issues

```powershell
# Find process using port
netstat -ano | findstr :8000

# Kill process (replace PID)
taskkill /PID 12345 /F

# Check port availability
Test-NetConnection -ComputerName localhost -Port 8000

# Change port in dev:
python manage.py runserver 0.0.0.0:8080
npm run dev -- --port 3000
```

### Environment & Configuration

```powershell
# Check .env file is loaded
python manage.py shell
# Then:
import os
print(os.getenv('DEBUG'))
exit()

# List all environment variables
env  # Linux/Mac
Get-ChildItem env:  # Windows

# Check Django settings
python manage.py diffsettings
```

### Database Troubleshooting

```powershell
# Test database connection
python manage.py dbshell

# Migrate with verbose output
python manage.py migrate --verbosity 2

# Show SQL for migration
python manage.py sqlmigrate app_name 0001

# Check database integrity
python manage.py check

# Reset specific app's database (CAREFUL!)
python manage.py migrate app_name zero  # Rollback all
python manage.py migrate app_name       # Reapply all
```

### Cache Issues

```powershell
# Clear Redis cache
redis-cli FLUSHALL

# Or specific database
redis-cli -n 0 FLUSHDB

# Check Redis memory
redis-cli INFO memory

# Clear Django cache
python manage.py shell
# Then:
from django.core.cache import cache
cache.clear()
exit()
```

---

## 🔐 Security Checks

```powershell
# Django security check
python manage.py check --deploy

# Check for known vulnerabilities
pip-audit

# Requirements scanning
safety check

# Code security scanning (if installed)
bandit -r apps/
```

---

## 📊 Monitoring & Performance

### Django Development

```powershell
# Django debug toolbar (development only)
pip install django-debug-toolbar

# Add to INSTALLED_APPS in settings.py
# Then access: http://localhost:8000/__debug__/

# Profiling
pip install django-silk
python manage.py runserver --use-threading
```

### Frontend Performance

```powershell
# Build analysis
npm run build:analyze

# Type checking performance
npm run type-check

# Lighthouse audit
npm run build
npm run preview
# Then use Chrome DevTools Lighthouse tab
```

### Database Performance

```powershell
# Query logging
python manage.py shell
# Then:
from django.db import connection
from django.test.utils import CaptureQueriesContext

with CaptureQueriesContext(connection) as context:
    # Your code here
    pass
print(f"Total queries: {len(context)}")
exit()
```

---

## 📝 Common Workflows

### Daily Development

```powershell
# 1. Activate venv
.\venv\Scripts\Activate.ps1

# 2. Start backend
cd LkSystemBackEnd
python manage.py runserver

# 3. In another terminal, start frontend
cd lkSystemFrontEnd
npm run dev

# 4. Access at http://localhost:5173
# 5. When done: Ctrl+C in both terminals and deactivate venv
deactivate
```

### Making Database Changes

```powershell
# 1. Modify model in apps/[app]/models.py

# 2. Create migration
python manage.py makemigrations

# 3. Review migration file: apps/[app]/migrations/0X_auto_*.py

# 4. Apply migration
python manage.py migrate

# 5. Test changes
python manage.py shell
```

### Adding Dependencies

```powershell
# 1. Install package
pip install new-package

# 2. Update requirements.txt
pip freeze > requirements.txt

# 3. Commit changes
git add requirements.txt
git commit -m "Add new-package"

# 4. Team members update their environment
pip install -r requirements.txt
```

### Docker Deployment

```powershell
# 1. Update .env with production values
# DEBUG=False
# ALLOWED_HOSTS=yourdomain.com

# 2. Build and start
docker-compose build --no-cache
docker-compose up -d

# 3. Check logs
docker-compose logs -f web

# 4. Verify services
docker-compose ps
```

---

## ⚡ Pro Tips

### Speed Up pip Install

```powershell
# Use cached wheels
pip install -r requirements.txt --prefer-binary

# Install specific version range faster
pip install "django>=5.0,<6.0" --dry-run
```

### Development Shortcuts

```powershell
# Create custom Django management command
python manage.py shell_plus  # IPython shell (if django-extensions installed)

# Run Python with Django environment
python manage.py shell <<EOF
from apps.users.models import User
print(User.objects.count())
EOF
```

### Git Ignore venv

```powershell
# Add to .gitignore
echo "venv/" >> .gitignore
echo "*.pyc" >> .gitignore
echo ".env" >> .gitignore
echo "dist/" >> .gitignore
echo "node_modules/" >> .gitignore
echo "mediafiles/" >> .gitignore
```

### Automated Setup Alias

```powershell
# Add to PowerShell profile (notepad $PROFILE)

function lk-setup {
    .\setup.ps1
}

function lk-dev {
    .\venv\Scripts\Activate.ps1
    Write-Host "Virtual environment activated!"
}

function lk-clean {
    docker-compose down -v
    rm -Recurse -Force venv, node_modules, dist
}
```

---

## 📱 API Testing Quick Reference

### Using curl

```powershell
# Get API schema
curl http://localhost:8000/api/schema/

# Login and get token
$response = curl -X POST `
  http://localhost:8000/api/v1/auth/login/ `
  -H "Content-Type: application/json" `
  -d '{"matricule":"SUPERADMIN-0001","password":"ChangeMe123!"}'

# Use token in requests
curl -H "Authorization: Bearer TOKEN" `
  http://localhost:8000/api/v1/users/
```

### Using Postman

1. Open Postman
2. Import: `http://localhost:8000/api/schema/`
3. Automatically generates collection
4. Set up environment variables:
   - `base_url`: `http://localhost:8000`
   - `token`: (get from login endpoint)

### Using Django Admin

```
Access: http://localhost:8000/admin/
Username: SUPERADMIN-0001
Password: ChangeMe123!
```

---

## 🆘 Emergency Commands

```powershell
# Kill stuck process
Get-Process python | Stop-Process -Force

# Force kill Docker container
docker kill lksystem_backend

# Reset everything (WARNING: DELETES ALL DATA)
docker-compose down -v
rm -Recurse -Force LkSystemBackEnd/venv, LkSystemBackEnd/mediafiles, postgres_data

# Restore from backup
docker-compose exec -T db psql -U lksystem_user lksystem < backup.sql

# Emergency Django reset
python manage.py migrate zero
python manage.py migrate

# Clear all caches
redis-cli FLUSHALL
python manage.py shell
from django.core.cache import caches
for cache in caches.all():
    cache.clear()
```

---

## 📚 Resources

- **Complete Setup**: [COMPLETE_SETUP_GUIDE.md](COMPLETE_SETUP_GUIDE.md)
- **Virtual Env**: [VENV_BEST_PRACTICES.md](VENV_BEST_PRACTICES.md)
- **Django Docs**: https://docs.djangoproject.com
- **React Docs**: https://react.dev
- **Docker Docs**: https://docs.docker.com

---

**Last Updated**: March 30, 2026  
**Perfect for experienced developers who want quick reference!** ⚡

