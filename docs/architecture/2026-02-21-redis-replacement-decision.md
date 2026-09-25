# Architecture Decision: Replace Redis with PostgreSQL Sessions + In-Memory Cache

**Date**: 2026-02-21
**Status**: Approved
**Decision Maker**: Product Team

## Context

The original design specified Redis (ElastiCache) for:
1. Active call session storage
2. Caching language packs
3. Caching provider configurations

**Cost Analysis:**
- ElastiCache Redis: ~$150/month (cache.r6g.large cluster)
- For POC handling 10,000 calls/month, this represents 15% of total infrastructure cost

## Decision

**Replace Redis entirely with:**
1. **PostgreSQL table** for session storage
2. **In-memory cache** (node-cache) for language packs and configs

## Rationale

### Why This Works for Our Use Case

**1. Session Volume is Manageable**
- Expected: ~50 concurrent calls max during MVP
- PostgreSQL easily handles this read/write load
- Session data averages <10KB per call
- Database has sub-10ms query times for indexed lookups

**2. Language Packs are Static**
- Only 2-6 language packs during MVP (Hindi, Telugu, Tamil, etc.)
- Each pack is ~5-10KB
- Perfect for in-memory caching with application lifecycle
- Can be preloaded at startup

**3. Provider Configs Change Infrequently**
- STT/TTS/LLM configs updated manually via admin dashboard
- ~5-10 configs total
- 10-minute TTL is more than sufficient

**4. No Multi-Server Coordination Needed (Initially)**
- ECS tasks can have independent in-memory caches
- Eventual consistency is acceptable for configs (10min TTL)
- For sessions, PostgreSQL provides single source of truth

### Cost Savings

| Component | Original | New | Savings |
|-----------|----------|-----|---------|
| ElastiCache Redis | $150/month | $0 | $150/month |
| **Annual Savings** | - | - | **$1,800/year** |

### Performance Impact

**Session Storage:**
```
Redis: ~1ms read latency
PostgreSQL (indexed): ~5-10ms read latency

Impact: +4-9ms per session lookup
Conclusion: Negligible for voice calls (2-3 second turn times)
```

**Cache Lookups:**
```
Redis: ~1ms network round-trip
In-memory (node-cache): <0.1ms (no network)

Impact: 10x faster!
Conclusion: Better performance
```

## Implementation Details

### 1. Session Storage (PostgreSQL)

**New Table:**
```sql
CREATE TABLE call_sessions_cache (
  session_id UUID PRIMARY KEY,
  patient_id UUID REFERENCES patients(id),
  session_data JSONB NOT NULL,
  state VARCHAR(50) NOT NULL,
  locale VARCHAR(10) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_sessions_expires ON call_sessions_cache(expires_at);
CREATE INDEX idx_sessions_patient ON call_sessions_cache(patient_id);
CREATE INDEX idx_sessions_state ON call_sessions_cache(state);
```

**Automatic Cleanup:**
```sql
-- Cron job or application startup
DELETE FROM call_sessions_cache WHERE expires_at < NOW();
```

**Session TTL:** 1 hour (calls typically 3-5 minutes)

### 2. In-Memory Cache (node-cache)

**Library:** `node-cache` (npm package)

**Installation:**
```bash
npm install node-cache
```

**Implementation:**
```typescript
// src/core/cache.ts
import NodeCache from 'node-cache';
import { logger } from './logger';

export class CacheService {
  private languagePackCache: NodeCache;
  private providerConfigCache: NodeCache;

  constructor() {
    // Language packs: 1 hour TTL
    this.languagePackCache = new NodeCache({
      stdTTL: 3600,
      checkperiod: 600,
    });

    // Provider configs: 10 minute TTL
    this.providerConfigCache = new NodeCache({
      stdTTL: 600,
      checkperiod: 120,
    });

    logger.info('In-memory cache initialized');
  }

  async getLanguagePack(locale: string): Promise<any | null> {
    return this.languagePackCache.get(locale) || null;
  }

  setLanguagePack(locale: string, pack: any): void {
    this.languagePackCache.set(locale, pack);
  }

  async getProviderConfig(providerType: string): Promise<any | null> {
    return this.providerConfigCache.get(providerType) || null;
  }

  setProviderConfig(providerType: string, config: any): void {
    this.providerConfigCache.set(providerType, config);
  }

  clear(): void {
    this.languagePackCache.flushAll();
    this.providerConfigCache.flushAll();
    logger.info('All caches cleared');
  }
}

export const cacheService = new CacheService();
```

### 3. Session Management Pattern

**Write Pattern:**
```typescript
// When call starts
await prisma.callSessionsCache.create({
  data: {
    sessionId: uuid(),
    patientId: patient.id,
    sessionData: { /* session state */ },
    state: 'CONNECTED',
    locale: 'hi-IN',
    expiresAt: new Date(Date.now() + 3600000), // 1 hour
  },
});
```

**Read Pattern:**
```typescript
// During call
const session = await prisma.callSessionsCache.findUnique({
  where: { sessionId },
});

if (!session || session.expiresAt < new Date()) {
  throw new Error('Session expired');
}
```

**Update Pattern:**
```typescript
// On each turn
await prisma.callSessionsCache.update({
  where: { sessionId },
  data: {
    sessionData: updatedData,
    state: newState,
    updatedAt: new Date(),
  },
});
```

**Cleanup Pattern:**
```typescript
// Scheduled job (every 5 minutes)
await prisma.callSessionsCache.deleteMany({
  where: {
    expiresAt: { lt: new Date() },
  },
});
```

## Migration from Original Design

### Changes to Existing Code

1. **Remove Redis from docker-compose.yml**
   - Delete redis service definition
   - Remove redis volume

2. **Remove Redis from infrastructure**
   - Delete ElastiCache module from Terraform
   - Remove Redis security group rules

3. **Update Prisma schema**
   - Add `call_sessions_cache` table
   - Run migration

4. **Add node-cache dependency**
   - `npm install node-cache`
   - Create `src/core/cache.ts`

### No Changes Needed

- Telephony module (no Redis dependency)
- Speech module (no Redis dependency)
- AI Agent module (no Redis dependency)
- Admin dashboard (backend API unchanged)

## Performance Characteristics

### Session Operations

| Operation | Frequency | PostgreSQL Latency | Redis Latency | Delta |
|-----------|-----------|-------------------|---------------|-------|
| Session Create | 1x per call | 10-15ms | 1-2ms | +8-13ms |
| Session Read | 5-10x per call | 5-10ms | 1ms | +4-9ms |
| Session Update | 5-10x per call | 10-15ms | 1-2ms | +8-13ms |
| **Total per call** | - | **100-200ms** | **15-30ms** | **+85-170ms** |

**Impact:** +85-170ms per 3-minute call = **0.1% overhead**

### Cache Operations

| Operation | Frequency | In-Memory | Redis | Delta |
|-----------|-----------|-----------|-------|-------|
| Language Pack Load | 1x per call | <0.1ms | 1-2ms | **-1.9ms (faster)** |
| Config Load | 1-2x per call | <0.1ms | 1-2ms | **-1.9ms (faster)** |

**Impact:** In-memory cache is 10-20x faster

## Scalability Considerations

### Current Scale (MVP - 10K calls/month)
✅ **Perfect fit** - PostgreSQL handles this easily

### Medium Scale (100K calls/month)
✅ **Still good** - ~500 concurrent sessions max
- PostgreSQL can handle 1000s of connections
- May need connection pooling (PgBouncer)

### High Scale (1M+ calls/month)
⚠️ **May need Redis** - 5000+ concurrent sessions
- Consider re-introducing Redis at this scale
- Or use PostgreSQL read replicas
- Or partition sessions across multiple DB instances

**Migration Path:**
When we hit 500K calls/month, we can add Redis without code changes:
1. Implement Redis adapter with same interface
2. Feature flag to toggle Redis on/off
3. Gradual rollout

## Monitoring & Alerts

### Key Metrics to Watch

1. **Session Query Latency**
   - Alert if p95 > 50ms
   - Target: <10ms p95

2. **Session Table Size**
   - Alert if >100K rows (cleanup job failing)
   - Target: <10K rows (sessions expire after 1 hour)

3. **Cache Hit Rate**
   - Alert if <90% for language packs
   - Target: >95% hit rate

4. **Database Connection Pool**
   - Alert if >80% utilization
   - Target: <50% utilization

### CloudWatch Dashboards

**Add metrics:**
```typescript
metrics = {
  'cache.languagePack.hit': counter,
  'cache.languagePack.miss': counter,
  'cache.providerConfig.hit': counter,
  'cache.providerConfig.miss': counter,
  'sessions.active': gauge,
  'sessions.cleanup.deleted': counter,
  'db.session.read.latency': histogram,
  'db.session.write.latency': histogram,
}
```

## Risks & Mitigation

### Risk 1: Session Loss on Container Restart
**Impact:** Active calls dropped when ECS task restarts
**Mitigation:**
- PostgreSQL persists sessions (survives restarts)
- Sessions expire after 1 hour anyway
- Telephony provider will re-webhook on reconnect

### Risk 2: Database Bottleneck
**Impact:** Session queries slow down under load
**Mitigation:**
- Proper indexing on session_id, patient_id, expires_at
- Connection pooling (20-50 connections)
- Monitor query performance

### Risk 3: Cache Inconsistency Across Instances
**Impact:** Different ECS tasks have different config versions
**Mitigation:**
- 10-minute TTL ensures eventual consistency
- Critical configs updated during maintenance windows
- Can force cache clear via admin API

## Testing Strategy

### Unit Tests
```typescript
describe('CacheService', () => {
  it('should cache and retrieve language pack')
  it('should expire cache after TTL')
  it('should handle cache miss gracefully')
})
```

### Integration Tests
```typescript
describe('SessionStorage', () => {
  it('should create and retrieve session from PostgreSQL')
  it('should update session state')
  it('should cleanup expired sessions')
})
```

### Load Tests
```
Artillery scenario:
- 100 concurrent calls
- Verify session read/write latency <50ms p95
- Verify no database connection errors
```

## Rollback Plan

If this change causes issues:

1. **Quick Rollback** (same day):
   - Revert commits
   - Re-deploy previous version
   - Redis not removed from infrastructure yet

2. **Data Recovery:**
   - Sessions in PostgreSQL table
   - No data loss
   - Simply switch back to Redis if needed

## Approval

**Approved by:** Product Team
**Date:** 2026-02-21
**Commit:** 44b3171

## References

- Original Design: `docs/plans/2026-02-21-ai-nurse-complete-system-design.md`
- node-cache docs: https://www.npmjs.com/package/node-cache
- PostgreSQL session pattern: Industry standard for session stores
