"""
LkSystem - Django Settings
Production-ready configuration for modular ERP backend.
"""

import os
import sys
from pathlib import Path
from decouple import config, Csv

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# Add apps directory to Python path
APPS_DIR = BASE_DIR / 'apps'
sys.path.insert(0, str(APPS_DIR))

# =============================================================================
# SECURITY SETTINGS
# =============================================================================

SECRET_KEY = config('SECRET_KEY', default='django-insecure-change-me-in-production')

DEBUG = config('DEBUG', default=False, cast=bool)

ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='localhost,127.0.0.1', cast=Csv())

# =============================================================================
# APPLICATION DEFINITION
# =============================================================================

DJANGO_APPS = [
    'daphne',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
]

THIRD_PARTY_APPS = [
    'rest_framework',
    'rest_framework_simplejwt',  # JWT Authentication
    'corsheaders',
    'django_filters',
    'drf_spectacular',  # API Documentation (Swagger/OpenAPI)
]

# Micro-App Architecture: Each entity is an independent app
LOCAL_APPS = [
    'apps.users',           # User, Role, Profile management (MUST be first for AUTH_USER_MODEL)
    'apps.company',         # Company entity management
    'apps.brands',          # Brand entity management
    'apps.sales_channels',  # Sales channel entity management
    'apps.categories',      # WooCommerce category synchronization
    'apps.products',        # WooCommerce product synchronization
    'apps.promotions',      # Multi-channel promotion engine
    'apps.inventory',       # Multi-store inventory management
    'apps.clients',         # Client / customer auto-registration
    'apps.orders',          # Order ingestion (WooCommerce + POS)
    'apps.rbac',            # Dynamic role-based access control
    'apps.bi',              # Business Intelligence dashboard
    'apps.notifications',   # Role-based, user-targeted notifications
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

# Notifications retention: rows older than this are deleted by the
# ``cleanup_notifications`` management command / Celery task. Configurable.
NOTIFICATION_RETENTION_DAYS = config('NOTIFICATION_RETENTION_DAYS', default=90, cast=int)

# =============================================================================
# MIDDLEWARE
# =============================================================================

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',  # Static files serving
    'corsheaders.middleware.CorsMiddleware',  # CORS - must be before CommonMiddleware
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'core.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'core.wsgi.application'

# =============================================================================
# DATABASE - PostgreSQL
# =============================================================================

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': config('POSTGRES_DB', default='lksystem'),
        'USER': config('POSTGRES_USER', default='lksystem_user'),
        'PASSWORD': config('POSTGRES_PASSWORD', default='lksystem_password'),
        'HOST': config('POSTGRES_HOST', default='localhost'),
        'PORT': config('POSTGRES_PORT', default='5432'),
        'OPTIONS': {
            'connect_timeout': 10,
        },
    }
}

# =============================================================================
# CACHE - Redis
# =============================================================================

REDIS_URL = config('REDIS_URL', default='redis://localhost:6379/0')

CACHES = {
    'default': {
        'BACKEND': 'django_redis.cache.RedisCache',
        'LOCATION': REDIS_URL,
        'OPTIONS': {
            'CLIENT_CLASS': 'django_redis.client.DefaultClient',
            'IGNORE_EXCEPTIONS': True,  # Graceful degradation if Redis is down
        },
        'KEY_PREFIX': 'lksystem',
    }
}

# Session Engine - Use Redis for sessions
SESSION_ENGINE = 'django.contrib.sessions.backends.cache'
SESSION_CACHE_ALIAS = 'default'

# =============================================================================
# CHANNEL LAYERS - WebSocket (Django Channels)
# =============================================================================

CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        'CONFIG': {
            'hosts': [REDIS_URL],
        },
    }
}

ASGI_APPLICATION = 'core.asgi.application'

# =============================================================================
# PASSWORD VALIDATION
# =============================================================================

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# =============================================================================
# INTERNATIONALIZATION
# =============================================================================

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

# =============================================================================
# STATIC & MEDIA FILES
# =============================================================================

STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [
    BASE_DIR / 'static',
] if (BASE_DIR / 'static').exists() else []

# WhiteNoise configuration for serving static files in production
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'mediafiles'

# File Upload Settings
FILE_UPLOAD_MAX_MEMORY_SIZE = config('FILE_UPLOAD_MAX_MEMORY_SIZE', default=25 * 1024 * 1024, cast=int)  # 25 MB
DATA_UPLOAD_MAX_MEMORY_SIZE = config('DATA_UPLOAD_MAX_MEMORY_SIZE', default=25 * 1024 * 1024, cast=int)  # 25 MB

# =============================================================================
# DEFAULT PRIMARY KEY FIELD TYPE
# =============================================================================

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# =============================================================================
# CORS CONFIGURATION
# =============================================================================

# Frontend URL - Central configuration for frontend integration
FRONTEND_URL = config('FRONTEND_URL', default='http://localhost:5173')

# Allow all origins in development mode
CORS_ALLOW_ALL_ORIGINS = config('CORS_ALLOW_ALL_ORIGINS', default=DEBUG, cast=bool)

# CORS Origins - Read from environment (used when CORS_ALLOW_ALL_ORIGINS is False)
CORS_ALLOWED_ORIGINS = config(
    'CORS_ALLOWED_ORIGINS',
    default='http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:3000,http://127.0.0.1:3000',
    cast=Csv()
)

# CSRF Trusted Origins - Required for Django 4.0+ cross-origin requests
CSRF_TRUSTED_ORIGINS = config(
    'CSRF_TRUSTED_ORIGINS',
    default='http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:3000,http://127.0.0.1:3000',
    cast=Csv()
)

# Always allow credentials (cookies, authorization headers)
CORS_ALLOW_CREDENTIALS = True

# Allowed headers
CORS_ALLOW_HEADERS = [
    'accept',
    'accept-encoding',
    'authorization',
    'content-type',
    'dnt',
    'origin',
    'user-agent',
    'x-csrftoken',
    'x-requested-with',
    'x-brand-id',  # Custom header for brand switching
]

# Allowed methods
CORS_ALLOW_METHODS = [
    'DELETE',
    'GET',
    'OPTIONS',
    'PATCH',
    'POST',
    'PUT',
]

# Expose headers to frontend
CORS_EXPOSE_HEADERS = [
    'content-type',
    'x-total-count',
]

# =============================================================================
# PRODUCTION SECURITY
# =============================================================================

SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SECURE_SSL_REDIRECT = config('SECURE_SSL_REDIRECT', default=False, cast=bool)
SESSION_COOKIE_SECURE = config('SESSION_COOKIE_SECURE', default=not DEBUG, cast=bool)
CSRF_COOKIE_SECURE = config('CSRF_COOKIE_SECURE', default=not DEBUG, cast=bool)
SECURE_HSTS_SECONDS = config('SECURE_HSTS_SECONDS', default=0, cast=int)
SECURE_HSTS_INCLUDE_SUBDOMAINS = config(
    'SECURE_HSTS_INCLUDE_SUBDOMAINS',
    default=False,
    cast=bool,
)
SECURE_HSTS_PRELOAD = config('SECURE_HSTS_PRELOAD', default=False, cast=bool)
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = config('X_FRAME_OPTIONS', default='DENY')

# =============================================================================
# SYSTEM CHECK SILENCING
# =============================================================================
# ``manage.py check --deploy`` (run in CI with ``--fail-level WARNING``) also
# evaluates drf-spectacular's schema-introspection advisories: SerializerMethod
# getters without a return type hint (W001) and APIViews without a declared
# ``serializer_class`` (W002). These only affect the *generated OpenAPI doc*
# quality — never runtime or deploy safety — so they must not gate CI. They are
# still visible when explicitly building the schema:
#   ``manage.py spectacular --file schema.yml``
# The genuine deploy checks (security.W004/W008/W009 etc.) are deliberately NOT
# silenced — those are satisfied with real settings/env, not hidden.
SILENCED_SYSTEM_CHECKS = [
    'drf_spectacular.W001',
    'drf_spectacular.W002',
]

# =============================================================================
# DJANGO REST FRAMEWORK
# =============================================================================

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework_simplejwt.authentication.JWTAuthentication',
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
    # Custom paginator that honours ``?page_size=`` (capped at 500). The
    # default ``PageNumberPagination`` ignores the param, which broke every
    # "fetch all rows" client helper (it always got the configured 20).
    'DEFAULT_PAGINATION_CLASS': 'core.pagination.StandardPagination',
    'PAGE_SIZE': 20,
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ] if not DEBUG else [
        'rest_framework.renderers.JSONRenderer',
        'rest_framework.renderers.BrowsableAPIRenderer',
    ],
    # OpenAPI Schema
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
    # Custom Exception Handler for detailed error logging
    'EXCEPTION_HANDLER': 'core.exceptions.custom_exception_handler',
}

# =============================================================================
# DRF SPECTACULAR (API DOCUMENTATION)
# =============================================================================

SPECTACULAR_SETTINGS = {
    'TITLE': 'LkSystem ERP API',
    'DESCRIPTION': '''
## Modular ERP Backend API

A modern, modular ERP backend built with Django 5+ and Django REST Framework.

### Features
- 🏢 **Multi-Company Support** - Manage multiple companies (only `name` required!)
- 🏷️ **Multi-Brand Architecture** - Each company can have multiple brands
- 📦 **Sales Channels** - WooCommerce & POS integrations with auto-generated API credentials
- 👥 **User Management** - Role-based access with multi-brand switching
- 🔐 **JWT Authentication** - Secure token-based auth

### 🪄 Smart Auto-Generation
- **Company abbreviation**: Auto-generated from name ("Hajji Company" → `HC`)
- **Legal name**: Auto-filled from company name if empty
- **WooCommerce credentials**: Auto-generated on channel creation

### Authentication
All endpoints (except login) require JWT authentication.

```
Authorization: Bearer <access_token>
```

### Getting Started
1. Login via `/api/v1/auth/login/` with your matricule and password
2. Use the returned access token in the Authorization header
3. Refresh tokens via `/api/v1/auth/refresh/` when they expire

### WooCommerce Integration
Create a sales channel with `channel_type: "WOOCOMMERCE"` to auto-generate API credentials.
Use `POST /api/v1/sales-channels/{id}/generate-credentials/` to regenerate credentials.
    ''',
    'VERSION': '1.1.0',
    'SERVE_INCLUDE_SCHEMA': False,
    
    # Security - All endpoints require authentication except /api/schema/ (used internally)
    'SECURITY': [{'Bearer': []}],
    'APPEND_COMPONENTS': {
        'securitySchemes': {
            'Bearer': {
                'type': 'http',
                'scheme': 'bearer',
                'bearerFormat': 'JWT',
                'description': 'JWT Authorization header. Example: "Bearer {token}"',
            }
        }
    },
    
    # Tags for API grouping
    'TAGS': [
        {'name': 'Auth', 'description': 'Authentication & Password Reset (Login, Forgot Password, Reset)'},
        {'name': 'Users', 'description': 'User management endpoints'},
        {'name': 'Roles', 'description': 'Role management endpoints'},
        {'name': 'Profiles', 'description': 'User profile endpoints (auto-linked to User)'},
        {'name': 'Companies', 'description': 'Company management - only name required, auto-generates abbreviation'},
        {'name': 'Brands', 'description': 'Brand management endpoints'},
        {'name': 'Sales Channels', 'description': 'Sales channels with WooCommerce webhook token generation'},
    ],
    
    # Swagger UI settings
    'SWAGGER_UI_SETTINGS': {
        'deepLinking': True,
        'persistAuthorization': True,
        'displayOperationId': False,
        'filter': True,
    },
    
    # Schema generation settings
    'COMPONENT_SPLIT_REQUEST': True,
    'SORT_OPERATIONS': False,
    'SCHEMA_INDENT_ENUM': True,
}

# =============================================================================
# LOGGING
# =============================================================================

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{levelname} {asctime} {module} {process:d} {thread:d} {message}',
            'style': '{',
        },
        'simple': {
            'format': '{levelname} {message}',
            'style': '{',
        },
        'detailed': {
            'format': '[{levelname}] {asctime} | {name} | {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'detailed',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'INFO',
    },
    'loggers': {
        'django': {
            'handlers': ['console'],
            'level': config('DJANGO_LOG_LEVEL', default='INFO'),
            'propagate': False,
        },
        'django.request': {
            'handlers': ['console'],
            'level': 'DEBUG',
            'propagate': False,
        },
        'rest_framework': {
            'handlers': ['console'],
            'level': 'DEBUG',
            'propagate': False,
        },
    },
}

# =============================================================================
# CELERY (optional — app degrades gracefully when Celery is not installed)
# =============================================================================

# Use Redis database 1 for Celery so it's isolated from the app cache (db 0).
# Set these in your .env to enable background tasks.
CELERY_BROKER_URL        = config('CELERY_BROKER_URL',    default='redis://localhost:6379/1')
CELERY_RESULT_BACKEND    = config('CELERY_RESULT_BACKEND', default='redis://localhost:6379/1')

CELERY_ACCEPT_CONTENT    = ['json']
CELERY_TASK_SERIALIZER   = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE          = 'UTC'

# Acknowledge tasks only after they complete (at-least-once delivery).
# Safe because all tasks are idempotent.
CELERY_TASK_ACKS_LATE    = True

# Cap worker memory growth — restart worker process after N tasks.
CELERY_WORKER_MAX_TASKS_PER_CHILD = 200

# Route different workloads to separate queues so they can be scaled independently.
CELERY_TASK_ROUTES = {
    'orders.sync_orders_for_channel': {'queue': 'orders'},
    'orders.sync_all_channels':       {'queue': 'orders'},
    'orders.process_wc_order_webhook':{'queue': 'orders'},
    'orders.submit_order_to_delivery':{'queue': 'delivery'},
    'orders.retry_failed_deliveries': {'queue': 'delivery'},
}

# Default queues (worker must declare these with -Q orders,delivery,default)
CELERY_TASK_DEFAULT_QUEUE = 'default'

# =============================================================================
# DELIVERY PROVIDER
# =============================================================================

# External delivery API settings — set in .env for production.
DELIVERY_API_URL     = config('DELIVERY_API_URL',     default='https://core.jax-delivery.com/api/user/colis/add')
DELIVERY_API_TOKEN   = config('DELIVERY_API_TOKEN',   default='')
DELIVERY_API_TIMEOUT = config('DELIVERY_API_TIMEOUT', default=15, cast=int)

# =============================================================================
# WOOCOMMERCE ORDER STATUS PUSH (local → WooCommerce)
# =============================================================================

# Local is ALWAYS the source of truth. The push is enabled PER CHANNEL in the
# database (``SalesChannel.wc_push_status_enabled``), right next to the store
# credentials — so each store is toggled independently and no env config is
# required. This setting is an OPTIONAL global override for ops:
#   * unset (the default) -> the per-channel flag decides (recommended);
#   * WC_ORDER_PUSH_ENABLED=false -> hard-disable ALL pushes (e.g. a staging box
#     restored from a prod DB so it can never touch the live store);
#   * WC_ORDER_PUSH_ENABLED=true  -> force-enable everywhere.
# A failed push never rolls back the local status; it is recorded for a retry
# (see WooCommerceSyncService).
_wc_push_override = config('WC_ORDER_PUSH_ENABLED', default='').strip().lower()
WC_ORDER_PUSH_ENABLED = (
    None if _wc_push_override == '' else _wc_push_override in ('1', 'true', 'yes', 'on')
)
WC_ORDER_PUSH_TIMEOUT = config('WC_ORDER_PUSH_TIMEOUT', default=30, cast=int)

# =============================================================================
# CUSTOM USER MODEL
# =============================================================================

AUTH_USER_MODEL = 'users.User'

# =============================================================================
# SIMPLE JWT CONFIGURATION
# =============================================================================

from datetime import timedelta

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=1),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'UPDATE_LAST_LOGIN': True,
    
    'ALGORITHM': 'HS256',
    'SIGNING_KEY': SECRET_KEY,
    'VERIFYING_KEY': None,
    'AUDIENCE': None,
    'ISSUER': 'LkSystem',
    
    'AUTH_HEADER_TYPES': ('Bearer',),
    'AUTH_HEADER_NAME': 'HTTP_AUTHORIZATION',
    'USER_ID_FIELD': 'id',
    'USER_ID_CLAIM': 'user_id',
    'USER_AUTHENTICATION_RULE': 'rest_framework_simplejwt.authentication.default_user_authentication_rule',
    
    'AUTH_TOKEN_CLASSES': ('rest_framework_simplejwt.tokens.AccessToken',),
    'TOKEN_TYPE_CLAIM': 'token_type',
    
    'JTI_CLAIM': 'jti',
}

# =============================================================================
# EMAIL CONFIGURATION
# =============================================================================

# Email backend - Console for development, SMTP for production
EMAIL_BACKEND = config(
    'EMAIL_BACKEND',
    default='django.core.mail.backends.console.EmailBackend'
)

# SMTP Settings (for production)
EMAIL_HOST = config('EMAIL_HOST', default='smtp.gmail.com')
EMAIL_PORT = config('EMAIL_PORT', default=587, cast=int)
EMAIL_USE_TLS = config('EMAIL_USE_TLS', default=True, cast=bool)
EMAIL_HOST_USER = config('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = config('EMAIL_HOST_PASSWORD', default='')

# Default email sender
DEFAULT_FROM_EMAIL = config('DEFAULT_FROM_EMAIL', default='LkSystem <noreply@lksystem.com>')

# Password reset settings
PASSWORD_RESET_TIMEOUT = 3600  # 1 hour in seconds
PASSWORD_RESET_TOKEN_EXPIRY_HOURS = 1

