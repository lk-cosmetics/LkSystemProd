# LkSystem Setup Script for Windows PowerShell
# Run: .\setup.ps1

param(
    [switch]$Local,
    [switch]$Docker,
    [switch]$SkipPrerequisites = $false
)

$ErrorActionPreference = "Continue"

# Color functions
function Write-Header {
    param([string]$Text)
    Write-Host "`n" -NoNewline
    Write-Host "=" * 65 -ForegroundColor Cyan
    Write-Host $Text -ForegroundColor Cyan -Bold
    Write-Host "=" * 65 -ForegroundColor Cyan
    Write-Host ""
}

function Write-Success {
    param([string]$Text)
    Write-Host "✅ $Text" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Text)
    Write-Host "⚠️  $Text" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Text)
    Write-Host "❌ $Text" -ForegroundColor Red
}

function Write-Info {
    param([string]$Text)
    Write-Host "ℹ️  $Text" -ForegroundColor Cyan
}

# Check if tool is installed
function Test-ToolInstalled {
    param([string]$ToolName)
    $null = & $ToolName --version 2>$null
    return $LASTEXITCODE -eq 0
}

# Main setup
Write-Host "`n" -NoNewline
Write-Host "╔" + ("═" * 63) + "╗" -ForegroundColor Green
Write-Host "║  LkSystem - Windows PowerShell Setup" + (" " * 27) + "║" -ForegroundColor Green
Write-Host "║  Django 5 + React 19 + PostgreSQL + Docker" + (" " * 20) + "║" -ForegroundColor Green
Write-Host "╚" + ("═" * 63) + "╝`n" -ForegroundColor Green

# Get project paths
$ScriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendPath = Join-Path $ScriptPath "LkSystemBackEnd"
$FrontendPath = Join-Path $ScriptPath "lkSystemFrontEnd"

Write-Info "Script Location: $ScriptPath"
Write-Info "Backend Path: $BackendPath"
Write-Info "Frontend Path: $FrontendPath`n"

# Check prerequisites
if (-not $SkipPrerequisites) {
    Write-Header "Checking Prerequisites"
    
    $PrereqsOK = $true
    
    # Check Python
    if (Test-ToolInstalled "python") {
        $PythonVersion = & python --version 2>&1
        Write-Success "Python found: $PythonVersion"
    }
    else {
        Write-Error "Python not found (required: 3.10+)"
        Write-Info "Download from: https://www.python.org/downloads/"
        $PrereqsOK = $false
    }
    
    # Check Node.js
    if (Test-ToolInstalled "node") {
        $NodeVersion = & node --version 2>&1
        Write-Success "Node.js found: $NodeVersion"
    }
    else {
        Write-Error "Node.js not found (required: 18+)"
        Write-Info "Download from: https://nodejs.org/"
        $PrereqsOK = $false
    }
    
    # Check npm
    if (Test-ToolInstalled "npm") {
        $NpmVersion = & npm --version 2>&1
        Write-Success "npm found: $NpmVersion"
    }
    else {
        Write-Error "npm not found (required: 9+)"
        $PrereqsOK = $false
    }
    
    if (-not $PrereqsOK) {
        Write-Error "`nSome prerequisites are missing!"
        Write-Info "Please install them and run setup again."
        exit 1
    }
}

# Menu if no parameters
if (-not $Local -and -not $Docker) {
    Write-Host "Select setup mode:`n" -ForegroundColor Cyan
    Write-Host "  1. Local Setup (Without Docker)"
    Write-Host "  2. Docker Setup"
    Write-Host "  3. Both (Recommended)"
    Write-Host "  4. Exit`n"
    
    $Choice = Read-Host "Enter choice (1-4)"
    
    switch ($Choice) {
        "1" { $Local = $true }
        "2" { $Docker = $true }
        "3" { $Local = $true; $Docker = $true }
        "4" { Write-Success "Setup canceled"; exit 0 }
        default { Write-Error "Invalid choice"; exit 1 }
    }
}

# ==================== LOCAL SETUP ====================
if ($Local) {
    Write-Header "Backend Setup (Local)"
    
    Set-Location $BackendPath
    
    # Create virtual environment
    if (Test-Path "venv") {
        Write-Warning "Virtual environment already exists"
    }
    else {
        Write-Info "Creating Python virtual environment..."
        & python -m venv venv
        Write-Success "Virtual environment created"
    }
    
    # Activate venv
    Write-Info "Activating virtual environment..."
    & .\venv\Scripts\Activate.ps1
    
    # Upgrade pip
    Write-Info "Upgrading pip..."
    & python -m pip install --upgrade pip setuptools wheel --quiet
    Write-Success "pip upgraded"
    
    # Install requirements
    Write-Info "Installing Python dependencies..."
    & pip install -r requirements.txt --quiet
    Write-Success "Dependencies installed"
    
    # Create .env file
    if (Test-Path ".env") {
        Write-Warning ".env file already exists"
    }
    else {
        Write-Info "Creating .env file..."
        
        $EnvContent = @"
# ===== SECURITY =====
SECRET_KEY=django-insecure-change-me-in-production-minimum-50-chars
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

# ===== CELERY =====
CELERY_BROKER_URL=redis://localhost:6379/1
CELERY_RESULT_BACKEND=redis://localhost:6379/1

# ===== CORS =====
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173

# ===== JWT =====
JWT_SECRET_KEY=your-jwt-secret-key-change-in-production
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=60
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7

# ===== AUTO ADMIN =====
AUTO_CREATE_DEFAULT_ADMIN=True
DEFAULT_ADMIN_MATRICULE=SUPERADMIN-0001
DEFAULT_ADMIN_EMAIL=admin@lksystem.local
DEFAULT_ADMIN_PASSWORD=ChangeMe123!
DEFAULT_ADMIN_FIRST_NAME=Super
DEFAULT_ADMIN_LAST_NAME=Admin

# ===== LOGGING =====
LOG_LEVEL=INFO
"@
        
        Set-Content -Path ".env" -Value $EnvContent
        Write-Success ".env file created"
    }
    
    # Run migrations
    Write-Info "Running database migrations..."
    & python manage.py migrate
    Write-Success "Migrations completed"
    
    # Collect static files
    Write-Info "Collecting static files..."
    & python manage.py collectstatic --noinput --quiet
    Write-Success "Static files collected"
    
    Write-Success "Backend setup completed!`n"
    
    # Frontend setup
    Write-Header "Frontend Setup"
    
    Set-Location $FrontendPath
    
    Write-Info "Installing npm dependencies..."
    & npm install --silent
    Write-Success "npm dependencies installed"
    
    # Create .env.local
    if (Test-Path ".env.local") {
        Write-Warning ".env.local already exists"
    }
    else {
        Write-Info "Creating .env.local..."
        
        $EnvContent = @"
# Backend API Configuration
VITE_API_BASE_URL=http://localhost:8000/api/v1
VITE_API_TIMEOUT=30000

# App Configuration
VITE_APP_TITLE=LkSystem ERP
VITE_APP_ENVIRONMENT=development

# Feature Flags
VITE_ENABLE_ANALYTICS=false
VITE_ENABLE_NOTIFICATIONS=true
"@
        
        Set-Content -Path ".env.local" -Value $EnvContent
        Write-Success ".env.local created"
    }
    
    Write-Success "Frontend setup completed!`n"
}

# ==================== DOCKER SETUP ====================
if ($Docker) {
    Write-Header "Docker Setup"
    
    # Check Docker
    if (-not (Test-ToolInstalled "docker")) {
        Write-Error "Docker is not installed"
        Write-Info "Download from: https://www.docker.com/products/docker-desktop"
        exit 1
    }
    
    Write-Success "Docker found"
    
    Set-Location $BackendPath
    
    # Create .env if not exists
    if (Test-Path ".env") {
        Write-Warning ".env already exists"
    }
    else {
        Write-Info "Creating .env for Docker..."
        
        $EnvContent = @"
# ===== SECURITY =====
SECRET_KEY=django-insecure-change-me-in-production-minimum-50-chars
DEBUG=False
ALLOWED_HOSTS=localhost,127.0.0.1,docker

# ===== DATABASE =====
POSTGRES_ENGINE=django.db.backends.postgresql
POSTGRES_DB=lksystem
POSTGRES_USER=lksystem_user
POSTGRES_PASSWORD=lksystem_password
POSTGRES_HOST=db
POSTGRES_PORT=5432

# ===== REDIS & CACHE =====
REDIS_URL=redis://redis:6379/0
CACHE_URL=redis://redis:6379/1

# ===== CELERY =====
CELERY_BROKER_URL=redis://redis:6379/1
CELERY_RESULT_BACKEND=redis://redis:6379/1

# ===== JWT =====
JWT_SECRET_KEY=your-jwt-secret-key-change-in-production

# ===== AUTO ADMIN =====
AUTO_CREATE_DEFAULT_ADMIN=True
DEFAULT_ADMIN_MATRICULE=SUPERADMIN-0001
DEFAULT_ADMIN_EMAIL=admin@lksystem.local
DEFAULT_ADMIN_PASSWORD=ChangeMe123!
"@
        
        Set-Content -Path ".env" -Value $EnvContent
        Write-Success ".env created for Docker"
    }
    
    Write-Info "Docker environment configured"
}

# ==================== SUMMARY ====================
Write-Header "Setup Complete! 🎉"

Write-Host "📖 Next Steps:`n" -ForegroundColor Cyan

if ($Local) {
    Write-Host "Local Development (3 terminals):`n" -ForegroundColor Yellow
    
    Write-Host "Terminal 1 - PostgreSQL (if not running):" -ForegroundColor White
    Write-Host "  Start PostgreSQL service or run: postgres`n" -ForegroundColor Gray
    
    Write-Host "Terminal 2 - Redis (if not running):" -ForegroundColor White
    Write-Host "  Start Redis service or run: redis-server.exe`n" -ForegroundColor Gray
    
    Write-Host "Terminal 3 - Backend:" -ForegroundColor White
    Write-Host "  cd $BackendPath"
    Write-Host "  .\venv\Scripts\Activate.ps1"
    Write-Host "  python manage.py runserver`n" -ForegroundColor Gray
    
    Write-Host "Terminal 4 - Frontend:" -ForegroundColor White
    Write-Host "  cd $FrontendPath"
    Write-Host "  npm run dev`n" -ForegroundColor Gray
    
    Write-Host "Access:" -ForegroundColor White
    Write-Host "  Frontend:  http://localhost:5173"
    Write-Host "  Backend:   http://localhost:8000"
    Write-Host "  API Docs:  http://localhost:8000/api/docs"
    Write-Host "  Admin:     http://localhost:8000/admin`n" -ForegroundColor Gray
}

if ($Docker) {
    Write-Host "Docker Deployment:`n" -ForegroundColor Yellow
    Write-Host "  cd $BackendPath"
    Write-Host "  docker-compose up -d`n" -ForegroundColor Gray
    
    Write-Host "Access:" -ForegroundColor White
    Write-Host "  Backend:   http://localhost:8000"
    Write-Host "  API Docs:  http://localhost:8000/api/docs"
    Write-Host "  Admin:     http://localhost:8000/admin`n" -ForegroundColor Gray
}

Write-Host "Default Credentials:" -ForegroundColor White
Write-Host "  Username: SUPERADMIN-0001"
Write-Host "  Password: ChangeMe123!`n" -ForegroundColor Gray

Write-Host "Documentation:" -ForegroundColor White
Write-Host "  📄 COMPLETE_SETUP_GUIDE.md (full guide)"
Write-Host "  📄 VENV_BEST_PRACTICES.md (virtual environment)"
Write-Host "  📄 README.md (project overview)`n" -ForegroundColor Gray

Write-Success "All done! Happy coding! 🚀`n"

# Exit with venv still activated (for local setup)
if ($Local) {
    Write-Info "Virtual environment is still activated. Happy coding!"
}
