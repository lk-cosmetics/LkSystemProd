#!/usr/bin/env python3
"""
LkSystem Setup Script - Automated Initial Setup
Handles:
- Virtual environment creation
- Dependency installation
- Database initialization
- Environment file generation
- Static file collection
"""

import os
import sys
import subprocess
import json
from pathlib import Path
from typing import Optional, Dict

class Colors:
    """ANSI color codes"""
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    BLUE = '\033[94m'
    RESET = '\033[0m'
    BOLD = '\033[1m'

def print_header(text: str):
    """Print colored header"""
    print(f"\n{Colors.BOLD}{Colors.BLUE}{'='*60}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}{text}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}{'='*60}{Colors.RESET}\n")

def print_success(text: str):
    """Print success message"""
    print(f"{Colors.GREEN}✅ {text}{Colors.RESET}")

def print_warning(text: str):
    """Print warning message"""
    print(f"{Colors.YELLOW}⚠️  {text}{Colors.RESET}")

def print_error(text: str):
    """Print error message"""
    print(f"{Colors.RED}❌ {text}{Colors.RESET}")

def run_command(cmd: list, description: str = "", check: bool = True) -> bool:
    """Run shell command and handle output"""
    try:
        if description:
            print(f"\n{description}...")
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=check
        )
        
        if check and result.returncode != 0:
            print_error(f"Command failed: {' '.join(cmd)}")
            if result.stderr:
                print_error(f"Error: {result.stderr}")
            return False
        
        return True
    except FileNotFoundError:
        print_error(f"Command not found: {cmd[0]}")
        return False
    except Exception as e:
        print_error(f"Error running command: {str(e)}")
        return False

def check_tool_installed(tool: str, version_cmd: Optional[list] = None) -> bool:
    """Check if a tool is installed"""
    try:
        if version_cmd is None:
            version_cmd = [tool, "--version"]
        
        subprocess.run(version_cmd, capture_output=True, check=True, timeout=5)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return False

def create_env_file(backend_path: Path, values: Dict[str, str]):
    """Create .env file with provided values"""
    env_file = backend_path / ".env"
    
    env_content = f"""# ===== SECURITY =====
SECRET_KEY={values.get('SECRET_KEY', 'your-secret-key-change-in-production')}
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1,127.0.0.1:3000,127.0.0.1:5173

# ===== DATABASE =====
POSTGRES_ENGINE=django.db.backends.postgresql
POSTGRES_DB=lksystem
POSTGRES_USER=lksystem_user
POSTGRES_PASSWORD=lksystem_password
POSTGRES_HOST={values.get('POSTGRES_HOST', 'localhost')}
POSTGRES_PORT={values.get('POSTGRES_PORT', '5432')}

# ===== REDIS & CACHE =====
REDIS_URL={values.get('REDIS_URL', 'redis://localhost:6379/0')}
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
"""
    
    with open(env_file, 'w') as f:
        f.write(env_content)
    
    return env_file

def setup_backend(backend_path: Path, use_docker: bool = False) -> bool:
    """Setup Django backend"""
    print_header("Backend Setup")
    
    # Change to backend directory
    os.chdir(backend_path)
    
    # Create virtual environment
    if not use_docker:
        print_success("Creating Python virtual environment...")
        venv_path = backend_path / "venv"
        
        if venv_path.exists():
            print_warning("Virtual environment already exists")
        else:
            if not run_command(
                [sys.executable, "-m", "venv", str(venv_path)],
                "Creating virtual environment"
            ):
                return False
        
        # Activate and install dependencies
        if sys.platform == "win32":
            activate_cmd = str(venv_path / "Scripts" / "activate.bat")
            pip_cmd = str(venv_path / "Scripts" / "pip")
        else:
            activate_cmd = str(venv_path / "bin" / "activate")
            pip_cmd = str(venv_path / "bin" / "pip")
        
        # Install requirements
        if not run_command(
            [pip_cmd, "install", "--upgrade", "pip", "setuptools", "wheel"],
            "Upgrading pip"
        ):
            return False
        
        if not run_command(
            [pip_cmd, "install", "-r", "requirements.txt"],
            "Installing Python dependencies"
        ):
            return False
    
    # Create .env file
    print_success("Creating .env file...")
    env_file = create_env_file(backend_path, {
        'POSTGRES_HOST': 'db' if use_docker else 'localhost',
        'POSTGRES_PORT': '5432',
        'REDIS_URL': 'redis://redis:6379/0' if use_docker else 'redis://localhost:6379/0',
    })
    print_success(f"Created {env_file}")
    
    if not use_docker:
        # Get python executable
        if sys.platform == "win32":
            python_exe = str(backend_path / "venv" / "Scripts" / "python")
        else:
            python_exe = str(backend_path / "venv" / "bin" / "python")
        
        # Run migrations
        if not run_command(
            [python_exe, "manage.py", "migrate"],
            "Running database migrations"
        ):
            print_warning("Migration failed - ensure database is running")
        
        # Collect static files
        if not run_command(
            [python_exe, "manage.py", "collectstatic", "--noinput"],
            "Collecting static files"
        ):
            print_warning("Static file collection failed")
    
    print_success("Backend setup completed!")
    return True

def setup_frontend(frontend_path: Path) -> bool:
    """Setup React frontend"""
    print_header("Frontend Setup")
    
    os.chdir(frontend_path)
    
    # Check Node.js
    if not check_tool_installed("node"):
        print_error("Node.js is not installed")
        print_warning("Download from https://nodejs.org/")
        return False
    
    print_success("Node.js is installed")
    
    # Install npm dependencies
    if not run_command(
        ["npm", "install"],
        "Installing npm dependencies"
    ):
        return False
    
    # Create .env.local file
    frontend_env = frontend_path / ".env.local"
    if not frontend_env.exists():
        env_content = """# Backend API Configuration
VITE_API_BASE_URL=http://localhost:8000/api/v1
VITE_API_TIMEOUT=30000

# App Configuration
VITE_APP_TITLE=LkSystem ERP
VITE_APP_ENVIRONMENT=development

# Feature Flags
VITE_ENABLE_ANALYTICS=false
VITE_ENABLE_NOTIFICATIONS=true
"""
        with open(frontend_env, 'w') as f:
            f.write(env_content)
        print_success(f"Created {frontend_env}")
    else:
        print_warning(".env.local already exists")
    
    print_success("Frontend setup completed!")
    return True

def check_prerequisites() -> bool:
    """Check all prerequisites"""
    print_header("Checking Prerequisites")
    
    checks = {
        "Python": (lambda: check_tool_installed("python", ["python", "--version"]), "Python 3.10+"),
        "Node.js": (lambda: check_tool_installed("node"), "Node.js 18+"),
        "npm": (lambda: check_tool_installed("npm"), "npm 9+"),
    }
    
    all_good = True
    for tool, (check_fn, requirement) in checks.items():
        if check_fn():
            print_success(f"{tool} is installed ({requirement})")
        else:
            print_error(f"{tool} is not installed (required: {requirement})")
            all_good = False
    
    return all_good

def main():
    """Main setup script"""
    print(f"\n{Colors.BOLD}{Colors.GREEN}")
    print("╔════════════════════════════════════════════════════════╗")
    print("║     LkSystem - Full Stack Setup                        ║")
    print("║     Django 5 + React 19 + PostgreSQL + Redis          ║")
    print("╚════════════════════════════════════════════════════════╝")
    print(f"{Colors.RESET}\n")
    
    # Determine project root
    script_dir = Path(__file__).parent.absolute()
    backend_path = script_dir / "LkSystemBackEnd"
    frontend_path = script_dir / "lkSystemFrontEnd"
    
    # Menu
    print("Select setup mode:\n")
    print("1. Local Setup (Without Docker)")
    print("2. Docker Setup")
    print("3. Both")
    print("4. Exit\n")
    
    choice = input("Enter choice (1-4): ").strip()
    
    if choice == "4":
        print_success("Setup canceled")
        return
    
    use_docker = choice in ["2", "3"]
    use_local = choice in ["1", "3"]
    
    # Prerequisites check
    if not check_prerequisites():
        print_error("\nSome prerequisites are missing. Please install them and try again.")
        return
    
    # Backend setup
    if use_local:
        if not setup_backend(backend_path, use_docker=False):
            print_error("\nBackend setup failed")
            return
    
    # Frontend setup
    if use_local:
        if not setup_frontend(frontend_path):
            print_error("\nFrontend setup failed")
            return
    
    # Docker setup
    if use_docker:
        print_header("Docker Setup")
        
        if not check_tool_installed("docker"):
            print_error("Docker is not installed")
            print_warning("Download from https://www.docker.com/products/docker-desktop")
        else:
            print_success("Docker is installed")
            
            # Create .env for Docker
            if setup_backend(backend_path, use_docker=True):
                print_success("Docker environment configured")
                print("\nNext steps:")
                print("1. Navigate to", backend_path)
                print("2. Run: docker-compose up -d")
    
    # Summary
    print_header("Setup Complete! 🎉")
    
    if use_local:
        print("\n📖 Next Steps for Local Development:\n")
        print("Terminal 1 - Backend:")
        print(f"  cd {backend_path}")
        if sys.platform == "win32":
            print(f"  .\\venv\\Scripts\\Activate.ps1")
        else:
            print(f"  source venv/bin/activate")
        print("  python manage.py runserver\n")
        
        print("Terminal 2 - Frontend:")
        print(f"  cd {frontend_path}")
        print("  npm run dev\n")
        
        print("Access:")
        print("  Frontend: http://localhost:5173")
        print("  Backend:  http://localhost:8000")
        print("  API Docs: http://localhost:8000/api/docs\n")
    
    if use_docker:
        print("\n🐳 Next Steps for Docker:\n")
        print(f"  cd {backend_path}")
        print("  docker-compose up -d\n")
        print("Access:")
        print("  Backend:  http://localhost:8000")
        print("  API Docs: http://localhost:8000/api/docs\n")
    
    print("📚 For detailed information, see:")
    print("  - COMPLETE_SETUP_GUIDE.md (full guide)")
    print("  - VENV_BEST_PRACTICES.md (virtual environment guide)\n")
    
    print_success("All done! Happy coding! 🚀\n")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print_error("\nSetup interrupted by user")
        sys.exit(1)
    except Exception as e:
        print_error(f"Unexpected error: {str(e)}")
        sys.exit(1)
