# Python Virtual Environment (venv) - Professional Best Practices 🎯

## Understanding Virtual Environments

A **virtual environment** is an isolated Python instance that allows you to install project-specific packages without affecting your system Python or other projects.

### Why Virtual Environments Matter

```
❌ WITHOUT venv:
pip install django==5.0  # Installs globally
pip install django==4.2  # ⚠️ Overwrites previous version
Project A breaks! 💥

✅ WITH venv:
Project A venv: django==5.0
Project B venv: django==4.2
Both work perfectly! ✅
```

---

## Setting Up Virtual Environment (Windows)

### Quick Setup

```powershell
# 1. Navigate to project directory
cd LkSystemBackEnd

# 2. Create virtual environment
python -m venv venv

# 3. Activate virtual environment
.\venv\Scripts\Activate.ps1

# 4. You should see (venv) prefix in terminal
# Example: (venv) PS C:\path\to\project>
```

### If You Get Execution Policy Error

```powershell
# Error: "... is not digitally signed"

# Solution 1: Set ExecutionPolicy for current user
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Solution 2: Use alternative activation method
python -m venv venv --prompt=lksystem
.\venv\Scripts\activate.bat  # Use .bat instead of .ps1

# Solution 3: Use cmd.exe instead of PowerShell
cmd.exe
cd LkSystemBackEnd
venv\Scripts\activate.bat
```

### Verifying Virtual Environment

```powershell
# After activating, verify:

# 1. Check Python path (should be in venv)
python -c "import sys; print(sys.executable)"
# Output: C:\path\to\project\venv\Scripts\python.exe ✅

# 2. Check pip location
pip --version
# Output: pip X.X.X from C:\path\to\project\venv\lib\site-packages ...

# 3. List installed packages
pip list

# 4. Verify isolation
pip show django  # Should show venv's django
```

---

## Virtual Environment Operations

### Installation

```powershell
# Install requirements
pip install -r requirements.txt

# Install specific package
pip install django==5.0

# Install package with extras
pip install "celery[redis]"

# Install from specific version
pip install --upgrade pip  # Upgrade pip itself
```

### Dependency Management

```powershell
# Create requirements.txt from current environment
pip freeze > requirements.txt

# Install exactly what's in requirements.txt
pip install -r requirements.txt --no-deps  # Without sub-dependencies

# Check for outdated packages
pip list --outdated

# Upgrade a package safely
pip install --upgrade package-name
```

### Troubleshooting Virtual Environment

```powershell
# 1. Virtual environment is corrupted
# Solution: Delete and recreate
rmdir venv /s /q  # Remove
python -m venv venv  # Recreate
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

# 2. Package conflicts (dependency hell)
# Solution: Use pip-tools
pip install pip-tools
pip-compile requirements.in  # Generates requirements.txt

# 3. Package version not found
pip index versions package-name  # Show available versions
pip install package-name==specific.version

# 4. Corrupted pip cache
pip cache purge  # Clear pip cache
pip install --no-cache-dir -r requirements.txt
```

---

## Deactivating Virtual Environment

```powershell
# When done working, deactivate
deactivate

# Verify (should not see (venv) prefix)
# Example: PS C:\path\to\project>
```

---

## Advanced venv Usage

### Custom Virtual Environment Location

```powershell
# Create in specific location
python -m venv C:\venvs\lksystem

# Activate from anywhere
C:\venvs\lksystem\Scripts\Activate.ps1
```

### Virtual Environment with Custom Prompt

```powershell
# Create with custom prompt
python -m venv venv --prompt "lksystem-dev"

# Terminal will show: (lksystem-dev)
```

### Python Version Specification

```powershell
# Use specific Python version
py -3.12 -m venv venv

# Verify Python version
python --version
```

### Using virtualenv (Alternative)

```powershell
# Install virtualenv
pip install virtualenv

# Create venv with virtualenv
virtualenv venv

# Better compatibility across platforms
```

---

## Virtual Environment File Structure

```
project-root/
  venv/                          # Virtual environment directory
    Scripts/                     # On Windows (bin/ on Linux/Mac)
      python.exe                 # Python executable
      pip.exe                    # Pip executable
      activate.ps1              # Activation script (PowerShell)
      activate.bat              # Activation script (CMD)
      deactivate.bat            # Deactivation script
    Lib/
      site-packages/            # Installed packages
        django/
        rest_framework/
        ...
    Include/
    pyvenv.cfg                   # Virtual environment config
  
  .venv_backup/                  # (Optional) Backup of working venv
  requirements.txt               # Package list
  manage.py
  ...
```

---

## Multi-Environment Setup

### Development vs Production

```powershell
# Create separate requirements files
# requirements-dev.txt
-r requirements.txt
pytest
pytest-django
django-debug-toolbar

# Install
pip install -r requirements-dev.txt  # Includes all + dev packages
```

### Environment-Specific Code

```python
# settings.py
import os

ENVIRONMENT = os.getenv('DJANGO_ENV', 'development')

if ENVIRONMENT == 'production':
    DEBUG = False
    ALLOWED_HOSTS = ['yourdomain.com']
else:
    DEBUG = True
    ALLOWED_HOSTS = ['localhost', '127.0.0.1']
```

---

## Virtual Environment as PowerShell Function

Create a reusable activation function:

```powershell
# Add to PowerShell profile (notepad $PROFILE)

function Activate-Venv {
    param([string]$path = ".")
    & "$path\venv\Scripts\Activate.ps1"
}

function Deactivate-Venv {
    deactivate
}

# Usage:
# Activate-Venv
# Deactivate-Venv
```

---

## Common venv Mistakes

### ❌ Mistake 1: Committing venv to Git

```powershell
# Don't do this!
git add venv/              # ❌ WRONG
git commit -m "Add venv"

# Do this instead:
# 1. Create .gitignore
# 2. Add "venv/" to .gitignore
echo "venv/" >> .gitignore
git add .gitignore
git commit -m "Add .gitignore"
```

### ❌ Mistake 2: Installing with Wrong pip

```powershell
# ❌ WRONG - Uses system pip
pip install -r requirements.txt

# ✅ CORRECT - Uses venv pip
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Verify you're using correct pip:
which pip  # Should show venv path
```

### ❌ Mistake 3: Sharing venv Directory

```powershell
# ❌ WRONG - Venv is platform/Python-version specific
# Don't copy venv between computers!

# ✅ CORRECT - Share requirements.txt and recreate venv
git push requirements.txt
# Other team member:
pip install -r requirements.txt
```

### ❌ Mistake 4: Installing Without Activating

```powershell
# ❌ WRONG - Installs to system Python
python -m pip install django

# ✅ CORRECT - Activate first
.\venv\Scripts\Activate.ps1
python -m pip install django
```

---

## Performance Tips

### Faster Dependency Installation

```powershell
# 1. Use wheel format (binary packages)
pip install --only-binary :all: -r requirements.txt

# 2. Skip dependency resolution
pip install --no-deps -r requirements.txt

# 3. Use cache
pip install --cache-dir ./pip_cache -r requirements.txt

# 4. Parallel installation (with pip-tools)
pip install pip-tools
pip-sync requirements.txt --pip-args "-q"
```

### Lock Exact Dependencies

```powershell
# Use pip-tools for reproducible installations
pip install pip-tools

# Create requirements.in (loose constraints)
# Example:
# django>=5.0,<6.0
# djangorestframework>=3.14

# Generate exact requirements.txt
pip-compile requirements.in

# Result: requirements.txt with exact versions
# django==5.0.1
# djangorestframework==3.14.2
```

---

## Checking venv Health

```powershell
# Complete health check script
function Test-VenvHealth {
    Write-Host "Virtual Environment Health Check" -ForegroundColor Green
    Write-Host "==============================" -ForegroundColor Green
    
    # Check activation
    Write-Host "`nPython Path:"
    python -c "import sys; print(sys.executable)"
    
    # Check pip
    Write-Host "`nPip Version:"
    pip --version
    
    # Check Django installation
    Write-Host "`nDjango:"
    python -c "import django; print(f'Version: {django.VERSION}')" 2>$null || Write-Host "NOT INSTALLED"
    
    # Check installed packages count
    Write-Host "`nTotal Packages:"
    pip list | Measure-Object -Line | Select-Object -ExpandProperty Lines | Measure-Object | ForEach-Object { $_.Count - 2 }
    
    # Check for security issues
    Write-Host "`nSecure Installation Check:"
    pip check 2>$null || Write-Host "Issues found"
}

# Run it:
Test-VenvHealth
```

---

## Summary Checklist

- ✅ Create venv: `python -m venv venv`
- ✅ Activate: `.\venv\Scripts\Activate.ps1`
- ✅ Install: `pip install -r requirements.txt`
- ✅ Verify: `pip --version` shows venv path
- ✅ Add venv to .gitignore
- ✅ Share requirements.txt, not venv folder
- ✅ Always activate before running `pip` or `python`
- ✅ Use requirements.txt for dependency management
- ✅ Deactivate when done: `deactivate`

---

**Master your venv! They're the foundation of Python development.** 🐍

