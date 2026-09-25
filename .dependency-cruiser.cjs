// .dependency-cruiser.cjs
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'screening-module-isolation',
      comment:
        "src/screening/ must stay isolated from the nurse-agent's conversation engine. " +
        'It may import only from src/core/ and within src/screening/. ' +
        'See docs/specs/2026-08-28-adult-vaccination-screening-design.md',
      severity: 'error',
      from: { path: '^src/screening/' },
      to: {
        path: '^src/(ai-agent|orchestrator|knowledge-graph|decision|conversation|conversations|patient|perception|rag)/',
      },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
  },
};
