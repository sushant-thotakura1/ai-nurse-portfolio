# Docker Deployment Guide

This guide will help you run the AI Nurse POC application using Docker. Everything is containerized for easy deployment and sharing across different systems.

## Prerequisites

- **Docker Desktop** (Windows/Mac) or **Docker Engine** (Linux)
  - Download from: https://www.docker.com/products/docker-desktop
  - Minimum version: Docker 20.10+ and Docker Compose 2.0+
- **Git** (to clone the repository)

## Quick Start (One Command Setup)

### 1. Clone the Repository
```bash
git clone https://github.com/REAN-Foundation/ai-nurse-poc.git
cd ai-nurse-poc
```

### 2. Configure Environment Variables
```bash
# Copy the production environment template
cp .env.production.example .env.production

# Edit .env.production with your API keys and passwords
# Required fields:
#   - DB_PASSWORD
#   - SARVAM_API_KEY
#   - OPENAI_API_KEY
#   - JWT_SECRET
#   - ENCRYPTION_KEY
```

**Generate Secure Keys:**
```bash
# Generate JWT_SECRET (Linux/Mac/Git Bash)
openssl rand -base64 32

# Generate ENCRYPTION_KEY (Linux/Mac/Git Bash)
openssl rand -hex 32

# On Windows PowerShell (alternative)
# JWT_SECRET: Generate a random 32+ character string
# ENCRYPTION_KEY: Generate a random 64 character hex string
```

### 3. Start Everything with One Command
```bash
docker-compose --env-file .env.production up -d
```

That's it! The application will:
1. Start PostgreSQL with pgvector extension
2. Build and start the backend API
3. Build and start the frontend
4. Run database migrations automatically

### 4. Access the Application

- **Frontend (Admin Dashboard):** http://localhost:3001 (override with `FRONTEND_PORT`)
- **Screening wizard:** http://localhost:5180/<tenant-slug> (e.g. `/default-tenant`; override the port with `SCREENING_WEB_PORT`) — the first path segment is the tenant slug, so one deployment serves many tenants; the root path shows a "missing clinic code" message. Only usable for a tenant that has the `screening` capability enabled (Super Admin → Tenants → Capabilities)
- **Backend API:** http://localhost:3000 (proxied through both frontends)
- **Database:** localhost:5433 (if you need direct access)

## Container Architecture

The application runs in **3 containers**:

```
┌─────────────────────────────────────────────┐
│          Docker Compose Network             │
│                                             │
│  ┌───────────────┐  ┌──────────────┐      │
│  │   Frontend    │  │   Backend    │      │
│  │   (Nginx)     │──│  (Node.js)   │      │
│  │   Port: 80    │  │  Port: 3000  │      │
│  └───────────────┘  └──────┬───────┘      │
│         │                   │               │
│  External: 3001      ┌──────▼───────┐      │
│                      │   Postgres   │      │
│                      │  (pgvector)  │      │
│                      │  Port: 5432  │      │
│                      └──────────────┘      │
│                                             │
└─────────────────────────────────────────────┘
```

### Services

1. **postgres** - PostgreSQL 16 with pgvector extension for RAG
2. **backend** - Node.js/Express API with TypeScript + Python for knowledge graph parsing
3. **frontend** - Admin Dashboard React SPA served by Nginx with API proxying
4. **screening-web** - Adult vaccination screening wizard React SPA served by Nginx with API proxying
5. **speaches** - self-hosted Whisper STT + Kokoro TTS

## Common Commands

### Start Services
```bash
# Start all services in detached mode
docker-compose --env-file .env.production up -d

# Start with live logs
docker-compose --env-file .env.production up

# Start specific service
docker-compose --env-file .env.production up -d backend
```

### Stop Services
```bash
# Stop all services
docker-compose down

# Stop and remove volumes (⚠️ deletes database data)
docker-compose down -v
```

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f postgres

# Last 100 lines
docker-compose logs --tail=100 backend
```

### Restart Services
```bash
# Restart all
docker-compose restart

# Restart specific service
docker-compose restart backend
```

### Rebuild After Code Changes
```bash
# Rebuild and restart all services
docker-compose --env-file .env.production up -d --build

# Rebuild only backend
docker-compose build backend
docker-compose up -d backend

# Rebuild only frontend
docker-compose build frontend
docker-compose up -d frontend
```

### Execute Commands in Containers
```bash
# Access backend shell
docker-compose exec backend sh

# Run Prisma migrations manually
docker-compose exec backend npx prisma migrate deploy

# Access database
docker-compose exec postgres psql -U ainurse -d ainurse

# View backend environment
docker-compose exec backend env
```

### Health Checks
```bash
# Check container status
docker-compose ps

# Check backend health
curl http://localhost:3000/health

# Check frontend
curl http://localhost:3001/health
```

## Development vs Production

### Development (Local)
For local development without Docker:
```bash
# Terminal 1: Start PostgreSQL
docker-compose up postgres

# Terminal 2: Run backend locally
npm run dev

# Terminal 3: Run frontend locally
cd admin-dashboard && npm run dev
```

### Production (Docker)
For production or sharing with team:
```bash
# One command starts everything
docker-compose --env-file .env.production up -d
```

## Database Management

### Run Migrations
Migrations run automatically on backend startup, but you can run them manually:
```bash
docker-compose exec backend npx prisma migrate deploy
```

### Access Prisma Studio (Database GUI)
```bash
# This won't work inside container, run locally instead:
npm run db:studio
```

### Backup Database
```bash
# Create backup
docker-compose exec postgres pg_dump -U ainurse ainurse > backup.sql

# Restore backup
docker-compose exec -T postgres psql -U ainurse ainurse < backup.sql
```

### Reset Database (⚠️ Destructive)
```bash
# Stop services
docker-compose down

# Remove database volume
docker volume rm ai-nurse-poc_postgres_data

# Start fresh
docker-compose --env-file .env.production up -d
```

## Troubleshooting

### Port Already in Use
```bash
# Error: port is already allocated
# Solution 1: Stop the conflicting service
# Solution 2: Change port in .env.production
FRONTEND_PORT=3002  # Change from 3001
```

### Backend Won't Start
```bash
# Check logs
docker-compose logs backend

# Common issues:
# 1. Missing API keys in .env.production
# 2. Database not ready - wait 30 seconds and check again
# 3. Database migration failed - check DATABASE_URL
```

### Database Connection Failed
```bash
# Ensure postgres is healthy
docker-compose ps

# Check database logs
docker-compose logs postgres

# Verify DATABASE_URL format:
# postgresql://ainurse:PASSWORD@postgres:5432/ainurse
```

### Frontend Shows Blank Page
```bash
# Check frontend logs
docker-compose logs frontend

# Rebuild frontend
docker-compose build frontend
docker-compose up -d frontend

# Check nginx config
docker-compose exec frontend cat /etc/nginx/conf.d/default.conf
```

### Permission Issues (Linux)
```bash
# Fix permissions for uploads/logs
sudo chown -R $USER:$USER uploads logs
chmod -R 755 uploads logs
```

## Environment Variables Reference

See `.env.production.example` for all available options.

**Required:**
- `DB_PASSWORD` - PostgreSQL password
- `SARVAM_API_KEY` - Sarvam AI API key
- `OPENAI_API_KEY` - OpenAI API key
- `JWT_SECRET` - JWT signing secret (32+ chars)
- `ENCRYPTION_KEY` - Encryption key (64 hex chars)

**Optional:**
- `FRONTEND_PORT` - External port for frontend (default: 3001)
- `NODE_ENV` - Environment mode (default: production)
- `LOG_LEVEL` - Logging level (default: info)
- `AWS_*` - AWS credentials for S3 storage
- `EXOTEL_*` - Exotel credentials for phone calls
- `RAG_*` - RAG configuration parameters

## Deployment to Cloud

### Deploy to AWS EC2

```bash
# 1. SSH to EC2 instance
ssh -i key.pem ubuntu@your-ec2-ip

# 2. Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker ubuntu

# 3. Clone repository
git clone https://github.com/REAN-Foundation/ai-nurse-poc.git
cd ai-nurse-poc

# 4. Configure environment
cp .env.production.example .env.production
nano .env.production  # Edit with production values

# 5. Start services
docker-compose --env-file .env.production up -d

# 6. Configure security group to allow:
#    - Port 3001 (Frontend)
#    - Port 80/443 (if using reverse proxy)
```

### Deploy to Google Cloud Run / Azure Container Instances

The individual Dockerfiles can be used with cloud container services. Push images to container registry and deploy.

## Performance Tuning

### Resource Limits
Add to `docker-compose.yml` under each service:
```yaml
deploy:
  resources:
    limits:
      cpus: '2'
      memory: 2G
    reservations:
      cpus: '1'
      memory: 1G
```

### Optimize Build Times
```bash
# Use BuildKit for faster builds
DOCKER_BUILDKIT=1 docker-compose build

# Parallel builds
docker-compose build --parallel
```

## Security Best Practices

1. **Never commit `.env.production`** - Keep API keys secure
2. **Change default passwords** - Update `DB_PASSWORD` from example
3. **Use strong secrets** - Generate random JWT_SECRET and ENCRYPTION_KEY
4. **Update regularly** - Keep Docker images updated
5. **Firewall rules** - Only expose necessary ports
6. **HTTPS in production** - Use reverse proxy (Nginx/Traefik) with SSL

## Getting Help

- Check logs: `docker-compose logs -f`
- Inspect containers: `docker-compose ps`
- View resource usage: `docker stats`
- GitHub Issues: https://github.com/REAN-Foundation/ai-nurse-poc/issues

## Cleaning Up

```bash
# Stop all containers
docker-compose down

# Remove all containers, networks, and volumes
docker-compose down -v

# Remove all unused Docker resources
docker system prune -a
```
