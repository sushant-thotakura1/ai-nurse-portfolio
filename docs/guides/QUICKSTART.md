# Quick Start Guide - Windows

Get the AI Nurse POC running in 5 minutes!

## Prerequisites ✅

Make sure you have:
- [x] Node.js 20+ installed
- [x] Docker Desktop installed and running
- [x] Git installed

## Quick Setup (5 steps)

### 1. Start Docker Services

```powershell
# Start PostgreSQL and Redis
docker-compose up -d

# Verify they're running
docker ps
```

You should see `ainurse-postgres` running.

### 2. Install Dependencies

```powershell
# Install backend dependencies
npm install

# Install admin dashboard dependencies
cd admin-dashboard
npm install
cd ..
```

### 3. Setup Database

```powershell
# Create .env file
copy .env.example .env

# Run migrations to create tables
npx prisma migrate dev --name init

# Generate Prisma client
npx prisma generate

# (Optional) Seed test data
node scripts/seed-data.js
```

### 4. Start the Application

**Option A: Manual (2 terminals)**

Terminal 1 - Backend:
```powershell
npm run dev
```

Terminal 2 - Frontend:
```powershell
cd admin-dashboard
npm run dev
```

**Option B: Using concurrently (1 terminal)**

First install concurrently globally:
```powershell
npm install -g concurrently
```

Then run:
```powershell
npx concurrently "npm run dev" "cd admin-dashboard && npm run dev"
```

### 5. Open Your Browser

- **Admin Dashboard**: http://localhost:3001
- **Backend API**: http://localhost:3000
- **Prisma Studio** (optional): Run `npx prisma studio` → http://localhost:5555

## Quick Tests

### Test 1: Check Backend is Running

```powershell
curl http://localhost:3000/health
```

Expected: `{"status":"healthy","timestamp":"..."}`

### Test 2: Create a Test Patient

```powershell
curl -X POST http://localhost:3000/api/patients -H "Content-Type: application/json" -d "{\"phoneNumber\":\"+919876543210\",\"name\":\"Test Patient\",\"preferredLocale\":\"hi-IN\",\"consentStatus\":\"GRANTED\"}"
```

### Test 3: View in Admin Dashboard

1. Go to http://localhost:3001
2. Click "Patients" in sidebar
3. You should see your test patient

### Test 4: Run Automated Tests

```powershell
npm test
```

Expected: **83+ tests passing** ✅

## What You Can Test Right Now

### ✅ Works Without API Keys
- Patient management (Create, Read, Update, Delete)
- Bulk CSV import
- Call scheduling (database operations)
- Admin Dashboard UI
- All automated tests (83+ tests)
- Database operations

### ⚠️ Requires API Keys
To test these features, add API keys to `.env`:
- Phone calls (Exotel API)
- Speech recognition (Sarvam.AI API)
- AI responses (OpenAI API)

## Troubleshooting

### "Cannot connect to database"
```powershell
# Restart Docker services
docker-compose down
docker-compose up -d

# Wait 5 seconds, then retry
```

### "Port already in use"
```powershell
# Find what's using port 3000
netstat -ano | findstr :3000

# Kill the process (replace <PID> with actual PID)
taskkill /PID <PID> /F
```

### "Module not found"
```powershell
# Regenerate Prisma client
npx prisma generate

# Reinstall dependencies
npm install
cd admin-dashboard
npm install
cd ..
```

### Tests failing
```powershell
# Clean install
rmdir /s /q node_modules
rmdir /s /q admin-dashboard\node_modules
npm install
cd admin-dashboard
npm install
cd ..

# Regenerate Prisma
npx prisma generate
```

## Next Steps

1. **Explore the Admin Dashboard**
   - Add patients manually
   - Import patients from CSV
   - Schedule calls
   - View dashboard statistics

2. **Test the API**
   - Use the `TESTING_GUIDE.md` for detailed API examples
   - Try creating, updating, and deleting patients
   - Test CSV import with sample data

3. **Run All Tests**
   ```powershell
   npm test
   npm run test:coverage
   ```

4. **Add API Keys** (Optional)
   - Edit `.env` file
   - Add your Exotel, Sarvam.AI, and OpenAI keys
   - Test end-to-end call flow

5. **Explore Database**
   ```powershell
   npx prisma studio
   ```
   Opens at http://localhost:5555

## Sample Test Data

Create `test-patients.csv`:
```csv
phoneNumber,name,dob,preferredLocale,consentStatus
+919876543211,Rajesh Kumar,1985-05-15,hi-IN,GRANTED
+919876543212,Priya Sharma,1990-08-20,hi-IN,GRANTED
+919876543213,Venkata Rao,1978-03-10,te-IN,PENDING
```

Import via dashboard:
1. Go to Patients page
2. Click "Import CSV"
3. Select your CSV file
4. Click "Import"

## Stopping Services

```powershell
# Stop backend and dashboard (Ctrl+C in terminals)

# Stop Docker services
docker-compose down

# Stop and remove all data
docker-compose down -v
```

## Getting Help

- **Detailed Testing**: See `TESTING_GUIDE.md`
- **API Documentation**: See `docs/` folder
- **Architecture**: See `High-Level-Design-Documentation.md`
- **Logs**: Check console output in terminals

## Summary

You now have:
- ✅ Full backend API running
- ✅ Admin dashboard UI
- ✅ Database with sample data
- ✅ 83+ passing tests
- ✅ Complete patient management
- ✅ Call scheduling system

**Ready for production features:**
- Tasks 23-30: Infrastructure, deployment, security audit
