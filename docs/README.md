# AI Nurse POC - Documentation

Welcome to the AI Nurse POC documentation. All project documentation is organized here.

## 📁 Documentation Structure

### 🚀 [Deployment Guides](./deployment/)
Complete guides for deploying the application to various environments:
- **[AWS Deployment Guide](./deployment/AWS-DEPLOYMENT-GUIDE.md)** - Deploy to AWS Lightsail or EC2
- **[Quick Start Deployment](./deployment/QUICK-START-DEPLOYMENT.md)** - 10-minute deployment to any VPS
- **[Deployment Guide](./deployment/DEPLOYMENT.md)** - Comprehensive deployment reference

### 📖 [User Guides](./guides/)
Getting started and testing documentation:
- **[Quickstart Guide](./guides/QUICKSTART.md)** - Get up and running quickly
- **[Testing Guide](./guides/TESTING_GUIDE.md)** - Complete testing documentation

### 🏗️ [Architecture](./architecture/)
System design and technical architecture:
- **[High-Level Design](./architecture/High-Level-Design-Documentation.md)** - System architecture overview
- **[Redis Replacement Decision](./architecture/2026-02-21-redis-replacement-decision.md)** - Caching strategy decisions

### 📝 [Feature Updates](./updates/)
Documentation of feature implementations and updates:
- **[Backend Clinical Events Update](./updates/BACKEND_CLINICAL_EVENTS_UPDATE.md)** - Clinical event tracking improvements
- **[Greeting Personalization](./updates/GREETING_PERSONALIZATION_UPDATE.md)** - Patient-specific greeting implementation
- **[Knowledge Graph Selection](./updates/KNOWLEDGE_GRAPH_SELECTION.md)** - Per-patient knowledge graph feature
- **[Language Improvements](./updates/LANGUAGE_IMPROVEMENTS_UPDATE.md)** - TTS voice and language purity updates
- **[Sarvam TTS Voice Update](./updates/SARVAM_TTS_VOICE_UPDATE.md)** - Voice configuration changes

### 🔧 [Features](./features/)
Feature-specific technical documentation:
- **[Knowledge Graph Implementation](./features/knowledge-graph-implementation-summary.md)** - Knowledge base system
- **[XLSX Knowledge Base](./features/xlsx-knowledge-base.md)** - Excel-based knowledge graphs

### 📋 [Implementation Plans](./plans/)
Detailed implementation plans and design documents:
- **[Complete System Design](./plans/2026-02-21-ai-nurse-complete-system-design.md)**
- **[MVP Phase 1 Plan](./plans/2026-02-21-ai-nurse-mvp-phase1.md)**
- **[Knowledge Graph Implementation Plan](./plans/2026-03-02-knowledge-graph-implementation.md)**

### 🔌 [API Documentation](./api/)
API endpoints and integration guides (to be added)

## 🤖 [Claude Code Instructions](./CLAUDE.md)
Guidelines for Claude Code when working with this repository.

## 🎯 Quick Links

**Getting Started:**
1. [Quickstart Guide](./guides/QUICKSTART.md) - Local development setup
2. [Testing Guide](./guides/TESTING_GUIDE.md) - Run tests and verify functionality

**Deploying:**
1. [Quick Start Deployment](./deployment/QUICK-START-DEPLOYMENT.md) - Fastest way to deploy
2. [AWS Deployment Guide](./deployment/AWS-DEPLOYMENT-GUIDE.md) - Production-ready AWS deployment

**Understanding the System:**
1. [High-Level Design](./architecture/High-Level-Design-Documentation.md) - Architecture overview
2. [Feature Updates](./updates/) - Latest features and improvements

## 📊 Project Status

Current Phase: **MVP Phase 1 - Foundation Complete**

Key Features Implemented:
- ✅ Patient management system
- ✅ Knowledge graph integration (Excel-based)
- ✅ Multilingual voice conversations (Sarvam AI)
- ✅ LLM-based clinical assessment (OpenAI)
- ✅ Real-time call monitoring
- ✅ Clinical event tracking
- ✅ Admin dashboard with metrics
- ✅ Docker deployment setup

## 🤝 Contributing

When adding new documentation:
1. Place deployment guides in `deployment/`
2. Place user-facing guides in `guides/`
3. Place technical architecture docs in `architecture/`
4. Place feature update logs in `updates/`
5. Place detailed implementation plans in `plans/`
6. Update this README with links to new documents

## 📞 Support

For questions or issues, refer to the main [README.md](../README.md) in the project root.
