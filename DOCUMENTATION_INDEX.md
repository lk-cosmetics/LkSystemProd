# LkSystem Documentation Index 📚

**Your complete guide to running the LkSystem ERP application locally and with Docker.**

---

## 🚀 Quick Navigation

Choose your path based on your needs:

| Your Situation | Read This | Time |
|---|---|---|
| **First time setup** | [Complete Setup Guide](#complete-setup-guide) | 30 min |
| **Just want to run the app** | [Quick Start](#quick-start-5-minutes) | 5 min |
| **Need setup automation** | [Setup Scripts](#setup-scripts) | <1 min |
| **Virtual environment help** | [venv Best Practices](#venv-best-practices) | 15 min |
| **Something is broken** | [Troubleshooting Guide](#troubleshooting-guide) | Varies |
| **Command reference** | [Quick Reference](#quick-reference) | Lookup |
| **Docker deployment** | [Complete Setup Guide - Docker Section](#docker-setup) | 20 min |
| **System design diagrams** | [System Design Diagrams](#system-design-diagrams) | 15 min |

---

## 📖 Documentation Structure

### 1. **COMPLETE_SETUP_GUIDE.md**
**The Comprehensive Guide** - Everything you need to know about setting up and running the project.

**Covers:**
- ✅ System prerequisites and requirements
- ✅ Local setup without Docker (step-by-step)
- ✅ Docker setup and management
- ✅ Frontend (React) setup
- ✅ Backend (Django) setup
- ✅ Environment variables
- ✅ Running applications (3 different ways)
- ✅ Verification and testing
- ✅ Common issues and solutions

**When to use:**
- First time setting up the project
- Need detailed explanations
- Want to understand the architecture
- Setting up both local and Docker

**Key Sections:**
- PostgreSQL & Redis setup
- CREATE DATABASE and users
- Virtual environment management
- Backend migrations and migrations
- Frontend npm installation
- Access points for all services

---

### 2. **VENV_BEST_PRACTICES.md**
**Python Virtual Environment Mastery** - Complete guide to virtual environments (venv).

**Covers:**
- ✅ WHY virtual environments matter
- ✅ Creating and activating venv
- ✅ Installing dependencies
- ✅ Common venv mistakes
- ✅ Troubleshooting venv issues
- ✅ Performance optimization
- ✅ Advanced usage (custom locations, Python versions)
- ✅ Environment-specific setups

**When to use:**
- Understanding Python virtual environments
- Fixing venv activation issues
- Managing dependencies
- Sharing project with team
- "ModuleNotFoundError" or similar issues

**Pro Tips Section:**
- PowerShell functions for easy activation
- pip-tools for locked dependencies
- Health check scripts
- Multi-environment setup

---

### 3. **QUICK_REFERENCE.md**
**Command Cheat Sheet** - Fast lookup for all common commands.

**Covers:**
- ✅ Backend commands (Django, migrations, testing)
- ✅ Frontend commands (npm, build, dev)
- ✅ Docker commands (compose, logs, cleanup)
- ✅ Database commands (psql, Redis, backups)
- ✅ Common workflows
- ✅ API testing with curl/Postman
- ✅ Performance monitoring
- ✅ Git integration tips

**When to use:**
- You know what you want to do but forgot the command
- Quick command lookup during development
- Copy-paste ready commands
- Emergency recovery commands

**Quick Access:**
- TL;DR section for 10-minute setup
- Common workflows (daily dev, database changes, dependencies)
- Pro tips and shortcuts

---

### 4. **SYSTEM_DESIGN_DIAGRAMS.md**
**System Design Diagrams** - Module-by-module use case, workflow, sequence, normalized class diagrams, and database normalization notes.

**Covers:**
- Global system context
- Module dependency diagram
- Frontend navigation workflow
- Authentication, users, and RBAC flows
- Company, brand, and sales channel flows
- Product, category, inventory, promotion, client, order, POS, webhook, and delivery flows
- End-to-end business workflow
- Normalization rules
- Class diagrams for each module without visual self-loops

**When to use:**
- Preparing PFE report diagrams
- Explaining project architecture
- Understanding how modules communicate
- Presenting backend/frontend workflows

---

### 5. **TROUBLESHOOTING_GUIDE.md**
**Problem Solver** - Comprehensive troubleshooting for all common issues.

**Covers:**
- ✅ Installation issues (Python, Node, pip)
- ✅ Backend errors (Django, database, migrations)
- ✅ Frontend errors (npm, CORS, TypeScript)
- ✅ Database issues (PostgreSQL connection, constraints)
- ✅ Docker issues (daemon, images, networks)
- ✅ Performance problems
- ✅ Security issues
- ✅ Emergency recovery

**When to use:**
- Something is broken
- Error message appears
- Service won't start
- Need emergency recovery
- Security concerns

**Issue Categories:**
- Installation issues (5 subcategories)
- Backend issues (8 subcategories)
- Frontend issues (6 subcategories)
- Database issues (6 subcategories)
- Docker issues (8 subcategories)
- Performance & Security issues

---

### 6. **setup.py** & **setup.ps1**
**Automated Setup Scripts** - One-command setup for everything.

**What they do:**
- ✅ Check prerequisites
- ✅ Create virtual environment
- ✅ Install dependencies
- ✅ Create .env files
- ✅ Run migrations
- ✅ Setup frontend
- ✅ Configure Docker (optional)

**How to use:**

```powershell
# Python version (recommended)
python setup.py

# PowerShell version (Windows)
.\setup.ps1
```

**When to use:**
- First time setup
- Want hands-off automation
- Setting up on new machine
- Team onboarding

---

## 🎯 Choose Your Guide

### 🆕 **I'm Setting Up for the First Time**
1. Read: [Prerequisites](#prerequisites-section) → 5 min
2. Run: `python setup.py` or `.\setup.ps1` → 10 min
3. Follow the script prompts → 5 min
4. Access at http://localhost:5173 ✅

### 💻 **I'm Already Familiar with Django/React**
1. Read: [QUICK_REFERENCE.md](#quick-reference) → 2 min
2. Run: `python setup.py --Local` → 15 min
3. `python manage.py runserver` in one terminal
4. `npm run dev` in another terminal ✅

### 🐳 **I Want to Use Docker**
1. Install Docker Desktop → 5 min
2. Run: `python setup.py --Docker` → 5 min
3. `docker-compose up -d` → 2 min
4. Access at http://localhost:8000 ✅

### 🔧 **Something is Broken**
1. Check [TROUBLESHOOTING_GUIDE.md](#troubleshooting-guide)
2. Find your issue in the table of contents
3. Follow the solution steps
4. If still stuck: Check logs with `docker-compose logs -f`

### 📚 **I Want to Understand Everything**
1. Read [COMPLETE_SETUP_GUIDE.md](#complete-setup-guide) → 30 min
2. Read [VENV_BEST_PRACTICES.md](#venv-best-practices) → 15 min
3. Read [QUICK_REFERENCE.md](#quick-reference) → 10 min
4. Bookmark [TROUBLESHOOTING_GUIDE.md](#troubleshooting-guide) → For reference

---

## 🏗️ Project Structure

```
LkSystemBackEnd/
├── apps/                          # Micro-app architecture
│   ├── users/                     # User & RBAC management (START HERE)
│   ├── company/                   # Company management  
│   ├── brands/                    # Brand management
│   ├── sales_channels/            # Sales channel management
│   ├── categories/                # WooCommerce categories
│   ├── products/                  # WooCommerce products
│   ├── inventory/                 # Inventory management
│   ├── orders/                    # Order management
│   ├── clients/                   # Client management
│   ├── promotions/                # Promotions engine
│   └── rbac/                      # Role-based access control
│
├── core/                          # Django core settings
│   ├── settings.py                # Configuration
│   ├── urls.py                    # URL routing
│   ├── services/                  # Centralized services
│   └── webhooks/                  # Webhook system
│
├── manage.py                      # Django CLI
├── requirements.txt               # Python dependencies
├── docker-compose.yml             # Docker configuration
└── .env                          # Environment variables

lkSystemFrontEnd/
├── src/
│   ├── components/                # React components
│   ├── pages/                     # Page components
│   ├── services/                  # API services
│   ├── hooks/                     # Custom hooks
│   ├── contexts/                  # React contexts
│   ├── store/                     # State management
│   ├── lib/                       # Utilities
│   └── types/                     # TypeScript types
│
├── package.json                   # Dependencies
├── vite.config.ts                 # Build configuration
└── tsconfig.json                  # TypeScript configuration
```

---

## 🔑 Key Endpoints

### Backend Services

| Service | Port | URL | Protected |
|---------|------|-----|-----------|
| Django Dev Server | 8000 | http://localhost:8000 | No |
| API Endpoints | 8000 | http://localhost:8000/api/v1 | Yes (JWT) |
| API Documentation | 8000 | http://localhost:8000/api/docs | Yes (JWT) |
| Django Admin | 8000 | http://localhost:8000/admin | Yes (Django) |
| PostgreSQL | 5432 | localhost:5432 | Yes (password) |
| Redis | 6379 | localhost:6379 | No |

### Frontend Services

| Service | Port | URL |
|---------|------|-----|
| React Dev Server | 5173 | http://localhost:5173 |
| Vite Preview | 4173 | http://localhost:4173 |

---

## 👤 Default Credentials

**Important**: Change these in production!

```
Admin User:
  Matricule: SUPERADMIN-0001
  Password:  ChangeMe123!
  Email:     admin@lksystem.local

Database:
  User:     lksystem_user
  Password: lksystem_password
  Database: lksystem
```

---

## 🛠️ Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Backend** | Django + DRF | 5.0+ / 3.14+ |
| **Frontend** | React + TypeScript + Vite | 19 / Latest / Latest |
| **Database** | PostgreSQL | 15 |
| **Cache** | Redis | 7 |
| **Task Queue** | Celery (optional) | 5.3+ |
| **WebSocket** | Channels | 4.0+ |
| **Documentation** | drf-spectacular | 0.27+ |

---

## 📋 Pre-Flight Checklist

Before you start, make sure you have:

- [ ] Python 3.10+ installed (`python --version`)
- [ ] Node.js 18+ installed (`node --version`)
- [ ] npm 9+ installed (`npm --version`)
- [ ] Git installed (`git --version`)
- [ ] PostgreSQL 15+ (`pg_isready`)
- [ ] Redis 7+ (`redis-cli ping`)
- [ ] Docker Desktop (optional, for Docker setup)

---

## 🎓 Learning Path

### Week 1: Foundation
1. Complete Setup Guide → Understand the architecture
2. VENV Best Practices → Master Python virtual environments
3. Local Setup → Get it running

### Week 2: Development
1. QUICK_REFERENCE → Learn common commands  
2. Django documentation → Understand the backend
3. React documentation → Understand the frontend

### Week 3: Advanced
1. Docker Mastery → Container orchestration
2. API Development → Build new endpoints
3. Frontend Components → Build React features

---

## 🚨 Quick Troubleshooting (Most Common)

### "I can't access http://localhost:5173"
```powershell
# Check if frontend is running
npm run dev  # In lkSystemFrontEnd directory
```

### "Backend API returns 401"
```powershell
# Clear localStorage and login again
# F12 → Application → Storage → Clear All
# Then refresh http://localhost:5173 and login
```

### "Database connection error"
```powershell
# Start PostgreSQL
net start postgresql-x64-15
# Or: postgres -D "C:\Program Files\PostgreSQL\15\data"
```

### "Port already in use"
```powershell
# Find process: netstat -ano | findstr :8000
# Kill it: taskkill /PID 12345 /F
# Or use different port: python manage.py runserver 8080
```

### "ModuleNotFoundError"
```powershell
# Activate venv first!
.\venv\Scripts\Activate.ps1
# Then install requirements
pip install -r requirements.txt
```

**More issues?** → See [TROUBLESHOOTING_GUIDE.md](#troubleshooting-guide)

---

## 📞 Getting Help

1. **Check the logs**: `docker-compose logs -f web` or terminal output
2. **Read the error**: Most errors have clear messages
3. **Search TROUBLESHOOTING_GUIDE.md**: It covers 99% of issues
4. **Check QUICK_REFERENCE.md**: For command syntax
5. **Read comments in code**: They explain the "why"

## 📄 All Documentation Files

| File | Purpose | Best For |
|------|---------|----------|
| **COMPLETE_SETUP_GUIDE.md** | Complete setup instructions | Newcomers, detailed learning |
| **VENV_BEST_PRACTICES.md** | Virtual environment guide | Python environment issues |
| **QUICK_REFERENCE.md** | Command cheat sheet | Experienced developers |
| **TROUBLESHOOTING_GUIDE.md** | Problem solver | Debugging issues |
| **SYSTEM_DESIGN_DIAGRAMS.md** | Use case, workflow, sequence, normalization, and class diagrams | PFE report, architecture presentation |
| **setup.py** | Automated setup (Python) | Quick automated setup |
| **setup.ps1** | Automated setup (PowerShell) | Quick Windows setup |
| **README.md** | Project overview | Architecture understanding |

---

## 🎉 You're Ready!

Pick your guide above and start building! The LkSystem project is well-documented and straightforward to setup.

### Recommended First Steps:
1. Run `python setup.py` or `.\setup.ps1`
2. Start the backend: `python manage.py runserver`
3. Start the frontend: `npm run dev`  
4. Access http://localhost:5173
5. Login with SUPERADMIN-0001 / ChangeMe123!
6. Explore the API at http://localhost:8000/api/docs

---

**Questions?** Check the appropriate guide above. Happy coding! 🚀

---

**Last Updated**: March 30, 2026  
**Status**: Production Ready ✅  
**Version**: 1.0 - Complete Documentation Suite

