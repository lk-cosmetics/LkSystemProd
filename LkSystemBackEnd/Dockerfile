# LkSystem Backend - Optimized Multi-stage Dockerfile

FROM python:3.11-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /build

# Build-only dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    libjpeg-dev \
    zlib1g-dev \
    libpng-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt


FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

WORKDIR /app

# Runtime-only dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    libjpeg62-turbo \
    zlib1g \
    libpng16-16 \
    netcat-traditional \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
COPY --from=builder /wheels /wheels
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir /wheels/* \
    && rm -rf /wheels

COPY . .

RUN mkdir -p /app/staticfiles /app/mediafiles \
    && chmod +x /app/entrypoint.sh

RUN addgroup --system django \
    && adduser --system --ingroup django django \
    && chown -R django:django /app

USER django

ENTRYPOINT ["/app/entrypoint.sh"]

EXPOSE 8000

# gthread workers: requests regularly block on outbound I/O (WooCommerce sync
# and status pushes, JAX delivery submissions). With 3 sync workers, three such
# calls starve every other request and the SPA's API calls time out client-side.
# 3 processes x 8 threads = 24 concurrent requests for the same memory budget.
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "3", "--worker-class", "gthread", "--threads", "8", "--timeout", "240", "--graceful-timeout", "30", "core.wsgi:application"]
