# LkSystem Backend - Modular ERP

A modern, modular ERP backend built with Django 5+ and Django REST Framework.

## 🏗️ Architecture

**Micro-App Architecture** - Each business entity is an independent Django app for maximum modularity.

**Service Layer Pattern** - Business logic is separated from views using a scalable service layer with abstract base classes.

```
LkSystemBackEnd/
├── core/                      # Core Settings & Services
│   ├── settings.py
│   ├── urls.py
│   ├── wsgi.py
│   ├── asgi.py
│   ├── services/              # 🆕 Centralized Service Layer
│   │   ├── __init__.py
│   │   ├── base.py            # BaseWooCommerceService[T] ABC
│   │   ├── exceptions.py      # Custom Exception Hierarchy
│   │   └── mixins.py          # AuditMixin, PaginationMixin, etc.
│   └── webhooks/              # 🆕 Centralized Webhook System
│       ├── __init__.py
│       ├── registry.py        # WebhookRegistry (Factory Pattern)
│       ├── validators.py      # HMAC-SHA256 Signature Validation
│       ├── dispatcher.py      # Webhook Dispatcher
│       ├── decorators.py      # @validate_webhook, @webhook_handler
│       ├── views.py           # UnifiedWebhookView
│       └── urls.py            # /api/v1/webhooks/
├── apps/
│   ├── company/               # Company Entity
│   │   ├── models.py
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── urls.py
│   │   └── admin.py
│   ├── brands/                # Brand Entity
│   │   ├── models.py
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── urls.py
│   │   └── admin.py
│   ├── sales_channels/        # SalesChannel Entity
│   │   ├── models.py
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── urls.py
│   │   └── admin.py
│   ├── categories/            # WooCommerce Category Sync
│   │   ├── models.py
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── urls.py
│   │   ├── admin.py
│   │   ├── service.py         # 🆕 CategoryService(BaseWooCommerceService)
│   │   └── handlers.py        # 🆕 Webhook Handler Registration
│   ├── products/              # WooCommerce Product Sync
│   │   ├── models.py
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── urls.py
│   │   ├── admin.py
│   │   ├── service.py         # 🆕 ProductService(BaseWooCommerceService)
│   │   └── handlers.py        # 🆕 Webhook Handler Registration
│   └── users/                 # User, Role, Profile Entities
│       ├── models/
│       │   ├── role.py
│       │   ├── user.py
│       │   ├── profile.py
│       │   └── password_reset.py
│       ├── api/
│       │   ├── serializers.py
│       │   └── views.py
│       ├── signals.py
│       ├── urls.py
│       └── admin.py
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
└── manage.py
```

---

## 🔄 Scalable Service Layer Architecture

The WooCommerce synchronization logic uses a clean, scalable architecture with:

### 1. Abstract Base Service (`BaseWooCommerceService[T]`)

A generic abstract class that provides common functionality for all WooCommerce sync services:

```python
from core.services import BaseWooCommerceService
from apps.products.models import Product

class ProductService(BaseWooCommerceService[Product]):
    @property
    def model_class(self) -> type:
        return Product
    
    @property
    def wc_endpoint(self) -> str:
        return 'products'
    
    def transform_from_wc(self, wc_data: dict) -> dict:
        # Transform WooCommerce data to local model fields
        ...
    
    def transform_to_wc(self, instance: Product) -> dict:
        # Transform local model to WooCommerce API format
        ...
```

**Key Features:**
- Generic typing with `TypeVar`
- Abstract methods for transformations
- Built-in CRUD operations (fetch, sync, push)
- Pagination, caching, and audit mixins

### 2. Centralized Webhook System

A unified webhook endpoint with factory/registry pattern:

```python
# Register handlers using decorator
from core.webhooks import webhook_handler

@webhook_handler('product.created', 'product.updated')
def handle_product(context: WebhookContext):
    ...

# Or register service classes
from core.webhooks import webhook_registry
ProductService.register_with_registry(webhook_registry)
```

**Key Features:**
- Single endpoint for all WooCommerce webhooks
- HMAC-SHA256 signature validation
- Factory pattern for topic-based dispatch
- Automatic handler discovery

### 3. Exception Hierarchy

Custom exceptions for better error handling:

```python
from core.services.exceptions import (
    WooCommerceConfigError,    # Missing API credentials
    WooCommerceAuthError,      # Authentication failed
    WooCommerceAPIError,       # API request failed
    WooCommerceSyncError,      # Sync operation failed
    WebhookValidationError,    # Invalid webhook signature
)
```

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| **Backend Framework** | Django 5.0+ |
| **API Framework** | Django REST Framework |
| **Authentication** | JWT (SimpleJWT) |
| **Database** | PostgreSQL 15+ |
| **Caching** | Redis 7+ |
| **Deployment** | Docker & Docker Compose |
| **Static Files** | WhiteNoise |
| **API Docs** | drf-spectacular (Swagger/OpenAPI) |
| **Email** | SMTP (Gmail) |
| **WooCommerce Client** | WooCommerce Python SDK |


---

## 🚀 Quick Start

### Option 1: Docker (Recommended)

```bash
# 1. Clone the repository
git clone <repo-url>
cd LkSystemBackEnd

# 2. Copy environment file
cp .env.example .env

# 3. Start all services
docker-compose up -d

# 4. Create migrations and migrate
docker-compose exec web python manage.py makemigrations
docker-compose exec web python manage.py migrate

# 5. Create superuser
docker-compose exec web python manage.py createsuperuser
docker-compose -f docker-compose.fullstack.yml exec backend python create_superadmin_user.py

# 6. Access the application
# API: http://localhost:8000/api/v1/
# Admin: http://localhost:8000/admin/
```

### Option 2: Local Development

```bash
# 1. Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Setup environment
cp .env.example .env
# Edit .env with your local PostgreSQL and Redis settings

# 4. Run migrations
python manage.py makemigrations
python manage.py migrate

# 5. Create superuser
python manage.py createsuperuser

# 6. Run server
python manage.py runserver
```

---

## 📋 API Documentation

### Interactive API Docs (Swagger UI) 🔐
```
http://localhost:8000/api/docs/
```
> **Requires JWT Authentication** - Login first, then use the token to access docs.

### Alternative API Docs (ReDoc) 🔐
```
http://localhost:8000/api/redoc/
```
> **Requires JWT Authentication**

### OpenAPI Schema (JSON) 🔐
```
http://localhost:8000/api/schema/
```
> **Requires JWT Authentication**

### Base URL
```
http://localhost:8000/api/v1/
```

### Authentication
All endpoints (except login and password reset) require JWT authentication.

**Headers:**
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

---

# 📚 COMPLETE API REFERENCE

---

## 🔐 Authentication Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `POST` | `/api/v1/auth/login/` | Login & get JWT tokens | ❌ |
| `POST` | `/api/v1/auth/logout/` | Logout (frontend compatibility) | ❌ |
| `POST` | `/api/v1/auth/refresh/` | Refresh access token | ❌ |
| `POST` | `/api/v1/auth/verify/` | Verify token validity | ❌ |
| `POST` | `/api/v1/auth/forgot-password/` | Request password reset email | ❌ |
| `POST` | `/api/v1/auth/validate-reset-token/` | Validate reset token | ❌ |
| `POST` | `/api/v1/auth/reset-password/` | Reset password with token | ❌ |

---

### 🔑 Login

**Request:**
```http
POST /api/v1/auth/login/
Content-Type: application/json

{
    "matricule": "MYCO-0001",
    "password": "SecureP@ss123"
}
```

**Response (200 OK):**
```json
{
    "access": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjoxNzA2NTI5NjAwLCJpYXQiOjE3MDY1MjYwMDAsImp0aSI6IjEyMzQ1Njc4OTAiLCJ1c2VyX2lkIjoxLCJtYXRyaWN1bGUiOiJNWUNPLTAwMDEiLCJlbWFpbCI6ImpvaG5AY29tcGFueS5jb20iLCJyb2xlIjoiTWFuYWdlciIsImNhbl9zd2l0Y2hfYnJhbmRzIjp0cnVlLCJjb21wYW55X2lkIjoxLCJjb21wYW55X25hbWUiOiJNeSBDb21wYW55IiwiYWxsb3dlZF9icmFuZF9pZHMiOlsxLDIsM10sImRlZmF1bHRfYnJhbmRfaWQiOjF9.abc123",
    "refresh": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ0b2tlbl90eXBlIjoicmVmcmVzaCIsImV4cCI6MTcwNjYxMjQwMCwiaWF0IjoxNzA2NTI2MDAwLCJqdGkiOiIwOTg3NjU0MzIxIiwidXNlcl9pZCI6MX0.xyz789",
    "user": {
        "id": 1,
        "matricule": "MYCO-0001",
        "email": "john@company.com",
        "full_name": "John Doe",
        "role": "Manager",
        "can_switch_brands": true,
        "company_id": 1,
        "allowed_brand_ids": [1, 2, 3]
    }
}
```

**Error Response (401 Unauthorized):**
```json
{
    "detail": "No active account found with the given credentials"
}
```

---

### 🔄 Refresh Token

**Request:**
```http
POST /api/v1/auth/refresh/
Content-Type: application/json

{
    "refresh": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9..."
}
```

**Response (200 OK):**
```json
{
    "access": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.newtoken..."
}
```

**Error Response (401 Unauthorized):**
```json
{
    "detail": "Token is invalid or expired",
    "code": "token_not_valid"
}
```

---

### ✅ Verify Token

**Request:**
```http
POST /api/v1/auth/verify/
Content-Type: application/json

{
    "token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9..."
}
```

**Response (200 OK):**
```json
{}
```

**Error Response (401 Unauthorized):**
```json
{
    "detail": "Token is invalid or expired",
    "code": "token_not_valid"
}
```

---

### 🚪 Logout

**Request:**
```http
POST /api/v1/auth/logout/
Content-Type: application/json

{
    "refresh": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9..."
}
```

**Response (200 OK):**
```json
{
    "message": "Successfully logged out."
}
```

---

### 📧 Forgot Password (Request Reset Email)

**Request:**
```http
POST /api/v1/auth/forgot-password/
Content-Type: application/json

{
    "email": "john@company.com"
}
```

**Response (200 OK):**
```json
{
    "message": "If an account with this email exists, a password reset link has been sent.",
    "email": "john@company.com"
}
```

> **Security Note:** Always returns success even if email doesn't exist (prevents email enumeration attacks).

---

### 🔍 Validate Reset Token

Use this when user lands on the reset password page to check if the token is still valid.

**Request:**
```http
POST /api/v1/auth/validate-reset-token/
Content-Type: application/json

{
    "email": "john@company.com",
    "token": "LPYwicXbOAP_SFNmo_A5vYWr57CYgDlHET25Kz_VlZE"
}
```

**Response (200 OK - Valid):**
```json
{
    "valid": true,
    "message": "Token is valid. You can reset your password."
}
```

**Error Response (400 Bad Request - Invalid/Expired):**
```json
{
    "token": ["Invalid or expired reset token."]
}
```

---

### 🔐 Reset Password

**Request:**
```http
POST /api/v1/auth/reset-password/
Content-Type: application/json

{
    "email": "john@company.com",
    "token": "LPYwicXbOAP_SFNmo_A5vYWr57CYgDlHET25Kz_VlZE",
    "new_password": "NewSecureP@ss123!",
    "new_password_confirm": "NewSecureP@ss123!"
}
```

**Response (200 OK):**
```json
{
    "message": "Password has been reset successfully. You can now login with your new password."
}
```

**Error Response (400 Bad Request):**
```json
{
    "new_password": ["This password is too common."],
    "new_password_confirm": ["Passwords do not match."]
}
```

**Error Response (400 Bad Request - Invalid Token):**
```json
{
    "token": ["Invalid or expired reset token."]
}
```

**Password Requirements:**
- Minimum 8 characters
- Cannot be entirely numeric
- Cannot be too common (e.g., "password123")
- Must contain letters

---

## 🏢 Company Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/v1/company/` | List all companies | ✅ |
| `POST` | `/api/v1/company/` | Create a company | ✅ |
| `GET` | `/api/v1/company/{id}/` | Get company details | ✅ |
| `PUT` | `/api/v1/company/{id}/` | Full update company | ✅ |
| `PATCH` | `/api/v1/company/{id}/` | Partial update company | ✅ |
| `DELETE` | `/api/v1/company/{id}/` | Delete company | ✅ |
| `GET` | `/api/v1/company/{id}/brands/` | Get company's brands | ✅ |
| `GET` | `/api/v1/company/active/` | Get active companies only | ✅ |

---

### 📋 List Companies

**Request:**
```http
GET /api/v1/company/
Authorization: Bearer <access_token>
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | int | Page number (default: 1) |
| `search` | string | Search by name, email |
| `is_active` | bool | Filter by active status |
| `ordering` | string | Order by field (e.g., `name`, `-created_at`) |

**Response (200 OK):**
```json
{
    "count": 2,
    "next": null,
    "previous": null,
    "results": [
        {
            "id": 1,
            "name": "Hajji Company",
            "legal_name": "Hajji Company SARL",
            "abbreviation": "HC",
            "logo": null,
            "matricule_fiscale": "1234567ABC000",
            "registre_commerce": "B0123456789",
            "activity_code": "4619A",
            "bank_name": "BIAT",
            "rib": "08006000012345678912",
            "address": "45 Avenue Habib Bourguiba",
            "city": "Tunis",
            "phone": "+21671234567",
            "email": "contact@hajji.tn",
            "is_active": true,
            "brands_count": 3,
            "brands": [
                {"id": 1, "name": "Brand One"},
                {"id": 2, "name": "Brand Two"},
                {"id": 3, "name": "Brand Three"}
            ],
            "created_at": "2026-01-27T10:00:00Z",
            "updated_at": "2026-01-27T10:00:00Z"
        }
    ]
}
```

---

### ➕ Create Company

**Only `name` is required!** Everything else is optional or auto-generated.

**Minimal Request:**
```http
POST /api/v1/company/
Authorization: Bearer <access_token>
Content-Type: application/json

{
    "name": "Hajji Company"
}
```

**Full Request (All Fields):**
```http
POST /api/v1/company/
Authorization: Bearer <access_token>
Content-Type: application/json

{
    "name": "Société Hajji Import Export",
    "legal_name": "Société Hajji Import Export SARL",
    "abbreviation": "SHIE",
    "email": "contact@hajji-import.tn",
    "phone": "+21671234567",
    "address": "45 Avenue Habib Bourguiba, Centre Urbain Nord",
    "city": "Tunis",
    "matricule_fiscale": "1234567ABC000",
    "registre_commerce": "B0123456789",
    "activity_code": "4619A",
    "bank_name": "BIAT",
    "rib": "08006000012345678912",
    "is_active": true
}
```

**Response (201 Created):**
```json
{
    "id": 1,
    "name": "Société Hajji Import Export",
    "legal_name": "Société Hajji Import Export SARL",
    "abbreviation": "SHIE",
    "logo": null,
    "matricule_fiscale": "1234567ABC000",
    "registre_commerce": "B0123456789",
    "activity_code": "4619A",
    "bank_name": "BIAT",
    "rib": "08006000012345678912",
    "address": "45 Avenue Habib Bourguiba, Centre Urbain Nord",
    "city": "Tunis",
    "phone": "+21671234567",
    "email": "contact@hajji-import.tn",
    "is_active": true,
    "brands_count": 0,
    "brands": [],
    "created_at": "2026-01-27T10:00:00Z",
    "updated_at": "2026-01-27T10:00:00Z"
}
```

**Error Response (400 Bad Request):**
```json
{
    "name": ["company with this name already exists."],
    "email": ["Enter a valid email address."]
}
```

**Auto-Generated Fields:**
| Field | Rule |
|-------|------|
| `legal_name` | Copied from `name` if empty |
| `abbreviation` | Generated from name: "Hajji Company" → `HC` |

**Auto-Transformations:**
| Field | Transformation |
|-------|---------------|
| `abbreviation` | Always UPPERCASE, max 5 chars |
| `name` | Title Case |
| `email` | lowercase |
| `phone` | Removes spaces/dashes |

---

### 📄 Get Company Details

**Request:**
```http
GET /api/v1/company/1/
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
    "id": 1,
    "name": "Hajji Company",
    "legal_name": "Hajji Company SARL",
    "abbreviation": "HC",
    "logo": "http://localhost:8000/media/company_logos/logo.png",
    "matricule_fiscale": "1234567ABC000",
    "registre_commerce": "B0123456789",
    "activity_code": "4619A",
    "bank_name": "BIAT",
    "rib": "08006000012345678912",
    "address": "45 Avenue Habib Bourguiba",
    "city": "Tunis",
    "phone": "+21671234567",
    "email": "contact@hajji.tn",
    "is_active": true,
    "brands_count": 3,
    "brands": [
        {"id": 1, "name": "Brand One"},
        {"id": 2, "name": "Brand Two"},
        {"id": 3, "name": "Brand Three"}
    ],
    "created_at": "2026-01-27T10:00:00Z",
    "updated_at": "2026-01-27T10:00:00Z"
}
```

**Error Response (404 Not Found):**
```json
{
    "detail": "Not found."
}
```

---

### ✏️ Update Company (PUT - Full Update)

**Request:**
```http
PUT /api/v1/company/1/
Authorization: Bearer <access_token>
Content-Type: application/json

{
    "name": "Hajji Company Updated",
    "legal_name": "Hajji Company SARL",
    "abbreviation": "HCU",
    "email": "contact@hajji.tn",
    "phone": "+21671234567",
    "address": "45 Avenue Habib Bourguiba",
    "city": "Tunis",
    "matricule_fiscale": "1234567ABC000",
    "registre_commerce": "B0123456789",
    "activity_code": "4619A",
    "bank_name": "BIAT",
    "rib": "08006000012345678912",
    "is_active": true
}
```

**Response (200 OK):**
```json
{
    "id": 1,
    "name": "Hajji Company Updated",
    "legal_name": "Hajji Company SARL",
    "abbreviation": "HCU",
    ...
}
```

---

### ✏️ Update Company (PATCH - Partial Update)

**Request:**
```http
PATCH /api/v1/company/1/
Authorization: Bearer <access_token>
Content-Type: application/json

{
    "phone": "+21699888777",
    "is_active": false
}
```

**Response (200 OK):**
```json
{
    "id": 1,
    "name": "Hajji Company",
    "phone": "+21699888777",
    "is_active": false,
    ...
}
```

---

### 🗑️ Delete Company

**Request:**
```http
DELETE /api/v1/company/1/
Authorization: Bearer <access_token>
```

**Response (204 No Content):**
```
(empty body)
```

**Error Response (404 Not Found):**
```json
{
    "detail": "Not found."
}
```

---

### 🏷️ Get Company Brands

**Request:**
```http
GET /api/v1/company/1/brands/
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
[
    {
        "id": 1,
        "name": "Brand One",
        "logo": null,
        "channels_count": 2,
        "created_at": "2026-01-27T10:00:00Z"
    },
    {
        "id": 2,
        "name": "Brand Two",
        "logo": null,
        "channels_count": 1,
        "created_at": "2026-01-27T11:00:00Z"
    }
]
```

---

### 📋 Get Active Companies Only

**Request:**
```http
GET /api/v1/company/active/
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
[
    {
        "id": 1,
        "name": "Hajji Company",
        "abbreviation": "HC",
        "is_active": true,
        ...
    }
]
```

---

## 🏷️ Brand Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/v1/brands/` | List all brands | ✅ |
| `POST` | `/api/v1/brands/` | Create a brand | ✅ |
| `GET` | `/api/v1/brands/{id}/` | Get brand details | ✅ |
| `PUT` | `/api/v1/brands/{id}/` | Full update brand | ✅ |
| `PATCH` | `/api/v1/brands/{id}/` | Partial update brand | ✅ |
| `DELETE` | `/api/v1/brands/{id}/` | Delete brand | ✅ |
| `GET` | `/api/v1/brands/{id}/channels/` | Get brand's sales channels | ✅ |

---

### 📋 List Brands

**Request:**
```http
GET /api/v1/brands/
Authorization: Bearer <access_token>
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `company` | int | Filter by company ID |
| `search` | string | Search by name |
| `ordering` | string | Order by field (e.g., `name`, `-created_at`) |
| `page` | int | Page number |

**Response (200 OK):**
```json
{
    "count": 3,
    "next": null,
    "previous": null,
    "results": [
        {
            "id": 1,
            "company": 1,
            "company_name": "Hajji Company",
            "company_abbreviation": "HC",
            "name": "Premium Brand",
            "logo": null,
            "channels_count": 2,
            "sales_channels": [
                {
                    "id": 1,
                    "name": "Online Store",
                    "channel_type": "WOOCOMMERCE",
                    "channel_type_display": "WooCommerce",
                    "is_active": true
                },
                {
                    "id": 2,
                    "name": "Main POS",
                    "channel_type": "POS",
                    "channel_type_display": "Point of Sale",
                    "is_active": true
                }
            ],
            "created_at": "2026-01-27T10:00:00Z",
            "updated_at": "2026-01-27T10:00:00Z"
        }
    ]
}
```

---

### ➕ Create Brand

**Request:**
```http
POST /api/v1/brands/
Authorization: Bearer <access_token>
Content-Type: application/json

{
    "company": 1,
    "name": "Premium Brand"
}
```

**Response (201 Created):**
```json
{
    "id": 1,
    "company": 1,
    "company_name": "Hajji Company",
    "company_abbreviation": "HC",
    "name": "Premium Brand",
    "logo": null,
    "channels_count": 0,
    "sales_channels": [],
    "created_at": "2026-01-27T10:00:00Z",
    "updated_at": "2026-01-27T10:00:00Z"
}
```

**Error Response (400 Bad Request):**
```json
{
    "company": ["This field is required."],
    "name": ["This field is required."]
}
```

---

### 📄 Get Brand Details

**Request:**
```http
GET /api/v1/brands/1/
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
    "id": 1,
    "company": 1,
    "company_name": "Hajji Company",
    "company_abbreviation": "HC",
    "name": "Premium Brand",
    "logo": "http://localhost:8000/media/brand_logos/premium.png",
    "channels_count": 2,
    "sales_channels": [
        {
            "id": 1,
            "name": "Online Store",
            "channel_type": "WOOCOMMERCE",
            "channel_type_display": "WooCommerce",
            "is_active": true,
            "woocommerce_config": {
                "store_url": "https://store.example.com",
                "consumer_key": "ck_abc123...",
                "consumer_secret": "cs_xyz789...",
                "webhook_token": "whk_4f2c9b1e7d3a..."
            }
        },
        {
            "id": 2,
            "name": "Main POS",
            "channel_type": "POS",
            "channel_type_display": "Point of Sale",
            "is_active": true,
            "woocommerce_config": null
        }
    ],
    "created_at": "2026-01-27T10:00:00Z",
    "updated_at": "2026-01-27T10:00:00Z"
}
```

---

### ✏️ Update Brand (PATCH)

**Request:**
```http
PATCH /api/v1/brands/1/
Authorization: Bearer <access_token>
Content-Type: application/json

{
    "name": "Super Premium Brand"
}
```

**Response (200 OK):**
```json
{
    "id": 1,
    "company": 1,
    "company_name": "Hajji Company",
    "company_abbreviation": "HC",
    "name": "Super Premium Brand",
    ...
}
```

---

### 🗑️ Delete Brand

**Request:**
```http
DELETE /api/v1/brands/1/
Authorization: Bearer <access_token>
```

**Response (204 No Content):**
```
(empty body)
```

---

### 📦 Get Brand's Sales Channels

**Request:**
```http
GET /api/v1/brands/1/channels/
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
[
    {
        "id": 1,
        "name": "Online Store",
        "channel_type": "WOOCOMMERCE",
        "channel_type_display": "WooCommerce",
        "is_active": true
    },
    {
        "id": 2,
        "name": "Main POS",
        "channel_type": "POS",
        "channel_type_display": "Point of Sale",
        "is_active": true
    }
]
```

---

## 📦 Sales Channel Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/v1/sales-channels/` | List all channels | ✅ |
| `POST` | `/api/v1/sales-channels/` | Create a channel | ✅ |
| `GET` | `/api/v1/sales-channels/{id}/` | Get channel details | ✅ |
| `PUT` | `/api/v1/sales-channels/{id}/` | Full update channel | ✅ |
| `PATCH` | `/api/v1/sales-channels/{id}/` | Partial update | ✅ |
| `DELETE` | `/api/v1/sales-channels/{id}/` | Delete channel | ✅ |
| `GET` | `/api/v1/sales-channels/active/` | Get active channels | ✅ |
| `GET` | `/api/v1/sales-channels/by_type/` | Filter by type | ✅ |
| `GET` | `/api/v1/sales-channels/woocommerce/` | Get WooCommerce channels | ✅ |
| `GET` | `/api/v1/sales-channels/pos/` | Get POS channels | ✅ |
| `POST` | `/api/v1/sales-channels/{id}/regenerate-webhook/` | Regenerate webhook token | ✅ |
| `PATCH` | `/api/v1/sales-channels/{id}/store-url/` | Update store URL | ✅ |

---

### 📋 List Sales Channels

**Request:**
```http
GET /api/v1/sales-channels/
Authorization: Bearer <access_token>
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `brand` | int | Filter by brand ID |
| `channel_type` | string | Filter by type (`WOOCOMMERCE`, `POS`) |
| `is_active` | bool | Filter by active status |
| `page` | int | Page number |

**Response (200 OK):**
```json
{
    "count": 2,
    "next": null,
    "previous": null,
    "results": [
        {
            "id": 1,
            "brand": 1,
            "brand_name": "Premium Brand",
            "company_id": 1,
            "company_name": "Hajji Company",
            "name": "Online Store",
            "channel_type": "WOOCOMMERCE",
            "channel_type_display": "WooCommerce",
            "is_active": true,
            "woocommerce_config": {
                "store_url": "https://store.example.com",
                "consumer_key": "ck_abc123def456...",
                "consumer_secret": "cs_xyz789ghi012...",
                "webhook_token": "whk_4f2c9b1e7d3a6b8c5e0f..."
            },
            "created_at": "2026-01-27T10:00:00Z",
            "updated_at": "2026-01-27T10:00:00Z"
        },
        {
            "id": 2,
            "brand": 1,
            "brand_name": "Premium Brand",
            "company_id": 1,
            "company_name": "Hajji Company",
            "name": "Main POS",
            "channel_type": "POS",
            "channel_type_display": "Point of Sale",
            "is_active": true,
            "woocommerce_config": null,
            "created_at": "2026-01-27T11:00:00Z",
            "updated_at": "2026-01-27T11:00:00Z"
        }
    ]
}
```

---

### ➕ Create WooCommerce Channel

**User must provide:** `store_url`, `consumer_key`, `consumer_secret`
**Backend auto-generates:** `webhook_token`

**Request:**
```http
POST /api/v1/sales-channels/
Authorization: Bearer <access_token>
Content-Type: application/json

{
    "brand": 1,
    "name": "Online Store",
    "channel_type": "WOOCOMMERCE",
    "is_active": true,
    "woocommerce_config": {
        "store_url": "https://store.example.com",
        "consumer_key": "ck_8f3d2a9b4c7e6f1a2b3c4d5e6f7g8h9i0j",
        "consumer_secret": "cs_2a9b8f3d4c7e6f1a2b3c4d5e6f7g8h9i0j"
    }
}
```

**Response (201 Created):**
```json
{
    "id": 1,
    "brand": 1,
    "brand_name": "Premium Brand",
    "company_id": 1,
    "company_name": "Hajji Company",
    "name": "Online Store",
    "channel_type": "WOOCOMMERCE",
    "channel_type_display": "WooCommerce",
    "is_active": true,
    "woocommerce_config": {
        "store_url": "https://store.example.com",
        "consumer_key": "ck_8f3d2a9b4c7e6f1a2b3c4d5e6f7g8h9i0j",
        "consumer_secret": "cs_2a9b8f3d4c7e6f1a2b3c4d5e6f7g8h9i0j",
        "webhook_token": "whk_4f2c9b1e7d3a6b8c5e0f1a2d9g8h7j6k5l4m3n2o1p"
    },
    "created_at": "2026-01-27T10:00:00Z",
    "updated_at": "2026-01-27T10:00:00Z"
}
```

**Error Response (400 Bad Request):**
```json
{
    "woocommerce_config": ["WooCommerce configuration is required for WOOCOMMERCE channel type."]
}
```

---

### ➕ Create POS Channel

**Request:**
```http
POST /api/v1/sales-channels/
Authorization: Bearer <access_token>
Content-Type: application/json

{
    "brand": 1,
    "name": "Main POS",
    "channel_type": "POS",
    "is_active": true
}
```

**Response (201 Created):**
```json
{
    "id": 2,
    "brand": 1,
    "brand_name": "Premium Brand",
    "company_id": 1,
    "company_name": "Hajji Company",
    "name": "Main POS",
    "channel_type": "POS",
    "channel_type_display": "Point of Sale",
    "is_active": true,
    "woocommerce_config": null,
    "created_at": "2026-01-27T11:00:00Z",
    "updated_at": "2026-01-27T11:00:00Z"
}
```

---

### 📄 Get Sales Channel Details

**Request:**
```http
GET /api/v1/sales-channels/1/
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
    "id": 1,
    "brand": 1,
    "brand_name": "Premium Brand",
    "company_id": 1,
    "company_name": "Hajji Company",
    "name": "Online Store",
    "channel_type": "WOOCOMMERCE",
    "channel_type_display": "WooCommerce",
    "is_active": true,
    "woocommerce_config": {
        "store_url": "https://store.example.com",
        "consumer_key": "ck_abc123...",
        "consumer_secret": "cs_xyz789...",
        "webhook_token": "whk_4f2c9b1e..."
    },
    "created_at": "2026-01-27T10:00:00Z",
    "updated_at": "2026-01-27T10:00:00Z"
}
```

---

### ✏️ Update Sales Channel (PATCH)

**Request:**
```http
PATCH /api/v1/sales-channels/1/
Authorization: Bearer <access_token>
Content-Type: application/json

{
    "name": "Main Online Store",
    "is_active": false
}
```

**Response (200 OK):**
```json
{
    "id": 1,
    "brand": 1,
    "brand_name": "Premium Brand",
    "name": "Main Online Store",
    "is_active": false,
    ...
}
```

---

### 🗑️ Delete Sales Channel

**Request:**
```http
DELETE /api/v1/sales-channels/1/
Authorization: Bearer <access_token>
```

**Response (204 No Content):**
```
(empty body)
```

---

### 🔄 Regenerate Webhook Token

**Request:**
```http
POST /api/v1/sales-channels/1/regenerate-webhook/
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
    "message": "Webhook token regenerated successfully.",
    "webhook_token": "whk_9a8b7c6d5e4f3g2h1i0j9k8l7m6n5o4p3q2r1s0t",
    "channel_id": 1,
    "channel_name": "Online Store",
    "usage_hint": "Add this token to your WooCommerce webhook secret field."
}
```

**Error Response (400 Bad Request):**
```json
{
    "error": "This action is only available for WooCommerce channels."
}
```

---

### 🔗 Update Store URL

**Request:**
```http
PATCH /api/v1/sales-channels/1/store-url/
Authorization: Bearer <access_token>
Content-Type: application/json

{
    "store_url": "https://new-store.example.com"
}
```

**Response (200 OK):**
```json
{
    "message": "Store URL updated successfully.",
    "store_url": "https://new-store.example.com",
    "channel_id": 1,
    "channel_name": "Online Store"
}
```

---

### 📋 Get Active Channels Only

**Request:**
```http
GET /api/v1/sales-channels/active/
Authorization: Bearer <access_token>
```

---

### 📋 Get WooCommerce Channels Only

**Request:**
```http
GET /api/v1/sales-channels/woocommerce/
Authorization: Bearer <access_token>
```

---

### 📋 Get POS Channels Only

**Request:**
```http
GET /api/v1/sales-channels/pos/
Authorization: Bearer <access_token>
```

---

### 📋 Filter by Channel Type

**Request:**
```http
GET /api/v1/sales-channels/by_type/?type=WOOCOMMERCE
Authorization: Bearer <access_token>
```

---

### Channel Types

| Type | Description |
|------|-------------|
| `WOOCOMMERCE` | WooCommerce e-commerce integration |
| `POS` | Point of Sale system |

### WooCommerce Config Fields

| Field | Source | Description |
|-------|--------|-------------|
| `store_url` | 👤 User | Your WooCommerce store URL |
| `consumer_key` | 👤 User | From WooCommerce > Settings > REST API |
| `consumer_secret` | 👤 User | From WooCommerce > Settings > REST API |
| `webhook_token` | 🔐 Backend | Auto-generated for webhook authentication |

---

## � Categories (WooCommerce Sync)

The Categories app provides a local clone of WooCommerce product categories, synchronized via REST API and Webhooks.

### Category Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/v1/categories/` | List all categories | ✅ |
| `POST` | `/api/v1/categories/` | Create a category | ✅ |
| `GET` | `/api/v1/categories/{id}/` | Get category details | ✅ |
| `PUT` | `/api/v1/categories/{id}/` | Full update | ✅ |
| `PATCH` | `/api/v1/categories/{id}/` | Partial update | ✅ |
| `DELETE` | `/api/v1/categories/{id}/` | Delete category | ✅ |
| `GET` | `/api/v1/categories/tree/` | Get hierarchical tree | ✅ |
| `GET` | `/api/v1/categories/by_sales_channel/` | Filter by channel | ✅ |

### Category Model

| Field | Type | Description |
|-------|------|-------------|
| `wc_category_id` | Integer | WooCommerce Category ID (unique per channel) |
| `sales_channel` | ForeignKey | The WooCommerce store |
| `name` | String | Category name |
| `slug` | SlugField | URL-friendly slug |
| `description` | Text | Category description |
| `parent` | ForeignKey | Parent category (self-reference) |
| `image_url` | URL | Category image URL |
| `display_order` | Integer | Menu order |
| `created_at` | DateTime | Creation timestamp |
| `updated_at` | DateTime | Last update timestamp |
| `created_by` | ForeignKey | User who created |
| `updated_by` | ForeignKey | User who last updated |

---

### 📋 List Categories

**Request:**
```http
GET /api/v1/categories/
Authorization: Bearer <access_token>
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `sales_channel` | int | Filter by sales channel ID |
| `parent` | int | Filter by parent category ID |
| `search` | string | Search in name, slug, description |
| `ordering` | string | Order by: `name`, `display_order`, `created_at` |

**Response (200 OK):**
```json
{
    "count": 3,
    "next": null,
    "previous": null,
    "results": [
        {
            "id": 1,
            "wc_category_id": 15,
            "name": "Electronics",
            "slug": "electronics",
            "parent": null,
            "display_order": 0
        },
        {
            "id": 2,
            "wc_category_id": 16,
            "name": "Phones",
            "slug": "phones",
            "parent": 1,
            "display_order": 1
        }
    ]
}
```

---

### 🌳 Get Category Tree

Returns hierarchical structure with nested children.

**Request:**
```http
GET /api/v1/categories/tree/
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
[
    {
        "id": 1,
        "wc_category_id": 15,
        "name": "Electronics",
        "slug": "electronics",
        "children": [
            {
                "id": 2,
                "wc_category_id": 16,
                "name": "Phones",
                "slug": "phones",
                "children": []
            },
            {
                "id": 3,
                "wc_category_id": 17,
                "name": "Laptops",
                "slug": "laptops",
                "children": []
            }
        ]
    }
]
```

---

### 🔗 Category Webhook & Sync Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/api/v1/webhooks/woocommerce/categories/` | Receive WooCommerce category webhooks | Signature |
| `POST` | `/api/v1/webhooks/woocommerce/categories/sync/{channel_id}/` | Trigger category sync | JWT |
| `POST` | `/api/v1/webhooks/woocommerce/categories/push/{category_id}/` | Push category to WooCommerce | JWT |
| `DELETE` | `/api/v1/webhooks/woocommerce/categories/push/{category_id}/` | Delete category from WooCommerce | JWT |

---

### 🔄 Sync Categories from WooCommerce

Trigger a full or single category sync manually.

**Request (Full Sync):**
```http
POST /api/v1/webhooks/woocommerce/categories/sync/1/
Authorization: Bearer <access_token>
Content-Type: application/json

{
    "sync_type": "full"
}
```

**Response (200 OK):**
```json
{
    "detail": "Category sync completed successfully",
    "results": {
        "created": 5,
        "updated": 12
    }
}
```

**Request (Single Category Sync):**
```http
POST /api/v1/webhooks/woocommerce/categories/sync/1/
Authorization: Bearer <access_token>
Content-Type: application/json

{
    "sync_type": "single",
    "wc_category_id": 15
}
```

**Response (200 OK):**
```json
{
    "detail": "Category synced successfully",
    "category_id": 1,
    "wc_category_id": 15,
    "name": "Electronics"
}
```

---

### ⬆️ Push Category to WooCommerce

Push local category changes to WooCommerce (creates if new, updates if exists).

**Request:**
```http
POST /api/v1/webhooks/woocommerce/categories/push/1/
Authorization: Bearer <access_token>
```

**Response (201 Created - New Category):**
```json
{
    "detail": "Category created in WooCommerce",
    "wc_category_id": 25,
    "name": "New Category"
}
```

**Response (200 OK - Updated Category):**
```json
{
    "detail": "Category updated in WooCommerce",
    "wc_category_id": 15,
    "name": "Electronics"
}
```

---

### ❌ Delete Category from WooCommerce

**Request:**
```http
DELETE /api/v1/webhooks/woocommerce/categories/push/1/?delete_local=true
Authorization: Bearer <access_token>
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `delete_local` | bool | Also delete local category (default: false) |

**Response (200 OK):**
```json
{
    "detail": "Category deleted from WooCommerce and locally"
}
```

---

### Category Sync Service Usage

```python
from apps.categories.services import CategorySyncService
from apps.sales_channels.models import SalesChannel

# Get sales channel with WooCommerce config
channel = SalesChannel.objects.get(id=1)

# Initialize service
service = CategorySyncService(channel)

# Sync all categories from WooCommerce
results = service.sync_all_categories(user=request.user)
# {'created': 5, 'updated': 12}

# Sync single category
category = service.sync_single_category(wc_category_id=15, user=request.user)

# Push local category to WooCommerce
service.create_category_in_woocommerce(category)
service.update_category_in_woocommerce(category)

# Delete from WooCommerce
service.delete_category_in_woocommerce(wc_category_id=15)
```

---

## 🛍️ Products (WooCommerce Sync)

The Products app provides a local clone of WooCommerce products, synchronized via REST API and Webhooks.

### Product Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/v1/products/` | List all products | ✅ |
| `POST` | `/api/v1/products/` | Create a product | ✅ |
| `GET` | `/api/v1/products/{id}/` | Get product details | ✅ |
| `PUT` | `/api/v1/products/{id}/` | Full update | ✅ |
| `PATCH` | `/api/v1/products/{id}/` | Partial update | ✅ |
| `DELETE` | `/api/v1/products/{id}/` | Delete product | ✅ |
| `GET` | `/api/v1/products/low_stock/` | Get low stock products | ✅ |
| `GET` | `/api/v1/products/on_sale/` | Get products on sale | ✅ |
| `GET` | `/api/v1/products/out_of_stock/` | Get out of stock products | ✅ |
| `GET` | `/api/v1/products/by_category/` | Filter by category | ✅ |
| `GET` | `/api/v1/products/search_barcode/` | Search by barcode | ✅ |

### Product Model

| Field | Type | Description |
|-------|------|-------------|
| `wc_product_id` | Integer | WooCommerce Product ID |
| `sales_channel` | ForeignKey | The WooCommerce store |
| `name` | String | Product name |
| `slug` | SlugField | URL-friendly slug |
| `barcode` | String | SKU from WooCommerce |
| `description` | Text | Full product description |
| `short_description` | Text | Brief description |
| `product_type` | Choice | `simple`, `variable`, `grouped`, `external` |
| `status` | Choice | `publish`, `draft`, `pending`, `private` |
| `brand` | ForeignKey | Local Brand model |
| `categories` | ManyToMany | Product categories |
| `purchase_price` | Decimal | Cost price (local) |
| `sales_price` | Decimal | Regular price |
| `promotion_price` | Decimal | Sale price (nullable) |
| `inventory_status` | Choice | `instock`, `outofstock`, `onbackorder` |
| `stock_quantity` | Integer | Current stock level |
| `manage_stock` | Boolean | Whether stock is tracked |
| `image_url` | URL | Primary product image |
| `gallery_images` | JSON | List of additional image URLs |
| `weight` | Decimal | Product weight |
| `dimensions` | JSON | `{length, width, height}` |
| `attributes` | JSON | Product attributes |
| `created_at` | DateTime | Creation timestamp |
| `updated_at` | DateTime | Last update timestamp |
| `created_by` | ForeignKey | User who created |
| `updated_by` | ForeignKey | User who last updated |

---

### 📋 List Products

**Request:**
```http
GET /api/v1/products/
Authorization: Bearer <access_token>
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `sales_channel` | int | Filter by sales channel ID |
| `brand` | int | Filter by brand ID |
| `inventory_status` | string | Filter: `instock`, `outofstock`, `onbackorder` |
| `product_type` | string | Filter: `simple`, `variable`, etc. |
| `status` | string | Filter: `publish`, `draft`, etc. |
| `search` | string | Search in name, slug, barcode, description |
| `ordering` | string | Order by: `name`, `sales_price`, `created_at`, `stock_quantity` |

**Response (200 OK):**
```json
{
    "count": 50,
    "next": "http://localhost:8000/api/v1/products/?page=2",
    "previous": null,
    "results": [
        {
            "id": 1,
            "wc_product_id": 123,
            "name": "iPhone 15 Pro",
            "slug": "iphone-15-pro",
            "barcode": "SKU-IP15PRO",
            "brand_name": "Apple Store",
            "sales_price": "999.00",
            "promotion_price": "899.00",
            "effective_price": "899.00",
            "is_on_sale": true,
            "inventory_status": "instock",
            "image_url": "https://store.example.com/images/iphone15.jpg",
            "product_type": "simple",
            "status": "publish"
        }
    ]
}
```

---

### 🔍 Get Product by Barcode

**Request:**
```http
GET /api/v1/products/search_barcode/?barcode=SKU-IP15PRO
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
    "id": 1,
    "wc_product_id": 123,
    "name": "iPhone 15 Pro",
    "barcode": "SKU-IP15PRO",
    "sales_price": "999.00",
    "promotion_price": "899.00",
    "inventory_status": "instock",
    ...
}
```

---

### 📉 Get Low Stock Products

**Request:**
```http
GET /api/v1/products/low_stock/?threshold=5
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
[
    {
        "id": 5,
        "wc_product_id": 127,
        "name": "Samsung Galaxy S24",
        "barcode": "SKU-SGS24",
        "inventory_status": "instock",
        "stock_quantity": 3,
        "manage_stock": true
    }
]
```

---

## 🔗 WooCommerce Webhooks

The system receives real-time updates from WooCommerce via webhooks with HMAC-SHA256 signature validation.

### Webhook Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/api/v1/webhooks/woocommerce/products/` | Product webhooks | Signature |
| `POST` | `/api/v1/webhooks/woocommerce/categories/` | Category webhooks | Signature |
| `POST` | `/api/v1/webhooks/woocommerce/sync/{channel_id}/` | Manual sync trigger | JWT |

### Supported Webhook Topics

| Topic | Description |
|-------|-------------|
| `product.created` | New product created in WooCommerce |
| `product.updated` | Existing product updated |
| `product.deleted` | Product deleted |
| `product.restored` | Product restored from trash |
| `product_cat.created` | Category created |
| `product_cat.updated` | Category updated |
| `product_cat.deleted` | Category deleted |

### Webhook Security

Webhooks are authenticated using **HMAC-SHA256** signature validation:

1. WooCommerce sends `X-WC-Webhook-Signature` header
2. System validates signature using stored `webhook_token`
3. Invalid signatures are rejected with `401 Unauthorized`

**Signature Validation Logic:**
```python
import hmac
import hashlib
import base64

def validate_signature(payload: bytes, signature: str, secret: str) -> bool:
    """
    Validate WooCommerce webhook signature.
    
    Args:
        payload: Raw request body bytes
        signature: Base64-encoded signature from X-WC-Webhook-Signature header
        secret: Webhook secret (webhook_token from sales channel config)
    
    Returns:
        True if signature is valid, False otherwise
    """
    computed = hmac.new(
        key=secret.encode('utf-8'),
        msg=payload,
        digestmod=hashlib.sha256
    ).digest()
    
    computed_b64 = base64.b64encode(computed).decode('utf-8')
    
    # Constant-time comparison to prevent timing attacks
    return hmac.compare_digest(computed_b64, signature)
```

### Setting Up Webhooks in WooCommerce

1. Go to **WooCommerce > Settings > Advanced > Webhooks**
2. Click **Add webhook**
3. Configure:
   - **Name:** LkSystem Product Sync
   - **Status:** Active
   - **Topic:** Product created / updated / deleted
   - **Delivery URL:** `https://your-api.com/api/v1/webhooks/woocommerce/products/`
   - **Secret:** Use the `webhook_token` from your sales channel config
4. Repeat for category webhooks with topic `Action - product_cat`

---

### 🔄 Manual Sync Trigger

Trigger a full or partial sync manually (requires JWT authentication).

**Request:**
```http
POST /api/v1/webhooks/woocommerce/sync/1/
Authorization: Bearer <access_token>
Content-Type: application/json

{
    "sync_type": "full"
}
```

**Sync Types:**
| Type | Description |
|------|-------------|
| `full` | Sync both categories and products |
| `categories` | Sync only categories |
| `products` | Sync only products |

**Response (200 OK):**
```json
{
    "detail": "Sync completed successfully",
    "results": {
        "categories": {
            "created": 5,
            "updated": 12
        },
        "products": {
            "created": 25,
            "updated": 103
        }
    }
}
```

---

### WooCommerce Service Usage

The `WooCommerceService` class handles all API interactions:

```python
from apps.products.services import WooCommerceService
from apps.sales_channels.models import SalesChannel

# Get sales channel with WooCommerce config
channel = SalesChannel.objects.get(id=1)

# Initialize service
service = WooCommerceService(channel)

# Sync categories
cat_results = service.sync_categories(user=request.user)
# {'created': 5, 'updated': 12}

# Sync products
prod_results = service.sync_products(user=request.user)
# {'created': 25, 'updated': 103}

# Full sync
results = service.full_sync(user=request.user)
# {'categories': {...}, 'products': {...}}
```

---

## �👥 User Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/v1/users/` | List all users | ✅ |
| `POST` | `/api/v1/users/` | Create a user | ✅ |
| `GET` | `/api/v1/users/{id}/` | Get user details | ✅ |
| `PUT` | `/api/v1/users/{id}/` | Full update user | ✅ |
| `PATCH` | `/api/v1/users/{id}/` | Partial update | ✅ |
| `DELETE` | `/api/v1/users/{id}/` | Delete user | ✅ |
| `GET` | `/api/v1/users/me/` | Get current user | ✅ |
| `POST` | `/api/v1/users/{id}/change_password/` | Change password (role-based) | ✅ |
| `GET` | `/api/v1/users/by_brand/` | Filter by brand | ✅ |

> **📌 Password Change Permission Hierarchy:**
> - **Superadmin**: Can change any user's password
> - **CEO**: Can change passwords for users in their company
> - **Manager**: Can change passwords for users in their brand(s)
> - **Regular User**: Can only change their own password

---

### 📋 List Users

**Request:**
```http
GET /api/v1/users/
Authorization: Bearer <access_token>
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `current_company` | int | Filter by company ID |
| `role` | int | Filter by role ID |
| `is_active` | bool | Filter by active status |
| `search` | string | Search by matricule, email, name |
| `ordering` | string | Order by field |
| `page` | int | Page number |

**Response (200 OK):**
```json
{
    "count": 10,
    "next": "http://localhost:8000/api/v1/users/?page=2",
    "previous": null,
    "results": [
        {
            "id": 1,
            "matricule": "HC-0001",
            "email": "john.doe@company.com",
            "first_name": "John",
            "last_name": "Doe",
            "full_name": "John Doe",
            "role": 2,
            "role_name": "Manager",
            "can_switch_brands": true,
            "current_company": 1,
            "company_name": "Hajji Company",
            "allowed_brands": [1, 2],
            "allowed_brand_names": ["Premium Brand", "Basic Brand"],
            "is_active": true,
            "profile": {
                "id": 1,
                "phone": "+216 98 123 456",
                "birth_date": "1990-05-15",
                "gender": "M",
                "avatar": null,
                "is_complete": false,
                "completion_percentage": 35
            },
            "date_joined": "2026-01-25T10:00:00Z",
            "last_login": "2026-01-29T08:30:00Z"
        }
    ]
}
```

---

### ➕ Create User

**Request:**
```http
POST /api/v1/users/
Authorization: Bearer <access_token>
Content-Type: application/json

{
    "email": "john.doe@company.com",
    "first_name": "John",
    "last_name": "Doe",
    "password": "SecureP@ss123!",
    "current_company": 1,
    "role": 2,
    "allowed_brands": [1, 2],
    "is_active": true,
    "profile": {
        "phone": "+216 98 123 456",
        "birth_date": "1990-05-15",
        "gender": "M",
        "nationality": "Tunisian",
        "city": "Tunis",
        "address": "123 Main Street"
    }
}
```

**Response (201 Created):**
```json
{
    "id": 1,
    "matricule": "HC-0001",
    "email": "john.doe@company.com",
    "first_name": "John",
    "last_name": "Doe",
    "full_name": "John Doe",
    "role": 2,
    "role_name": "Manager",
    "can_switch_brands": true,
    "current_company": 1,
    "company_name": "Hajji Company",
    "allowed_brands": [1, 2],
    "allowed_brand_names": ["Premium Brand", "Basic Brand"],
    "is_active": true,
    "profile": {
        "id": 1,
        "phone": "+216 98 123 456",
        "birth_date": "1990-05-15",
        "gender": "M",
        "nationality": "Tunisian",
        "city": "Tunis",
        "address": "123 Main Street",
        "avatar": null,
        "is_complete": false,
        "completion_percentage": 45
    },
    "date_joined": "2026-01-29T10:00:00Z"
}
```

**Error Response (400 Bad Request):**
```json
{
    "email": ["user with this email already exists."],
    "password": ["This password is too short. It must contain at least 8 characters."],
    "allowed_brands": ["Brand with ID 5 does not belong to the selected company."]
}
```

> **Note:** Matricule is auto-generated based on company abbreviation (e.g., "HC-0001")

---

### 📄 Get User Details

**Request:**
```http
GET /api/v1/users/1/
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
    "id": 1,
    "matricule": "HC-0001",
    "email": "john.doe@company.com",
    "first_name": "John",
    "last_name": "Doe",
    "full_name": "John Doe",
    "role": 2,
    "role_name": "Manager",
    "can_switch_brands": true,
    "current_company": 1,
    "company_name": "Hajji Company",
    "allowed_brands": [1, 2],
    "allowed_brand_names": ["Premium Brand", "Basic Brand"],
    "is_active": true,
    "is_staff": false,
    "is_superuser": false,
    "profile": {
        "id": 1,
        "phone": "+216 98 123 456",
        "birth_date": "1990-05-15",
        "gender": "M",
        "gender_display": "Male",
        "nationality": "Tunisian",
        "city": "Tunis",
        "address": "123 Main Street",
        "cin_number": "12345678",
        "cin_front": null,
        "cin_back": null,
        "passport_number": null,
        "passport_image": null,
        "emergency_phone": null,
        "avatar": null,
        "education_level": "MASTER",
        "education_level_display": "Master's Degree",
        "diploma_title": "Computer Science",
        "diploma_file": null,
        "is_complete": false,
        "completion_percentage": 65
    },
    "date_joined": "2026-01-25T10:00:00Z",
    "last_login": "2026-01-29T08:30:00Z"
}
```

---

### 👤 Get Current User (Me)

**Request:**
```http
GET /api/v1/users/me/
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
    "id": 1,
    "matricule": "HC-0001",
    "email": "john.doe@company.com",
    "first_name": "John",
    "last_name": "Doe",
    "full_name": "John Doe",
    "role": 2,
    "role_name": "Manager",
    "can_switch_brands": true,
    "current_company": 1,
    "company_name": "Hajji Company",
    "allowed_brands": [1, 2],
    "allowed_brand_names": ["Premium Brand", "Basic Brand"],
    "is_active": true,
    "profile": {
        "id": 1,
        "phone": "+216 98 123 456",
        ...
    },
    "date_joined": "2026-01-25T10:00:00Z"
}
```

---

### ✏️ Update User (PATCH)

**Request:**
```http
PATCH /api/v1/users/1/
Authorization: Bearer <access_token>
Content-Type: application/json

{
    "first_name": "Johnny",
    "allowed_brands": [1, 2, 3],
    "is_active": true
}
```

**Response (200 OK):**
```json
{
    "id": 1,
    "matricule": "HC-0001",
    "email": "john.doe@company.com",
    "first_name": "Johnny",
    "last_name": "Doe",
    "full_name": "Johnny Doe",
    "allowed_brands": [1, 2, 3],
    ...
}
```

---

### ✏️ Update User with Profile (PATCH)

**Request:**
```http
PATCH /api/v1/users/1/
Authorization: Bearer <access_token>
Content-Type: application/json

{
    "first_name": "Johnny",
    "profile": {
        "phone": "+216 99 999 999",
        "city": "Sousse"
    }
}
```

**Response (200 OK):**
```json
{
    "id": 1,
    "first_name": "Johnny",
    "profile": {
        "phone": "+216 99 999 999",
        "city": "Sousse",
        ...
    },
    ...
}
```

---

### 🔐 Change Password

The password change endpoint implements a **role-based permission hierarchy** with comprehensive security features.

#### Permission Hierarchy

| Role | Can Change Password For | Old Password Required |
|------|------------------------|----------------------|
| **Superadmin** | Any user in the system | ❌ No |
| **CEO** | Any user within their company | ❌ No |
| **Manager** | Users within their brand(s) | ❌ No |
| **Regular User** | Only themselves | ✅ Yes |

#### Security Features

- ✅ **Rate Limiting**: 5 attempts per 15 minutes
- ✅ **Audit Logging**: All password changes are logged
- ✅ **Email Notification**: User receives email after password change
- ✅ **Password Validation**: Django's built-in password validators

---

#### Example 1: User Changing Their Own Password

**Request:**
```http
POST /api/v1/users/1/change_password/
Authorization: Bearer <access_token>
Content-Type: application/json

{
    "old_password": "OldP@ss123!",
    "new_password": "NewSecureP@ss456!",
    "new_password_confirm": "NewSecureP@ss456!"
}
```

**Response (200 OK):**
```json
{
    "detail": "Password changed successfully.",
    "changed_by": "self",
    "email_notification_sent": true
}
```

---

#### Example 2: Superadmin Changing Any User's Password

**Request:**
```http
POST /api/v1/users/5/change_password/
Authorization: Bearer <superadmin_access_token>
Content-Type: application/json

{
    "new_password": "NewSecureP@ss456!",
    "new_password_confirm": "NewSecureP@ss456!"
}
```

**Response (200 OK):**
```json
{
    "detail": "Password changed successfully.",
    "changed_by": "superadmin",
    "email_notification_sent": true
}
```

---

#### Example 3: CEO Changing Employee's Password (Same Company)

**Request:**
```http
POST /api/v1/users/10/change_password/
Authorization: Bearer <ceo_access_token>
Content-Type: application/json

{
    "new_password": "NewSecureP@ss456!",
    "new_password_confirm": "NewSecureP@ss456!"
}
```

**Response (200 OK):**
```json
{
    "detail": "Password changed successfully.",
    "changed_by": "ceo",
    "email_notification_sent": true
}
```

---

#### Example 4: Manager Changing Team Member's Password (Same Brand)

**Request:**
```http
POST /api/v1/users/15/change_password/
Authorization: Bearer <manager_access_token>
Content-Type: application/json

{
    "new_password": "NewSecureP@ss456!",
    "new_password_confirm": "NewSecureP@ss456!"
}
```

**Response (200 OK):**
```json
{
    "detail": "Password changed successfully.",
    "changed_by": "manager",
    "email_notification_sent": true
}
```

---

#### Error Responses

**Error: Wrong Old Password (400 Bad Request):**
```json
{
    "old_password": ["Old password is incorrect."]
}
```

**Error: Passwords Don't Match (400 Bad Request):**
```json
{
    "new_password_confirm": ["New passwords do not match."]
}
```

**Error: Weak Password (400 Bad Request):**
```json
{
    "new_password": [
        "This password is too short. It must contain at least 8 characters.",
        "This password is too common."
    ]
}
```

**Error: Permission Denied (403 Forbidden):**
```json
{
    "detail": "You do not have permission to change this user's password."
}
```

**Error: Rate Limited (429 Too Many Requests):**
```json
{
    "detail": "Too many password change attempts. Please try again in 15 minutes."
}
```

**Error: CEO Trying to Change User from Different Company (403 Forbidden):**
```json
{
    "detail": "You do not have permission to change this user's password."
}
```

**Error: Manager Trying to Change User from Different Brand (403 Forbidden):**
```json
{
    "detail": "You do not have permission to change this user's password."
}
```

---

### 🗑️ Delete User

**Request:**
```http
DELETE /api/v1/users/1/
Authorization: Bearer <access_token>
```

**Response (204 No Content):**
```
(empty body)
```

---

### 📋 Get Users by Brand

**Request:**
```http
GET /api/v1/users/by_brand/?brand_id=1
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
[
    {
        "id": 1,
        "matricule": "HC-0001",
        "email": "john.doe@company.com",
        "full_name": "John Doe",
        ...
    }
]
```

---

## 🎭 Role Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/v1/users/roles/` | List all roles | ✅ |
| `POST` | `/api/v1/users/roles/` | Create a role | ✅ |
| `GET` | `/api/v1/users/roles/{id}/` | Get role details | ✅ |
| `PUT` | `/api/v1/users/roles/{id}/` | Full update role | ✅ |
| `PATCH` | `/api/v1/users/roles/{id}/` | Partial update | ✅ |
| `DELETE` | `/api/v1/users/roles/{id}/` | Delete role | ✅ |

---

### 📋 List Roles

**Request:**
```http
GET /api/v1/users/roles/
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
    "count": 3,
    "next": null,
    "previous": null,
    "results": [
        {
            "id": 1,
            "name": "Super Admin",
            "description": "Full system access",
            "can_switch_brands": true,
            "is_admin": true,
            "users_count": 1,
            "created_at": "2026-01-20T10:00:00Z",
            "updated_at": "2026-01-20T10:00:00Z"
        },
        {
            "id": 2,
            "name": "Manager",
            "description": "Branch manager with multi-brand access",
            "can_switch_brands": true,
            "is_admin": false,
            "users_count": 5,
            "created_at": "2026-01-20T11:00:00Z",
            "updated_at": "2026-01-20T11:00:00Z"
        },
        {
            "id": 3,
            "name": "Employee",
            "description": "Regular employee with single brand access",
            "can_switch_brands": false,
            "is_admin": false,
            "users_count": 20,
            "created_at": "2026-01-20T12:00:00Z",
            "updated_at": "2026-01-20T12:00:00Z"
        }
    ]
}
```

---

### ➕ Create Role

**Request:**
```http
POST /api/v1/users/roles/
Authorization: Bearer <access_token>
Content-Type: application/json

{
    "name": "Sales Manager",
    "description": "Manages sales team across multiple brands",
    "can_switch_brands": true,
    "is_admin": false
}
```

**Response (201 Created):**
```json
{
    "id": 4,
    "name": "Sales Manager",
    "description": "Manages sales team across multiple brands",
    "can_switch_brands": true,
    "is_admin": false,
    "users_count": 0,
    "created_at": "2026-01-29T10:00:00Z",
    "updated_at": "2026-01-29T10:00:00Z"
}
```

**Error Response (400 Bad Request):**
```json
{
    "name": ["role with this name already exists."]
}
```

---

### 📄 Get Role Details

**Request:**
```http
GET /api/v1/users/roles/2/
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
    "id": 2,
    "name": "Manager",
    "description": "Branch manager with multi-brand access",
    "can_switch_brands": true,
    "is_admin": false,
    "users_count": 5,
    "created_at": "2026-01-20T11:00:00Z",
    "updated_at": "2026-01-20T11:00:00Z"
}
```

---

### ✏️ Update Role (PATCH)

**Request:**
```http
PATCH /api/v1/users/roles/2/
Authorization: Bearer <access_token>
Content-Type: application/json

{
    "description": "Updated description for manager role",
    "can_switch_brands": false
}
```

**Response (200 OK):**
```json
{
    "id": 2,
    "name": "Manager",
    "description": "Updated description for manager role",
    "can_switch_brands": false,
    "is_admin": false,
    "users_count": 5,
    "created_at": "2026-01-20T11:00:00Z",
    "updated_at": "2026-01-29T10:00:00Z"
}
```

---

### 🗑️ Delete Role

**Request:**
```http
DELETE /api/v1/users/roles/4/
Authorization: Bearer <access_token>
```

**Response (204 No Content):**
```
(empty body)
```

**Error Response (400 Bad Request):**
```json
{
    "error": "Cannot delete role with assigned users."
}
```

> **Note:** Cannot delete a role that has users assigned to it.

---

## 👤 Profile Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/v1/users/profiles/` | List all profiles | ✅ |
| `GET` | `/api/v1/users/profiles/{id}/` | Get profile details | ✅ |
| `PUT` | `/api/v1/users/profiles/{id}/` | Full update profile | ✅ |
| `PATCH` | `/api/v1/users/profiles/{id}/` | Partial update | ✅ |
| `GET` | `/api/v1/users/profiles/me/` | Get current user's profile | ✅ |

---

### 📋 List Profiles

**Request:**
```http
GET /api/v1/users/profiles/
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
    "count": 10,
    "next": null,
    "previous": null,
    "results": [
        {
            "id": 1,
            "user": 1,
            "user_email": "john.doe@company.com",
            "user_full_name": "John Doe",
            "phone": "+216 98 123 456",
            "birth_date": "1990-05-15",
            "gender": "M",
            "gender_display": "Male",
            "nationality": "Tunisian",
            "city": "Tunis",
            "address": "123 Main Street",
            "avatar": null,
            "is_complete": false,
            "completion_percentage": 65
        }
    ]
}
```

---

### 📄 Get Profile Details

**Request:**
```http
GET /api/v1/users/profiles/1/
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
    "id": 1,
    "user": 1,
    "user_email": "john.doe@company.com",
    "user_full_name": "John Doe",
    "phone": "+216 98 123 456",
    "emergency_phone": "+216 98 111 222",
    "birth_date": "1990-05-15",
    "gender": "M",
    "gender_display": "Male",
    "nationality": "Tunisian",
    "city": "Tunis",
    "address": "123 Main Street",
    "cin_number": "12345678",
    "cin_front": "http://localhost:8000/media/documents/cin_front.jpg",
    "cin_back": "http://localhost:8000/media/documents/cin_back.jpg",
    "passport_number": null,
    "passport_image": null,
    "avatar": "http://localhost:8000/media/avatars/john.jpg",
    "education_level": "MASTER",
    "education_level_display": "Master's Degree",
    "diploma_title": "Computer Science",
    "diploma_file": "http://localhost:8000/media/documents/diploma.pdf",
    "is_complete": true,
    "completion_percentage": 100,
    "created_at": "2026-01-25T10:00:00Z",
    "updated_at": "2026-01-29T10:00:00Z"
}
```

---

### 👤 Get Current User's Profile (Me)

**Request:**
```http
GET /api/v1/users/profiles/me/
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
    "id": 1,
    "user": 1,
    "user_email": "john.doe@company.com",
    "user_full_name": "John Doe",
    "phone": "+216 98 123 456",
    ...
}
```

---

### ✏️ Update Profile (PATCH - JSON)

**Request:**
```http
PATCH /api/v1/users/profiles/1/
Authorization: Bearer <access_token>
Content-Type: application/json

{
    "phone": "+216 99 888 777",
    "city": "Sousse",
    "education_level": "DOCTORATE"
}
```

**Response (200 OK):**
```json
{
    "id": 1,
    "user": 1,
    "user_email": "john.doe@company.com",
    "user_full_name": "John Doe",
    "phone": "+216 99 888 777",
    "city": "Sousse",
    "education_level": "DOCTORATE",
    "education_level_display": "Doctorate (PhD)",
    "is_complete": true,
    "completion_percentage": 100,
    ...
}
```

---

### ✏️ Update Profile (With File Upload - multipart/form-data)

**Request:**
```http
PATCH /api/v1/users/profiles/1/
Authorization: Bearer <access_token>
Content-Type: multipart/form-data

phone: +216 99 888 777
city: Sousse
avatar: [FILE]
cin_front: [FILE]
cin_back: [FILE]
diploma_file: [FILE]
```

**Response (200 OK):**
```json
{
    "id": 1,
    "user": 1,
    "user_email": "john.doe@company.com",
    "user_full_name": "John Doe",
    "phone": "+216 99 888 777",
    "city": "Sousse",
    "avatar": "http://localhost:8000/media/avatars/john_new.jpg",
    "cin_front": "http://localhost:8000/media/documents/cin_front.jpg",
    "cin_back": "http://localhost:8000/media/documents/cin_back.jpg",
    "diploma_file": "http://localhost:8000/media/documents/diploma.pdf",
    "is_complete": true,
    "completion_percentage": 100,
    ...
}
```

---

### Profile Fields Reference

| Field | Type | Description |
|-------|------|-------------|
| `phone` | string | Phone number |
| `emergency_phone` | string | Emergency contact phone |
| `birth_date` | date | Date of birth (YYYY-MM-DD) |
| `gender` | string | `M` (Male), `F` (Female), `O` (Other) |
| `nationality` | string | Nationality |
| `city` | string | City |
| `address` | string | Street address |
| `cin_number` | string | National ID number |
| `cin_front` | file | Front image of ID card |
| `cin_back` | file | Back image of ID card |
| `passport_number` | string | Passport number |
| `passport_image` | file | Passport image |
| `avatar` | file | Profile picture |
| `education_level` | string | See education levels below |
| `diploma_title` | string | Diploma/Degree title |
| `diploma_file` | file | Diploma document (PDF) |

### Education Levels

| Value | Display |
|-------|---------|
| `NONE` | No Formal Education |
| `PRIMARY` | Primary School |
| `SECONDARY` | Secondary School |
| `BAC` | Baccalaureate |
| `LICENSE` | License (Bachelor) |
| `MASTER` | Master's Degree |
| `DOCTORATE` | Doctorate (PhD) |
| `OTHER` | Other |

### Gender Values

| Value | Display |
|-------|---------|
| `M` | Male |
| `F` | Female |
| `O` | Other |

---

## 🔍 Filtering, Searching & Ordering

All list endpoints support:

### Filtering Examples
```http
GET /api/v1/brands/?company=1
GET /api/v1/users/?role=2&is_active=true
GET /api/v1/sales-channels/?channel_type=WOOCOMMERCE&is_active=true
GET /api/v1/users/?current_company=1&role=2
```

### Searching Examples
```http
GET /api/v1/users/?search=john
GET /api/v1/company/?search=hajji
GET /api/v1/brands/?search=premium
```

### Ordering Examples
```http
GET /api/v1/brands/?ordering=name           # Ascending by name
GET /api/v1/brands/?ordering=-created_at    # Descending by created_at
GET /api/v1/users/?ordering=-date_joined    # Latest users first
GET /api/v1/company/?ordering=name          # Alphabetical
```

### Pagination
```http
GET /api/v1/users/?page=2
GET /api/v1/users/?page=3&page_size=20
```

**Paginated Response Format:**
```json
{
    "count": 100,
    "next": "http://localhost:8000/api/v1/users/?page=3",
    "previous": "http://localhost:8000/api/v1/users/?page=1",
    "results": [...]
}
```

---

## 🛡️ Multi-Brand Access Logic

### How it Works

1. **User belongs to ONE Company** (`current_company`)
2. **User can access MULTIPLE Brands** (`allowed_brands`) within that company
3. **Brand switching is controlled by Role** (`can_switch_brands`)

### JWT Token Logic

When a user logs in:

| Role Setting | JWT `allowed_brand_ids` |
|--------------|-------------------------|
| `can_switch_brands = True` | All allowed brand IDs: `[1, 2, 3]` |
| `can_switch_brands = False` | Only first/default brand: `[1]` |

### Validation Rules

- Brands assigned to a user MUST belong to their `current_company`
- Cannot assign Brand from Company B to User in Company A

---

## 📊 API Response Codes

| Code | Description | Example |
|------|-------------|---------|
| `200` | Success | GET, PUT, PATCH requests |
| `201` | Created | POST requests |
| `204` | No Content | DELETE requests |
| `400` | Bad Request | Validation errors |
| `401` | Unauthorized | Invalid/missing token |
| `403` | Forbidden | No permission |
| `404` | Not Found | Resource doesn't exist |
| `500` | Server Error | Internal error |

### Error Response Format

**Validation Error (400):**
```json
{
    "field_name": ["Error message 1", "Error message 2"],
    "another_field": ["Another error"],
    "non_field_errors": ["General error not tied to a field"]
}
```

**Authentication Error (401):**
```json
{
    "detail": "Given token not valid for any token type",
    "code": "token_not_valid",
    "messages": [
        {
            "token_class": "AccessToken",
            "token_type": "access",
            "message": "Token is invalid or expired"
        }
    ]
}
```

**Permission Error (403):**
```json
{
    "detail": "You do not have permission to perform this action."
}
```

**Not Found Error (404):**
```json
{
    "detail": "Not found."
}
```

---

## 🔧 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DEBUG` | Debug mode | `True` |
| `SECRET_KEY` | Django secret key | Required |
| `ALLOWED_HOSTS` | Comma-separated hosts | `localhost,127.0.0.1` |
| `POSTGRES_DB` | Database name | `lksystem` |
| `POSTGRES_USER` | Database user | `lksystem_user` |
| `POSTGRES_PASSWORD` | Database password | `lksystem_password` |
| `POSTGRES_HOST` | Database host | `db` |
| `POSTGRES_PORT` | Database port | `5432` |
| `REDIS_URL` | Redis connection URL | `redis://redis:6379/0` |
| `FRONTEND_URL` | Frontend application URL | `http://localhost:5174` |
| `CORS_ALLOWED_ORIGINS` | Allowed CORS origins | `http://localhost:5174` |
| `EMAIL_BACKEND` | Email backend | `smtp.EmailBackend` |
| `EMAIL_HOST` | SMTP host | `smtp.gmail.com` |
| `EMAIL_PORT` | SMTP port | `587` |
| `EMAIL_USE_TLS` | Use TLS | `True` |
| `EMAIL_HOST_USER` | SMTP username | Required |
| `EMAIL_HOST_PASSWORD` | SMTP App Password | Required |
| `DEFAULT_FROM_EMAIL` | From email address | `LkSystem <noreply@lksystem.com>` |
| `PASSWORD_RESET_TIMEOUT` | Token timeout (seconds) | `3600` |

---

## 🐳 Docker Commands

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f web

# Run migrations
docker-compose exec web python manage.py migrate

# Create superuser
docker-compose exec web python manage.py createsuperuser

# Access Django shell
docker-compose exec web python manage.py shell

# Stop services
docker-compose down

# Rebuild after code changes
docker-compose up -d --build web

# View specific container logs
docker-compose logs web --tail=50

# Run management commands
docker-compose exec web python manage.py <command>
```

---

## 👨‍💼 Django Admin

Access the admin panel at: `http://localhost:8000/admin/`

### Registered Models

| App | Models |
|-----|--------|
| **Company** | Company |
| **Brands** | Brand |
| **Sales Channels** | SalesChannel |
| **Categories** | Category |
| **Products** | Product |
| **Users** | User, Role, Profile, PasswordResetToken |

---

## 🧪 Testing

```bash
# Run tests
docker-compose exec web python manage.py test

# Run with coverage
docker-compose exec web coverage run manage.py test
docker-compose exec web coverage report
```

---

## 📝 License

Proprietary - LkSystem ERP

---

## 👨‍💻 Authors

LkSystem Development Team
