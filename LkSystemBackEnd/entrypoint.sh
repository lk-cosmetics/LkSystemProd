#!/bin/bash
set -e

# Resolve connection details with safe defaults
POSTGRES_HOST="${POSTGRES_HOST:-db}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
REDIS_HOST="${REDIS_HOST:-redis}"
REDIS_PORT="${REDIS_PORT:-6379}"

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL at ${POSTGRES_HOST}:${POSTGRES_PORT}..."
until nc -z "$POSTGRES_HOST" "$POSTGRES_PORT"; do
    echo "  PostgreSQL not ready — retrying in 1s..."
    sleep 1
done
echo "PostgreSQL is ready!"

# Wait for Redis to be ready
echo "Waiting for Redis at ${REDIS_HOST}:${REDIS_PORT}..."
until nc -z "$REDIS_HOST" "$REDIS_PORT"; do
    echo "  Redis not ready — retrying in 1s..."
    sleep 1
done
echo "Redis is ready!"

RUN_STARTUP_TASKS=${RUN_STARTUP_TASKS:-True}
if [ "$RUN_STARTUP_TASKS" = "True" ] || [ "$RUN_STARTUP_TASKS" = "true" ]; then
    # Run migrations
    echo "Running migrations..."
    python manage.py migrate --noinput

    # Collect static files
    echo "Collecting static files..."
    python manage.py collectstatic --noinput --clear

    # Auto-create default SUPERADMIN if no superuser exists
    AUTO_CREATE_DEFAULT_ADMIN=${AUTO_CREATE_DEFAULT_ADMIN:-True}
    if [ "$AUTO_CREATE_DEFAULT_ADMIN" = "True" ] || [ "$AUTO_CREATE_DEFAULT_ADMIN" = "true" ]; then
        echo "Checking for existing superadmin..."
        python manage.py shell <<'PYCODE'
from apps.users.models import User
import os

matricule = os.getenv('DEFAULT_ADMIN_MATRICULE', 'SUPERADMIN-0001').upper()
email = os.getenv('DEFAULT_ADMIN_EMAIL', 'superadmin@lksystem.local')
password = os.getenv('DEFAULT_ADMIN_PASSWORD', 'ChangeMe123!')
first_name = os.getenv('DEFAULT_ADMIN_FIRST_NAME', 'Super')
last_name = os.getenv('DEFAULT_ADMIN_LAST_NAME', 'Admin')

if User.objects.filter(is_superuser=True).exists():
    print('Superadmin already exists. Skipping default admin creation.')
else:
    user = User.objects.create_superuser(
        matricule=matricule,
        email=email,
        password=password,
        first_name=first_name,
        last_name=last_name,
    )
    print(f'Default SUPERADMIN created: {user.matricule}')
PYCODE
    fi

    # Seed RBAC permissions and system roles
    echo "Seeding RBAC permissions and roles..."
    python manage.py seed_rbac
else
    echo "Skipping startup database/static tasks for this process."
fi

# Execute the main command
exec "$@"
