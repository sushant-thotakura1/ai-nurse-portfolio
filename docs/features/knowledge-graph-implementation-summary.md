# Knowledge Graph Implementation Summary

## Overview

The Knowledge Graph feature enables doctors to define clinical protocols for post-operative patient care in structured Excel spreadsheets. These protocols are parsed, validated, and transformed into JSON knowledge graphs that the AI nurse uses to provide phase-appropriate, evidence-based patient assessments.

## Architecture

```
XLSX File (Clinical Protocol)
        ↓
Python Parser (validate & transform)
        ↓
JSON Knowledge Graph
        ↓
Database Storage (PostgreSQL)
        ↓
LLM Context Loader (extract phase context)
        ↓
AI Nurse Conversation (OpenAI GPT-4o-mini)
```

## Components Implemented

### 1. Database Schema (`prisma/schema.prisma`)
- **KnowledgeGraph** model with status management (DRAFT, ACTIVE, ARCHIVED)
- **Patient** fields: `healthCondition`, `conditionStartDate`, `knowledgeGraphId`
- **CallSession** fields: `knowledgeGraphId`, `currentPhase`, `daysSinceStart`

### 2. Python XLSX Parser (`scripts/generate-knowledge-graph.py`)
Parses 6 Excel tabs:
- **Condition & Phases**: Recovery phase definitions with day ranges
- **Symptoms**: Symptom catalog with severity scores
- **Assessment Questions**: Decision tree questions with risk scoring
- **Red Flags**: Immediate escalation triggers
- **Instructions**: Phase-specific patient guidance
- **Scoring Logic**: Threshold rules for REASSURE/ADVISE/ESCALATE

**Features**:
- Column-name-based parsing (flexible layout)
- Comprehensive validation (cross-tab references, duplicate IDs, data types)
- Detailed error reporting (tab, row, column, error message)

### 3. Node.js Service Layer (`src/knowledge-graph/`)
- **Types** (`types.ts`): Full TypeScript definitions for KG structures
- **Service** (`knowledge-graph.service.ts`):
  - `uploadKnowledgeGraph()` - Execute parser, store results
  - `activateKnowledgeGraph()` - Atomic activation with deactivation of previous
  - `listKnowledgeGraphs()` - Filter by health condition and status
  - `getActiveKnowledgeGraph()` - Retrieve active KG for a condition
  - `deleteKnowledgeGraph()` - Safe deletion with reference checks
  - `archiveKnowledgeGraph()` - Archive instead of delete

### 4. LLM Context Loader (`src/knowledge-graph/context-loader.ts`)
- Calculates patient's current phase from days since condition start
- Extracts phase-appropriate symptoms, red flags, and instructions
- Builds comprehensive system prompt for LLM with:
  - Patient context (condition, phase, days post-surgery)
  - Expected symptoms with assessment questions
  - Red flags requiring immediate escalation
  - Patient instructions (medication, activity, wound care)
  - Assessment protocol with scoring rules

### 5. Conversation Integration (`src/conversation/test-conversation.service.ts`)
- Loads clinical context when patient has assigned health condition
- Injects knowledge graph system prompt into OpenAI calls
- Stores phase information in call sessions
- Falls back to default prompts for patients without health conditions

### 6. Patient API (`src/patient/`)
- `POST /api/patients/:id/health-condition` - Assign health condition to patient
- Automatically links patient to active knowledge graph
- Validates active KG exists for the condition

### 7. Knowledge Graph API (`src/knowledge-graph/routes.ts`)
- `POST /api/knowledge-graphs/upload` - Upload XLSX file (multipart/form-data)
- `POST /api/knowledge-graphs/:id/activate` - Activate knowledge graph
- `POST /api/knowledge-graphs/:id/archive` - Archive knowledge graph
- `GET /api/knowledge-graphs` - List with optional filters
- `GET /api/knowledge-graphs/:id` - Get specific knowledge graph
- `DELETE /api/knowledge-graphs/:id` - Delete (if not referenced)

## Testing

### Python Parser Tests
```bash
python scripts/test-parser.py
```
Tests:
- Valid XLSX file parsing
- Error handling for non-existent files
- All tab parsers (condition, symptoms, questions, red flags, instructions, scoring)

### End-to-End Test
```bash
npx ts-node scripts/test-e2e-knowledge-graph.ts
```
Validates complete workflow:
1. Upload and parse XLSX file
2. Activate knowledge graph
3. Load clinical context for Phase I, II, III
4. List and retrieve knowledge graphs
5. Archive knowledge graph

## Usage Workflow

### 1. Create Clinical Protocol XLSX
Use the template structure in `docs/features/xlsx-knowledge-base.md`:
- Condition & Phases tab (define recovery phases with day ranges)
- Symptoms tab (catalog symptoms with severity)
- Assessment Questions tab (decision tree for triage)
- Red Flags tab (immediate escalation conditions)
- Instructions tab (phase-specific patient guidance)
- Scoring Logic tab (threshold rules)

Example: `test-data/sample-cabg-protocol.xlsx`

### 2. Upload Knowledge Graph
```bash
POST /api/knowledge-graphs/upload
Content-Type: multipart/form-data

Fields:
- file: <XLSX file>
- name: "CABG Post-Operative Protocol v1.0"
- healthCondition: "CABG_RECOVERY"
- conditionName: "CABG Post-Operative Recovery"
- version: "v1.0"
```

Response:
```json
{
  "id": "kg-uuid",
  "isValid": true,
  "validationErrors": null,
  "knowledgeGraph": { ... },
  "status": "DRAFT"
}
```

### 3. Activate Knowledge Graph
```bash
POST /api/knowledge-graphs/:id/activate
```

Response:
```json
{
  "id": "kg-uuid",
  "status": "ACTIVE",
  "previousActiveId": "previous-kg-uuid"
}
```

### 4. Assign to Patient
```bash
POST /api/patients/:patientId/health-condition

{
  "healthCondition": "CABG_RECOVERY",
  "conditionStartDate": "2026-02-25T00:00:00Z"
}
```

### 5. Start Conversation
When `startConversation()` is called for this patient:
- Calculates days since surgery (e.g., Day 5)
- Determines current phase (e.g., PHASE_I: 0-7 days)
- Loads phase-appropriate context (symptoms, red flags, instructions)
- Injects knowledge graph system prompt into LLM
- AI nurse uses clinical protocol for assessment

## Data Flow Example

**Patient**: 5 days post-CABG surgery

1. **Context Loader**:
   - Condition: CABG_RECOVERY
   - Days since surgery: 5
   - Current phase: PHASE_I (0-7 days)

2. **Phase Context**:
   - Symptoms: Chest Pain (high severity), Shortness of Breath (moderate)
   - Red Flags: Severe chest pain >7/10, Severe SOB at rest, Fever >101.5°F
   - Instructions: Take pain meds, Rest, Keep incision clean

3. **System Prompt** (injected into LLM):
```
You are an AI nurse from REAN Foundation...

## Patient Context
- Condition: CABG Post-Operative Recovery
- Current Phase: PHASE_I (Day 5 post-surgery)
- Phase Focus: Immediate monitoring and wound care
- Review Point: Daily

## Clinical Knowledge Base

### Expected Symptoms for PHASE_I
- Chest Pain (SYM_001):
  Base severity: high (score: 2)
  Assessment questions:
  1. How severe is your chest pain on a scale of 1-10?
     A: 1-3 (mild) (risk -1)
     B: 7-10 (severe) (risk +2)
  2. Is the pain getting worse?
     A: No, stable or improving (risk +0)
     B: Yes, getting worse (risk +1)

### Red Flags (Immediate Escalation Required)
- Severe chest pain (>7/10)
  Action: ESCALATE
  Urgency: immediate
  Rationale: May indicate MI or complication

...
```

4. **Conversation**:
   - Patient: "I'm feeling chest pain"
   - AI Nurse: (uses assessment questions from knowledge graph)
   - AI Nurse: "How severe is your chest pain on a scale of 1-10?"
   - Patient: "It's about an 8"
   - AI Nurse: (triggers escalate=true, calculates risk score = 2 + 2 = 4)
   - AI Nurse: "This requires immediate attention. I'm escalating to the clinical team."

## File Structure

```
AI-Nurse-POC/
├── src/
│   ├── knowledge-graph/
│   │   ├── types.ts                     # TypeScript types
│   │   ├── knowledge-graph.service.ts   # Core service logic
│   │   ├── context-loader.ts            # Phase context extraction
│   │   ├── routes.ts                    # API endpoints
│   │   └── index.ts                     # Module exports
│   ├── conversation/
│   │   └── test-conversation.service.ts # Updated with KG integration
│   └── patient/
│       ├── service.ts                   # Added assignHealthCondition()
│       └── routes.ts                    # Added health condition endpoint
├── scripts/
│   ├── generate-knowledge-graph.py      # Python XLSX parser
│   ├── test-parser.py                   # Python parser tests
│   ├── create-test-xlsx.py              # Generate sample XLSX
│   ├── test-e2e-knowledge-graph.ts      # End-to-end test
│   └── requirements.txt                 # Python dependencies
├── prisma/
│   └── schema.prisma                    # Updated with KG models
├── test-data/
│   └── sample-cabg-protocol.xlsx        # Sample clinical protocol
└── docs/
    └── features/
        └── xlsx-knowledge-base.md       # Original feature spec
```

## Key Design Decisions

### 1. Hybrid Architecture (Python + Node.js)
- **Python**: XLSX parsing (openpyxl library, rich ecosystem)
- **Node.js**: API, database, LLM integration
- **Reasoning**: Best tool for each job, subprocess isolation

### 2. Generic Health Condition Model
- **One knowledge graph per health condition** (not hardcoded for CABG)
- Supports TYPE2_DIABETES, PREGNANCY_CARE, etc.
- Unique constraint: `(healthCondition, version)`

### 3. Status Management
- **DRAFT**: Initial upload, may have validation errors
- **ACTIVE**: One per health condition, used in conversations
- **ARCHIVED**: Deactivated, retained for audit trail

### 4. Phase-Based Context Loading
- Calculate current phase from days since condition start
- Extract only phase-relevant symptoms, red flags, instructions
- Reduces LLM context size, improves relevance

### 5. Validation-First Approach
- Comprehensive XLSX validation before database storage
- Detailed error reporting for doctors to fix issues
- Cannot activate invalid knowledge graphs

## Dependencies Added

### Python
```
openpyxl>=3.1.0
jsonschema>=4.17.0
```

### Node.js
```
multer (file uploads)
@types/multer
```

## Future Enhancements (Not Implemented)

### 1. Frontend UI (Task 16 - Pending)
- Knowledge graph management dashboard
- XLSX upload interface
- Validation error display
- Activation/archival controls

### 2. Advanced Features
- Multi-language support for knowledge graphs
- Version diff viewer
- Bulk import/export
- Template library
- Real-time collaboration on XLSX editing

### 3. Analytics
- Track which symptoms are most reported per phase
- Escalation rate by knowledge graph version
- A/B testing of different protocols

## Completed Tasks (15/18)

1. ✅ Database Schema Migration
2. ✅ Python XLSX Parser - Setup & Structure
3. ✅ Python Parser - Condition Tab Parser
4. ✅ Python Parser - Symptoms Tab Parser
5. ✅ Python Parser - Assessment Questions Parser
6. ✅ Python Parser - Red Flags & Instructions
7. ✅ Python Parser - Scoring Logic & Traversal
8. ✅ Node.js Service - Types & Setup
9. ✅ Node.js Service - Python Executor
10. ✅ Node.js Service - Upload & Process
11. ✅ Node.js Service - Activation & List Methods
12. ✅ Node.js API Routes
13. ✅ LLM Context Loader
14. ✅ Integrate LLM Context into Conversation Service
15. ✅ Patient Health Condition Assignment API
16. ⏳ Frontend - Knowledge Graph Management Page (Pending)
17. ✅ End-to-End Testing
18. ✅ Final Integration & Cleanup

## Testing Evidence

- ✅ Python parser tests: All passing
- ✅ End-to-end workflow: All passing
- ✅ Database schema: Applied successfully
- ✅ API routes: Integrated and mounted
- ✅ LLM integration: Working with test conversation service

The knowledge graph system is **production-ready** for backend use. Frontend UI development remains pending but is not blocking core functionality.
