// Re-export shim — the tenant feature registry moved to src/core/tenant-features.ts
// (so non-conversation modules can consume it without importing from conversation/).
// Import from '../core/tenant-features' directly in new code.
export * from '../core/tenant-features';
