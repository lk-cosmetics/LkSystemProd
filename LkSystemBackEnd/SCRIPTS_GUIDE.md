# LkSystem Backend - Setup & Utility Scripts Guide

## 📋 Available Scripts & Commands

This document lists all available scripts and management commands for setting up and managing your LkSystem backend.

---

## 1. **Setup & Initialization Scripts**

### `create_superadmin_user.py` (NEW) ⭐
Creates a superadmin user with full permissions and RBAC 'Super Admin' role.

**Usage:**
```bash
# Interactive mode (prompts for input)
python create_superadmin_user.py

# With arguments
python create_superadmin_user.py ADMIN-0001 admin@example.com password123 Admin User "Company Name"

# In Docker container
docker compose -f docker-compose.fullstack.yml exec backend python create_superadmin_user.py
```

**What it does:**
- ✓ Creates a superuser with `matricule` (employee ID)
- ✓ Creates/uses a default company
- ✓ Assigns the 'Super Admin' RBAC role
- ✓ Safely updates if user already exists

**Requirements before running:**
1. Docker containers must be running: `docker compose -f docker-compose.fullstack.yml up -d`
2. Database migrations must be applied (automatic on startup)
3. RBAC roles must be seeded (see below)

**Example Output:**
```
✓ Company created: LkSystem Main
✓ Superadmin created: ADMIN-0001
✓ Super Admin RBAC role assigned

============================================================
✅ Superadmin Setup Complete!
============================================================
Matricule:  ADMIN-0001
Email:      admin@lksystem.com
Name:       Admin User
Company:    LkSystem Main
Superuser:  Yes
Status:     Active
============================================================
```

**Login credentials after creation:**
- Matricule: `ADMIN-0001`
- Email: `admin@lksystem.com`
- Password: `lksystem2026` (as created)

---

### `python manage.py seed_rbac`
Seeds all RBAC (Role-Based Access Control) permissions and system roles.

**Usage:**
```bash
# In Docker
docker compose -f docker-compose.fullstack.yml exec backend python manage.py seed_rbac

# Local development
python manage.py seed_rbac
```

**What it does:**
- ✓ Creates 51+ application permissions
- ✓ Creates 7 system roles:
  - Super Admin (51 permissions)
  - CEO (51 permissions)
  - Manager (26 permissions)
  - Cashier (8 permissions)
  - Stock Keeper (6 permissions)
  - Sales Rep (9 permissions)
  - Viewer (14 permissions)
- ✓ Assigns 'Super Admin' role to all existing superusers
- ✓ Safe to run multiple times

**When to run:**
- First-time setup (required before creating superadmin users)
- After database reset
- When updating permission structures

**Required before:** `create_superadmin_user.py`

---

## 2. **Data Population Scripts**

### `create_test_data.py`
Creates sample company, brands, sales channels, and products for testing.

**Usage:**
```bash
# Direct execution
python create_test_data.py

# In Docker
docker compose -f docker-compose.fullstack.yml exec backend python create_test_data.py
```

**What it creates:**
- ✓ Test Company (Company: "Test Company", Abbreviation: "TEST")
- ✓ Test Brand
- ✓ Test POS Sales Channel
- ✓ 3 Sample Products:
  - Dell Laptop XPS 13 ($999.99)
  - Apple iPhone 15 ($899.99)
  - Samsung Galaxy S24 ($799.99)
- ✓ Inventory for each product (100 units per product)

**When to use:**
- Initial setup for testing
- Safe to run multiple times (uses `get_or_create`)

---

### `python manage.py populate_test_data`
Populate inventory test data (Django management command).

**Usage:**
```bash
docker compose -f docker-compose.fullstack.yml exec backend python manage.py populate_test_data
```

---

## 3. **Testing & Debugging Scripts**

### `check_webhooks.py`
Check and verify webhook configuration for WooCommerce integration.

**Usage:**
```bash
python check_webhooks.py
```

**What it checks:**
- Webhook endpoints availability
- WooCommerce connection
- Hook registration status

---

### `test_schema.py`
Test the API schema/documentation endpoints.

**Usage:**
```bash
python test_schema.py
```

**What it tests:**
- OpenAPI schema generation
- Swagger UI availability
- ReDoc documentation

**Endpoints tested:**
- `GET /api/schema/` → OpenAPI spec (public)
- `GET /api/docs/` → Swagger UI (authenticated)
- `GET /api/redoc/` → ReDoc (authenticated)

---

### `debug_order_ingestion.py`
Debug the order ingestion process from WooCommerce.

**Usage:**
```bash
python debug_order_ingestion.py
```

**What it does:**
- Traces order processing pipeline
- Logs product matching
- Debug sales channel filtering
- Show inventory updates

---

### `test_woocommerce_fixes.py`
Test various WooCommerce integration fixes and compatibility.

**Usage:**
```bash
python test_woocommerce_fixes.py
```

---

## 4. **Django Management Commands**

### Basic Django Commands

```bash
# Database migrations
python manage.py makemigrations
python manage.py migrate

# Create Django superuser (standard Django way)
python manage.py createsuperuser

# Collect static files
python manage.py collectstatic --noinput

# Run development server
python manage.py runserver 0.0.0.0:8000

# Django shell for testing
python manage.py shell
```

---

## 🚀 Typical Setup Sequence

Follow this order for a fresh setup:

### 1. **Start Containers**
```bash
docker compose -f docker-compose.fullstack.yml up -d
```
- Waits for database ✓
- Runs migrations automatically ✓
- Starts backend ✓
- Starts frontend ✓

### 2. **Seed RBAC**
```bash
docker compose -f docker-compose.fullstack.yml exec backend python manage.py seed_rbac
```
Output:
```
  Permissions: 0 created, 51 already existed.
  Role "Super Admin": Updated (51 permissions)
  Role "CEO": Updated (51 permissions)
  ... 5 more roles ...
RBAC seed complete.
```

### 3. **Create Superadmin User**
```bash
docker compose -f docker-compose.fullstack.yml exec backend python create_superadmin_user.py
# Or with arguments:
docker compose -f docker-compose.fullstack.yml exec backend python create_superadmin_user.py \
  ADMIN-0001 admin@company.com password123 Admin User "My Company"
```

### 4. **(Optional) Create Test Data**
```bash
docker compose -f docker-compose.fullstack.yml exec backend python create_test_data.py
```

### 5. **Login to Frontend**
- Open browser: `http://localhost:5180`
- Matricule: `ADMIN-0001`
- Password: `lksystem2026` (or your chosen password)

---

## 🔐 User Authentication

### Login Credentials Format

Your custom User model uses **`matricule`** instead of username:

```
Field: matricule (not username)
Value: ADMIN-0001  (unique employee ID)
Email: admin@lksystem.com
Password: your_secure_password
```

### Getting JWT Token

```bash
# Get JWT token
curl -X POST http://localhost:8000/api/v1/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"matricule":"ADMIN-0001","password":"lksystem2026"}'

# Response
{
  "access": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "refresh": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "user": {
    "id": 1,
    "matricule": "ADMIN-0001",
    "email": "admin@lksystem.com",
    "first_name": "Admin",
    "last_name": "User",
    "current_company": {
      "id": 1,
      "name": "LkSystem Main"
    }
  }
}
```

### Using Token in Requests

```bash
# Include in Authorization header
curl -H "Authorization: Bearer TOKEN_HERE" http://localhost:8000/api/v1/orders/

# Token expires in 60 minutes
# Refresh before expiry:
curl -X POST http://localhost:8000/api/v1/auth/refresh/ \
  -H "Content-Type: application/json" \
  -d '{"refresh":"refresh_token_here"}'
```

---

## 📊 API Documentation

After creating a superadmin and logging in:

1. **OpenAPI Schema** (public):
   - `http://localhost:8000/api/schema/`

2. **Swagger UI** (requires JWT token):
   - `http://localhost:8000/api/docs/`
   - Login with JWT token to explore endpoints

3. **ReDoc** (requires JWT token):
   - `http://localhost:8000/api/redoc/`

---

## 🗂️ File Locations

All scripts are located in `LkSystemBackEnd/`:

```
LkSystemBackEnd/
├── create_superadmin_user.py      ← NEW: Create superadmin
├── create_test_data.py              ← Create test data
├── check_webhooks.py                ← Check webhooks
├── test_schema.py                   ← Test API schema
├── debug_order_ingestion.py         ← Debug orders
├── test_woocommerce_fixes.py        ← Test WooCommerce
├── manage.py                        ← Django management utility
├── core/
│   └── settings.py
└── apps/
    ├── users/management/commands/create_superadmin.py  ← Management command
    ├── rbac/management/commands/seed_rbac.py          ← Seed RBAC
    └── inventory/management/commands/populate_test_data.py
```

---

## 🐳 Docker Quick Reference

```bash
# Start containers
docker compose -f docker-compose.fullstack.yml up -d

# Stop containers
docker compose -f docker-compose.fullstack.yml stop

# Stop and remove containers
docker compose -f docker-compose.fullstack.yml down

# Remove containers and volumes (fresh start)
docker compose -f docker-compose.fullstack.yml down -v

# View logs
docker compose -f docker-compose.fullstack.yml logs -f backend

# Execute command in container
docker compose -f docker-compose.fullstack.yml exec backend [COMMAND]

# Check container status
docker compose -f docker-compose.fullstack.yml ps
```

---

## ✅ Verification Checklist

After setup, verify everything is working:

- [ ] Frontend loads at `http://localhost:5180`
- [ ] Backend API responds at `http://localhost:8000/api/healthz/` (if exists)
- [ ] Can login with superadmin credentials
- [ ] Can view Orders page
- [ ] Can access API docs at `/api/docs/` with JWT token
- [ ] RBAC roles appear in admin panel
- [ ] Webhooks are registered (check logs)

---

## 🆘 Troubleshooting

### "Database connection refused"
```bash
# Check if PostgreSQL is running
docker compose ps

# Rebuild with fresh database
docker compose -f docker-compose.fullstack.yml down -v
docker compose -f docker-compose.fullstack.yml up -d
```

### "RBAC Role not found"
```bash
# Ensure seed_rbac was run
docker compose -f docker-compose.fullstack.yml exec backend python manage.py seed_rbac
```

### "Unknown command: 'create_superadmin'"
Management command won't work until container is rebuilt. Use the script instead:
```bash
docker cp LkSystemBackEnd/create_superadmin_user.py lksystem_backend:/app/
docker compose -f docker-compose.fullstack.yml exec backend python create_superadmin_user.py
```

### Clear Docker cache and rebuild
```bash
docker system prune -a
docker compose -f docker-compose.fullstack.yml build --no-cache
docker compose -f docker-compose.fullstack.yml up -d
```

---

## 📝 Notes

- All scripts use Django ORM with `get_or_create()` to prevent duplicates
- Use these scripts **after** containers are running and migrations are applied
- Passwords should be at least 8 characters
- Matricules must follow the pattern: `[UPPERCASE][UPPERCASE]-[NUMBERS]`
- Company abbreviations are automatically created from company name (first 3 letters)

---

## 📚 Additional Resources

- Django ORM: https://docs.djangoproject.com/en/3.11/topics/db/models/
- DRF API: https://www.django-rest-framework.org/
- JWT Authentication: https://django-rest-framework-simplejwt.readthedocs.io/
- OpenAPI/Swagger: https://drf-spectacular.readthedocs.io/

---

**Last Updated:** March 30, 2026  
**Version:** 1.0  
**Status:** ✅ Production Ready
