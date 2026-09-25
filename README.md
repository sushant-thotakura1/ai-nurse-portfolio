# AI Nurse Voice Agent - POC

> **Portfolio showcase copy.** This is a curated snapshot of a private codebase I built at REAN Foundation, shared publicly with the organization's permission for recruiting/demonstration purposes. It omits internal planning docs, some proprietary knowledge-base content, and any client-identifying details. Not an open-source release — please don't reuse without checking with REAN Foundation.

> **HIPAA-compliant AI-powered voice agent for automated patient follow-up calls in Hindi and Telugu**

Built for REAN Foundation | MVP Phase 1 Complete (22/30 tasks)

## 🎯 Project Overview

This is a proof-of-concept voice-based AI nurse agent that makes outbound follow-up calls to patients in India. The system supports Hindi and Telugu languages and is designed with HIPAA compliance from day one.

**Key Features:**
- Automated outbound calls for post-surgery follow-up
- Multi-language support (Hindi, Telugu, English)
- Real-time speech recognition and synthesis
- AI-powered conversation management
- Clinical event extraction and risk scoring
- Patient data encryption (AES-256)
- Admin dashboard for management
- Bulk patient import via CSV

## 🏗️ Architecture

**Type:** Modular Monolith
**Stack:** Node.js 20 + TypeScript 5 + Express.js + React 19
**Database:** PostgreSQL 15 with pgvector extension
**Cache:** Redis 7 + Node-cache
**AI/ML:** OpenAI GPT + RAG with semantic search
**Deployment:** Docker + AWS ECS (Terraform IaC)

## 📦 Dependencies

### Core Backend Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `express` | ^5.2.1 | Web framework |
| `@prisma/client` | ^7.4.1 | Database ORM |
| `dotenv` | ^17.3.1 | Environment configuration |
| `ioredis` | ^5.9.3 | Redis client |
| `node-cache` | ^5.1.2 | In-memory caching |

### Security & Encryption

| Package | Version | Purpose |
|---------|---------|---------|
| `crypto-js` | ^4.2.0 | AES-256 encryption for PII |
| `bcrypt` | ^6.0.0 | Password hashing |
| `jsonwebtoken` | ^9.0.3 | JWT authentication |

### AI & External Services

| Package | Version | Purpose |
|---------|---------|---------|
| `openai` | ^6.22.0 | OpenAI API (LLM + embeddings) |
| `axios` | ^1.13.5 | HTTP client for API calls |

### Data Processing

| Package | Version | Purpose |
|---------|---------|---------|
| `papaparse` | ^5.5.3 | CSV parsing for bulk import |

### Development & Testing

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.9.3 | Type safety |
| `ts-node` | ^10.9.2 | TypeScript execution |
| `nodemon` | ^3.1.14 | Auto-reload in development |
| `jest` | ^30.2.0 | Testing framework |
| `ts-jest` | ^29.4.6 | TypeScript testing |
| `supertest` | ^7.2.2 | API testing |
| `prisma` | ^7.4.1 | Database migrations & client |
| `concurrently` | ^9.2.1 | Run multiple commands |

### Code Quality

| Package | Version | Purpose |
|---------|---------|---------|
| `eslint` | ^8.57.1 | Linting |
| `prettier` | ^3.8.1 | Code formatting |

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- Docker Desktop
- Git

### Installation

```bash
# 1. Clone the repository
git clone <repository-url>
cd AI-Nurse-POC

# 2. Install all dependencies (backend + frontend)
npm run setup

# 3. Start Docker services
npm run docker:up

# 4. Setup database
npm run db:migrate
npm run db:generate

# 5. (Optional) Seed test data
npm run db:seed

# 6. Start development servers
npm run dev:all
```

**Dashboard**: http://localhost:3001
**Backend API**: http://localhost:3000
**Prisma Studio**: http://localhost:5555 (run `npm run db:studio`)

### Environment Variables

Create `.env` file (copy from `.env.example`):

```env
# Required
DATABASE_URL=postgresql://ainurse:changeme@localhost:5432/ainurse
JWT_SECRET=your_jwt_secret_minimum_32_characters
ENCRYPTION_KEY=your_encryption_key_32_characters

# Optional (for full features)
EXOTEL_API_KEY=your_exotel_key
EXOTEL_API_TOKEN=your_exotel_token
EXOTEL_SID=your_exotel_sid
SARVAM_API_KEY=your_sarvam_key
OPENAI_API_KEY=your_openai_key
```

## 📂 Project Structure

```
AI-Nurse-POC/
├── src/                          # Backend source code
│   ├── core/                     # Core utilities (config, logging, encryption)
│   ├── telephony/               # Telephony adapters (Exotel)
│   ├── speech/                  # STT/TTS adapters (Sarvam.AI)
│   ├── orchestrator/            # Call orchestration & state machine
│   ├── ai-agent/                # LLM, RAG, clinical event extraction
│   ├── patient/                 # Patient management & scheduling
│   ├── knowledge-graph/         # Knowledge base system
│   ├── conversation/            # Conversation handlers
│   ├── call-logs/               # Call logging & transcripts
│   ├── integrations/            # External service integrations
│   ├── admin/                   # JWT auth & RBAC
│   └── server.ts                # Express app
├── admin-dashboard/             # React frontend
│   ├── src/
│   │   ├── components/          # UI components
│   │   ├── pages/               # Dashboard, Patients, Calls, Knowledge Graphs
│   │   ├── services/            # API client
│   │   └── App.tsx              # Main app
│   ├── Dockerfile               # Frontend container
│   └── nginx.conf               # Nginx configuration
├── prisma/                      # Database schema & migrations
│   ├── schema.prisma            # Prisma schema
│   └── migrations/              # Database migrations
├── scripts/                     # Helper scripts
│   ├── seed-data.js             # Database seeding
│   └── generate-knowledge-graph.py # Python knowledge graph parser
├── docs/                        # 📚 All documentation
│   ├── README.md                # Documentation index
│   ├── deployment/              # Deployment guides
│   │   ├── AWS-DEPLOYMENT-GUIDE.md
│   │   ├── QUICK-START-DEPLOYMENT.md
│   │   └── DEPLOYMENT.md
│   ├── guides/                  # User guides
│   │   ├── QUICKSTART.md
│   │   └── TESTING_GUIDE.md
│   ├── architecture/            # Technical architecture
│   ├── updates/                 # Feature update logs
│   ├── features/                # Feature documentation
│   └── plans/                   # Implementation plans
├── uploads/                     # Uploaded files (knowledge graphs)
├── Dockerfile                   # Backend container
├── docker-compose.yml           # All services orchestration
├── .env.production.example      # Production environment template
└── README.md                    # This file
```

## 🧪 Testing

### Run All Tests

```bash
npm test
```

**Expected:** 83+ tests passing ✅

### Test Specific Suites

```bash
npm test encryption       # Encryption utilities
npm test patient         # Patient service
npm test scheduling      # Scheduling service
npm test call-flow       # End-to-end integration
npm test rag            # RAG system
```

### Coverage Report

```bash
npm run test:coverage
```

Report available in `coverage/lcov-report/index.html`

## 🔧 Available NPM Scripts

### Development

- `npm run dev` - Start backend with hot reload
- `npm run dev:all` - Start backend + frontend concurrently
- `npm run build` - Build backend for production
- `npm run build:all` - Build backend + frontend

### Database

- `npm run db:migrate` - Run Prisma migrations
- `npm run db:generate` - Generate Prisma client
- `npm run db:studio` - Open Prisma Studio (GUI)
- `npm run db:seed` - Seed test data
- `npm run db:reset` - Reset database

### Docker

- `npm run docker:up` - Start PostgreSQL and Redis
- `npm run docker:down` - Stop Docker services

### Testing

- `npm test` - Run all tests
- `npm run test:watch` - Watch mode
- `npm run test:coverage` - With coverage

### Setup

- `npm run setup` - Full project setup (install + db)

## 🎨 Admin Dashboard

Built with React 19 + Material-UI v7

**Features:**
- Patient management (CRUD)
- Bulk CSV import with validation
- Call logs with transcripts
- Clinical event viewer
- Risk scoring visualization
- Responsive design

**Tech Stack:**
- React 19.2.4
- TypeScript 5.9.3
- Material-UI 7.3.8
- React Router 7.13.0
- Vite 7.3.1
- Axios 1.13.5

## 📊 Testing Status

| Component | Tests | Status |
|-----------|-------|--------|
| Encryption | 5 | ✅ |
| Redis Client | 4 | ✅ |
| Exotel Adapter | 2 | ✅ |
| STT/TTS Adapters | 6 | ✅ |
| OpenAI Adapter | 3 | ✅ |
| Language Pack | 4 | ✅ |
| Patient Service | 7 | ✅ |
| JWT Auth | 9 | ✅ |
| State Machine | 13 | ✅ |
| Turn Manager | 6 | ✅ |
| RAG System | 5 | ✅ |
| Event Extraction | 8 | ✅ |
| CSV Import | 7 | ✅ |
| Call Scheduling | 8 | ✅ |
| Call Flow Integration | 8 | ✅ |
| **Total** | **83+** | **✅** |

## ✅ Completed Features (Tasks 1-22)

### Month 1-2: Backend (Tasks 1-18)
- ✅ Project setup with TypeScript
- ✅ PostgreSQL database with Prisma
- ✅ Redis caching
- ✅ HIPAA-compliant encryption
- ✅ Provider interfaces (Telephony, STT, TTS, LLM)
- ✅ Exotel telephony adapter
- ✅ Sarvam.AI STT/TTS adapters
- ✅ OpenAI LLM adapter
- ✅ Language pack service
- ✅ Patient CRUD with encryption
- ✅ JWT authentication & RBAC
- ✅ Voice orchestrator (state machine + turn manager)
- ✅ AI agent with RAG (pgvector)
- ✅ Clinical event extraction & risk scoring
- ✅ CSV patient import
- ✅ Call scheduling service
- ✅ End-to-end call flow integration

### Month 3: Frontend (Tasks 20-22)
- ✅ React + Vite admin dashboard
- ✅ Patient management UI
- ✅ Call logs & transcript viewer

## 🚧 Remaining Tasks (Tasks 23-30)

- [ ] Task 23: SQS Worker for scheduled calls
- [ ] Task 24: Load testing with Artillery
- [x] Task 25: Docker containerization ✅
- [ ] Task 26: Terraform infrastructure
- [ ] Task 27: CI/CD pipeline (GitHub Actions)
- [ ] Task 28: Security audit & HIPAA compliance check
- [ ] Task 29: Staging deployment
- [ ] Task 30: Production deployment

## 🚀 Deployment

The application is ready for deployment with Docker Compose bundling all services:

- **Quick Start**: See [docs/deployment/QUICK-START-DEPLOYMENT.md](docs/deployment/QUICK-START-DEPLOYMENT.md) for 10-minute deployment
- **AWS Deployment**: See [docs/deployment/AWS-DEPLOYMENT-GUIDE.md](docs/deployment/AWS-DEPLOYMENT-GUIDE.md) for AWS-specific instructions
- **Full Guide**: See [docs/deployment/DEPLOYMENT.md](docs/deployment/DEPLOYMENT.md) for comprehensive reference

**Cost**: ~$5-7/month for test environment (VPS + API usage)

## 🔐 Security Features

- AES-256 encryption for PII (patient names, DOB)
- Phone number masking in UI
- JWT-based authentication
- Role-based access control (RBAC)
- Audit logging
- HTTPS-only in production
- Environment variable secrets
- SQL injection prevention (Prisma)
- XSS protection

## 📝 API Documentation

### Patient API

```bash
# Create patient
POST /api/patients
{
  "phoneNumber": "+919876543210",
  "name": "Patient Name",
  "preferredLocale": "hi-IN",
  "consentStatus": "GRANTED"
}

# Get all patients
GET /api/patients

# Get patient by ID
GET /api/patients/:id

# Update patient
PUT /api/patients/:id

# Import from CSV
POST /api/patients/import
```

### Scheduling API

```bash
# Schedule a call
POST /api/scheduling/schedule
{
  "patientId": "uuid",
  "callPurpose": "POST_SURGERY",
  "scheduledFor": "2026-02-25T10:00:00Z"
}

# Get pending calls
GET /api/scheduling/pending

# Get patient's calls
GET /api/scheduling/patient/:patientId
```

For detailed API documentation, see `docs/api/` directory.

## 🤝 Contributing

This is a proof-of-concept project. For contributions:

1. Follow TypeScript strict mode
2. Write tests for new features
3. Use conventional commits
4. Update documentation

## 📄 License

ISC

## 🙏 Acknowledgments

- **REAN Foundation** - Project sponsor
- **Exotel** - Telephony provider (India)
- **Sarvam.AI** - Indian language STT/TTS
- **OpenAI** - LLM and embeddings

## 📚 Documentation

All documentation is organized in the `docs/` folder:

- **Getting Started**: [docs/guides/QUICKSTART.md](docs/guides/QUICKSTART.md)
- **Testing Guide**: [docs/guides/TESTING_GUIDE.md](docs/guides/TESTING_GUIDE.md)
- **Deployment**: [docs/deployment/](docs/deployment/)
- **Architecture**: [docs/architecture/](docs/architecture/)
- **Feature Updates**: [docs/updates/](docs/updates/)

See [docs/README.md](docs/README.md) for complete documentation index.

## 📞 Support

For issues and questions:
- Check [docs/guides/TESTING_GUIDE.md](docs/guides/TESTING_GUIDE.md) for troubleshooting
- See [docs/guides/QUICKSTART.md](docs/guides/QUICKSTART.md) for setup help
- Review [docs/deployment/](docs/deployment/) for deployment guides
- See [docs/architecture/](docs/architecture/) for architecture details

---

**Built with ❤️ for improving healthcare accessibility in India**
