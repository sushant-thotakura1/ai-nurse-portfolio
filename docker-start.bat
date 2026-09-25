@echo off
REM Quick start script for Docker deployment (Windows)

echo ========================================
echo AI Nurse POC - Docker Quick Start
echo ========================================
echo.

REM Check if Docker is running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Docker is not running
    echo Please start Docker Desktop and try again
    pause
    exit /b 1
)

echo Docker is running
echo.

REM Check if .env.production exists
if not exist ".env.production" (
    echo .env.production not found
    echo Creating from template...
    copy .env.production.example .env.production
    echo.
    echo Please edit .env.production and add your API keys:
    echo    - DB_PASSWORD
    echo    - SARVAM_API_KEY
    echo    - OPENAI_API_KEY
    echo    - JWT_SECRET (generate random 32+ char string)
    echo    - ENCRYPTION_KEY (generate random 64 char hex)
    echo.
    pause
)

echo Starting services...
echo.

REM Start services
docker-compose --env-file .env.production up -d

echo.
echo Waiting for services to be healthy...
timeout /t 10 /nobreak >nul

REM Check service status
docker-compose ps

echo.
echo Services started!
echo.
echo Access the application:
echo    Frontend: http://localhost:3001
echo    Backend API: http://localhost:3000
echo    Database: localhost:5432
echo.
echo Useful commands:
echo    View logs: docker-compose logs -f
echo    Stop services: docker-compose down
echo    Restart: docker-compose restart
echo.
echo Full documentation: See DOCKER.md
echo.
pause
