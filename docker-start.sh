#!/bin/bash
# Quick start script for Docker deployment

echo "🚀 AI Nurse POC - Docker Quick Start"
echo "===================================="
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker is not running"
    echo "Please start Docker Desktop and try again"
    exit 1
fi

echo "✅ Docker is running"
echo ""

# Check if .env.production exists
if [ ! -f ".env.production" ]; then
    echo "⚠️  .env.production not found"
    echo "Creating from template..."
    cp .env.production.example .env.production
    echo ""
    echo "📝 Please edit .env.production and add your API keys:"
    echo "   - DB_PASSWORD"
    echo "   - SARVAM_API_KEY"
    echo "   - OPENAI_API_KEY"
    echo "   - JWT_SECRET (generate: openssl rand -base64 32)"
    echo "   - ENCRYPTION_KEY (generate: openssl rand -hex 32)"
    echo ""
    read -p "Press Enter after you've configured .env.production..."
fi

echo "🔧 Starting services..."
echo ""

# Start services
docker-compose --env-file .env.production up -d

echo ""
echo "⏳ Waiting for services to be healthy..."
sleep 10

# Check service status
docker-compose ps

echo ""
echo "✅ Services started!"
echo ""
echo "📱 Access the application:"
echo "   Frontend: http://localhost:3001"
echo "   Backend API: http://localhost:3000"
echo "   Database: localhost:5432"
echo ""
echo "📋 Useful commands:"
echo "   View logs: docker-compose logs -f"
echo "   Stop services: docker-compose down"
echo "   Restart: docker-compose restart"
echo ""
echo "📖 Full documentation: See DOCKER.md"
