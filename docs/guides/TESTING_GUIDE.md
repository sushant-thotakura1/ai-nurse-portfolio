# AI Nurse POC - Testing Guide

This guide will help you test all the features we've implemented (Tasks 1-22).

## Prerequisites

Before testing, ensure you have:
- Node.js 20+ installed
- Docker Desktop installed and running
- Git installed

## Step 1: Environment Setup

### 1.1 Clone and Install Dependencies

```bash
cd C:\Users\rocky\Documents\Codes\AI-Nurse-POC

# Install backend dependencies
npm install

# Install admin dashboard dependencies
cd admin-dashboard
npm install
cd ..
```

### 1.2 Start Database Services

```bash
# Start PostgreSQL and Redis using Docker Compose
docker-compose up -d

# Verify services are running
docker ps
```

You should see two containers:
- `ainurse-postgres` on port 5432
- `ainurse-redis` on port 6379 (if configured)

### 1.3 Configure Environment Variables

Create a `.env` file in the root directory:

```bash
# Copy example env file
cp .env.example .env
```

Edit `.env` with the following minimum configuration:

```env
NODE_ENV=development
PORT=3000
LOG_LEVEL=info

# Database
DATABASE_URL=postgresql://ainurse:changeme@localhost:5432/ainurse
REDIS_URL=redis://localhost:6379

# Security (use any 32-character strings for testing)
JWT_SECRET=your_jwt_secret_minimum_32_characters_long_here
ENCRYPTION_KEY=your_encryption_key_32chars_here

# API Keys (optional for basic testing, required for full features)
EXOTEL_API_KEY=your_exotel_key
EXOTEL_API_TOKEN=your_exotel_token
EXOTEL_SID=your_exotel_sid
SARVAM_API_KEY=your_sarvam_key
OPENAI_API_KEY=your_openai_key

# Base URL
API_BASE_URL=http://localhost:3000
```

### 1.4 Setup Database

```bash
# Run Prisma migrations to create tables
npx prisma migrate dev --name init

# Generate Prisma client
npx prisma generate

# (Optional) Open Prisma Studio to view database
npx prisma studio
```

Prisma Studio will open at `http://localhost:5555` - you can use this to view/edit data directly.

## Step 2: Run Automated Tests

### 2.1 Run All Tests

```bash
# Run all unit and integration tests
npm test

# Run tests with coverage
npm run test:coverage
```

### 2.2 Run Specific Test Suites

```bash
# Test encryption utilities
npm test encryption

# Test Redis client
npm test redis

# Test Exotel adapter
npm test exotel

# Test patient service
npm test patient

# Test scheduling service
npm test scheduling

# Test call flow integration
npm test call-flow
```

Expected results:
- **83+ tests passing**
- 0 failures
- Coverage reports in `coverage/` directory

## Step 3: Start the Application

### 3.1 Start Backend Server

In one terminal:

```bash
# Start backend in development mode (with hot reload)
npm run dev
```

The server should start on `http://localhost:3000`

You should see logs like:
```
{"timestamp":"2026-02-23...","level":"info","message":"Server running on port 3000"}
{"timestamp":"2026-02-23...","level":"info","message":"In-memory cache initialized"}
```

### 3.2 Start Admin Dashboard

In a separate terminal:

```bash
cd admin-dashboard
npm run dev
```

The dashboard should start on `http://localhost:3001`

You should see:
```
  VITE v7.3.1  ready in XXX ms

  ➜  Local:   http://localhost:3001/
  ➜  Network: use --host to expose
```

## Step 4: Test Backend API Endpoints

### 4.1 Test Health Check

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2026-02-23T..."
}
```

### 4.2 Test Patient API

**Create a patient:**
```bash
curl -X POST http://localhost:3000/api/patients \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+919876543210",
    "name": "Test Patient",
    "dob": "1990-01-15",
    "preferredLocale": "hi-IN",
    "consentStatus": "GRANTED"
  }'
```

**Get all patients:**
```bash
curl http://localhost:3000/api/patients
```

**Get specific patient:**
```bash
curl http://localhost:3000/api/patients/{patient-id}
```

### 4.3 Test Patient Import (CSV)

Create a test CSV file `test-patients.csv`:
```csv
phoneNumber,name,dob,preferredLocale,consentStatus
+919876543211,Patient One,1985-05-20,hi-IN,GRANTED
+919876543212,Patient Two,1992-08-15,te-IN,PENDING
+919876543213,Patient Three,1988-03-10,en-IN,GRANTED
```

Import via curl:
```bash
curl -X POST http://localhost:3000/api/patients/import \
  -F "file=@test-patients.csv"
```

### 4.4 Test Scheduling API

**Schedule a call:**
```bash
curl -X POST http://localhost:3000/api/scheduling/schedule \
  -H "Content-Type: application/json" \
  -d '{
    "patientId": "patient-id-from-previous-step",
    "callPurpose": "POST_SURGERY",
    "scheduledFor": "2026-02-25T10:00:00Z",
    "maxRetries": 3
  }'
```

**Get pending calls:**
```bash
curl http://localhost:3000/api/scheduling/pending
```

**Get patient's scheduled calls:**
```bash
curl http://localhost:3000/api/scheduling/patient/{patient-id}
```

## Step 5: Test Admin Dashboard

### 5.1 Navigate to Dashboard

Open your browser and go to: `http://localhost:3001`

You should see:
- Sidebar with navigation (Dashboard, Patients, Call Logs, Settings)
- Dashboard page with 4 statistics cards

### 5.2 Test Patient Management

1. Click **"Patients"** in sidebar
2. Click **"Add Patient"** button
3. Fill in the form:
   - Phone Number: +919876543214
   - Full Name: UI Test Patient
   - Date of Birth: 1995-06-20
   - Preferred Language: Hindi (India)
   - Consent Status: Granted
4. Click **"Create"**
5. Verify patient appears in table

**Test CSV Import:**
1. Click **"Import CSV"** button
2. Select your `test-patients.csv` file
3. Click **"Import"**
4. Verify import results dialog shows successful imports
5. Close dialog and see new patients in table

**Test Patient Edit:**
1. Click edit icon (pencil) on any patient
2. Modify the name
3. Click **"Update"**
4. Verify changes are saved

### 5.3 Test Call Logs

1. Click **"Call Logs"** in sidebar
2. You should see "No call logs found" (expected, as no calls have been made yet)

To test with mock data, you can:
1. Open Prisma Studio: `npx prisma studio`
2. Manually create a CallSession record
3. Refresh Call Logs page
4. Click "View" icon to see transcript dialog

### 5.4 Test Navigation

- Click through all sidebar items (Dashboard, Patients, Call Logs, Settings)
- Verify routing works correctly
- Test mobile responsiveness by resizing browser window

## Step 6: Test Individual Services (Unit Tests)

### 6.1 Test Encryption

```bash
npm test encryption
```

Expected: 5 tests passing
- Encrypt/decrypt functionality
- Hash generation
- Phone number masking

### 6.2 Test State Machine

```bash
npm test state-machine
```

Expected: 13 tests passing
- All valid state transitions
- Invalid transition rejection
- Terminal state handling

### 6.3 Test Turn Manager

```bash
npm test turn-manager
```

Expected: 6 tests passing
- Audio → STT → LLM → TTS pipeline
- Conversation history management
- Error handling

### 6.4 Test Clinical Event Extraction

```bash
npm test event-extractor
```

Expected: 3 tests passing
- Event extraction from transcripts
- Risk scoring
- Escalation detection

### 6.5 Test RAG System

```bash
npm test rag
```

Expected: 5 tests passing
- Embedding generation
- Vector storage
- Semantic retrieval

## Step 7: Verify Database State

### 7.1 Using Prisma Studio

```bash
npx prisma studio
```

Navigate to `http://localhost:5555` and verify:
- **Patients table**: Contains created patients
- **ScheduledCalls table**: Contains scheduled calls
- **LanguagePacks table**: Empty (can be seeded)
- **KnowledgeBase table**: Empty (can be seeded)

### 7.2 Direct PostgreSQL Access

```bash
# Connect to PostgreSQL
docker exec -it ainurse-postgres psql -U ainurse -d ainurse

# List tables
\dt

# View patients
SELECT id, phone_number, preferred_locale, consent_status FROM patients;

# View scheduled calls
SELECT id, patient_id, call_purpose, status, scheduled_for FROM scheduled_calls;

# Exit
\q
```

## Step 8: Test Error Handling

### 8.1 Test Invalid Patient Creation

```bash
# Missing required fields
curl -X POST http://localhost:3000/api/patients \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Invalid Patient"
  }'
```

Expected: 400 Bad Request with error message

### 8.2 Test Invalid Phone Number Format

```bash
curl -X POST http://localhost:3000/api/patients \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "123456",
    "name": "Invalid Phone",
    "preferredLocale": "hi-IN",
    "consentStatus": "GRANTED"
  }'
```

Expected: 400 Bad Request (phone validation error)

### 8.3 Test Duplicate Patient

```bash
# Try to create patient with same phone number twice
curl -X POST http://localhost:3000/api/patients \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+919876543215",
    "name": "Duplicate Test",
    "preferredLocale": "hi-IN",
    "consentStatus": "GRANTED"
  }'

# Run same command again
curl -X POST http://localhost:3000/api/patients \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+919876543215",
    "name": "Duplicate Test 2",
    "preferredLocale": "hi-IN",
    "consentStatus": "GRANTED"
  }'
```

Expected: Second request should fail with unique constraint error

## Step 9: Performance Testing (Basic)

### 9.1 Test Response Times

```bash
# Time a simple API call
time curl http://localhost:3000/api/patients
```

Expected: Response in < 100ms for local development

### 9.2 Test Concurrent Requests

```bash
# Install Apache Bench (if not already installed)
# For Windows: Download from Apache website
# For Linux: sudo apt-get install apache2-utils

# Test 100 requests with 10 concurrent
ab -n 100 -c 10 http://localhost:3000/health
```

Expected:
- All requests succeed
- No errors
- Avg response time < 50ms

## Step 10: Clean Up

### 10.1 Stop Services

```bash
# Stop backend (Ctrl+C in terminal)

# Stop admin dashboard (Ctrl+C in terminal)

# Stop Docker containers
docker-compose down

# OR stop and remove volumes (clears all data)
docker-compose down -v
```

### 10.2 Clear Database

```bash
# Drop all tables and re-create
npx prisma migrate reset

# This will:
# 1. Drop all tables
# 2. Re-run migrations
# 3. Run seed scripts (if any)
```

## Troubleshooting

### Backend won't start

**Issue**: "Error: connect ECONNREFUSED"
**Solution**: Ensure PostgreSQL is running
```bash
docker-compose ps
docker-compose up -d
```

### Database migration fails

**Issue**: "Migration failed"
**Solution**: Reset database
```bash
docker-compose down -v
docker-compose up -d
npx prisma migrate dev --name init
```

### Admin dashboard shows errors

**Issue**: "Failed to load patients"
**Solution**:
1. Verify backend is running on port 3000
2. Check browser console for CORS errors
3. Verify API proxy in vite.config.ts

### Tests failing

**Issue**: "Cannot find module"
**Solution**: Regenerate Prisma client
```bash
npx prisma generate
npm install
```

### Port already in use

**Issue**: "EADDRINUSE: address already in use"
**Solution**: Kill process or use different port
```bash
# Windows: Find and kill process on port 3000
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/Mac:
lsof -ti:3000 | xargs kill
```

## What's Working vs. What's Mock

### ✅ Fully Working (No External Dependencies)
- Patient CRUD operations
- Patient CSV import
- Call scheduling (database operations)
- Admin Dashboard UI
- All automated tests
- Database operations
- Encryption/decryption
- State machine
- In-memory caching

### ⚠️ Requires External API Keys
- **Exotel** (telephony): Making actual phone calls
- **Sarvam.AI** (STT/TTS): Speech processing
- **OpenAI** (LLM/embeddings): AI responses and RAG

Without API keys, these features will show errors when called, but the application structure is complete.

### 🔧 Not Yet Implemented
- Live phone call flow (requires Exotel integration)
- Real-time audio streaming
- Webhook handling (requires public URL)
- Background workers (Task 23)
- Production deployment (Tasks 25-30)

## Next Steps

After testing locally:
1. **Add API keys** for full feature testing
2. **Set up ngrok** or similar for webhook testing
3. **Load testing** (Task 24)
4. **Deploy to staging** (Task 29)

## Summary

**What You Can Test Right Now:**
- ✅ Patient management (Create, Read, Update)
- ✅ Bulk CSV import with validation
- ✅ Call scheduling (CRUD operations)
- ✅ Admin Dashboard (all UI features)
- ✅ 83+ automated tests
- ✅ Database operations
- ✅ Data encryption/privacy features

**What Requires Setup:**
- Phone calls (need Exotel account)
- Speech processing (need Sarvam.AI API)
- AI conversations (need OpenAI API)

The core application is fully functional and ready for integration testing!
