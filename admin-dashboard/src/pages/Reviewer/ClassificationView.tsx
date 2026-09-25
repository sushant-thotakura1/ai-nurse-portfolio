// admin-dashboard/src/pages/Reviewer/ClassificationView.tsx
import { useEffect, useState, useCallback } from 'react';
import { Box, CircularProgress, Alert } from '@mui/material';
import ScenarioList from './ScenarioList';
import { ChipDecision } from './FieldChip';
import { ParsedRow } from './ScenarioCard';

interface FeedbackEntry {
  scenario_id: string;
  row_type: 'greeting' | 'turn' | 'assessment';
  turn_number?: number;
  field: string;
  decision: 'correct' | 'needs_change';
  comment?: string;
  scenario_approved?: true;
}

interface Props {
  condition: string;
  classification: string;
  token: string;
}

function parseCsv(csv: string): Record<string, unknown>[] {
  // Full RFC 4180 parser — handles quoted fields with embedded newlines and escaped quotes.
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuote = false;
  let i = 0;
  const s = csv.trimEnd();

  while (i < s.length) {
    const ch = s[i];
    if (inQuote) {
      if (ch === '"' && s[i + 1] === '"') { cur += '"'; i += 2; }
      else if (ch === '"') { inQuote = false; i++; }
      else { cur += ch; i++; }
    } else {
      if (ch === '"') { inQuote = true; i++; }
      else if (ch === ',') { row.push(cur); cur = ''; i++; }
      else if (ch === '\r' && s[i + 1] === '\n') { row.push(cur); cur = ''; rows.push(row); row = []; i += 2; }
      else if (ch === '\n') { row.push(cur); cur = ''; rows.push(row); row = []; i++; }
      else { cur += ch; i++; }
    }
  }
  if (cur || row.length > 0) { row.push(cur); rows.push(row); }

  if (rows.length === 0) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => Object.fromEntries(headers.map((h, j) => [h, r[j] ?? ''])));
}

function buildDecisionsMap(
  feedback: FeedbackEntry[],
): Record<string, Record<string, Record<string, ChipDecision>>> {
  const map: Record<string, Record<string, Record<string, ChipDecision>>> = {};
  for (const f of feedback) {
    const rk = f.row_type === 'turn' ? `turn_${f.turn_number}` : f.row_type;
    if (!map[f.scenario_id]) map[f.scenario_id] = {};
    if (!map[f.scenario_id][rk]) map[f.scenario_id][rk] = {};
    map[f.scenario_id][rk][f.field] = { field: f.field, decision: f.decision, comment: f.comment };
  }
  return map;
}

export default function ClassificationView({ condition, classification, token }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [decisionsMap, setDecisionsMap] = useState<Record<string, Record<string, Record<string, ChipDecision>>>>({});

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/v1/api/reviewer/${condition}/${classification}/scenarios`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then(({ csv, feedback }: { csv: string; feedback: FeedbackEntry[] }) => {
        const rows = parseCsv(csv);
        const byScenario = new Map<string, typeof rows>();
        for (const row of rows) {
          const sid = row.scenario_id as string;
          if (!byScenario.has(sid)) byScenario.set(sid, []);
          byScenario.get(sid)!.push(row);
        }
        const scenarioList = Array.from(byScenario.entries()).map(([sid, srows]) => {
          const parts = sid.split('__');
          const flagPath = (parts[3] ?? 'green') as 'green' | 'yellow' | 'red';
          const phase = (srows[0]?.phase as string) ?? 'Unknown Phase';
          const parsedRows: ParsedRow[] = srows.map((r) => ({
            row_type: r.row_type as 'greeting' | 'turn' | 'assessment',
            turn_number: r.turn_number as string | undefined,
            expected: r.expected as string,
            patient_says: (r.patient_says as string) || undefined,
            nurse_says: (r.nurse_says as string) || undefined,
            scenario_id: sid,
            condition: r.condition as string | undefined,
            phase: r.phase as string | undefined,
            days_since_start: r.days_since_start as string | undefined,
            flag_path: flagPath,
          }));
          return { scenarioId: sid, flagPath, phase, description: `${flagPath} path`, rows: parsedRows };
        });
        setScenarios(scenarioList);
        setDecisionsMap(buildDecisionsMap(feedback));
        setLoading(false);
      })
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError') return;
        setError(String(err));
        setLoading(false);
      });
    return () => controller.abort();
  }, [condition, classification, token]);

  const handleDecide = useCallback(async (scenarioId: string, _rowKey: string, field: string, decision: 'correct' | 'needs_change', comment?: string) => {
    const rowData = scenarios.find((s) => s.scenarioId === scenarioId)?.rows.find((r: ParsedRow) => r.row_type !== 'turn' ? r.row_type === _rowKey : `turn_${r.turn_number}` === _rowKey);
    const row_type = rowData?.row_type ?? 'greeting';
    const turn_number = row_type === 'turn' ? Number(rowData?.turn_number) : undefined;
    await fetch(`/v1/api/reviewer/${condition}/${classification}/feedback`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario_id: scenarioId, row_type, turn_number, field, decision, comment }),
    });
    setDecisionsMap((prev) => ({
      ...prev,
      [scenarioId]: {
        ...(prev[scenarioId] ?? {}),
        [_rowKey]: { ...(prev[scenarioId]?.[_rowKey] ?? {}), [field]: { field, decision, comment } },
      },
    }));
  }, [scenarios, condition, classification, token]);

  const handleApprove = useCallback(async (scenarioId: string) => {
    await fetch(`/v1/api/reviewer/${condition}/${classification}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario_id: scenarioId }),
    });
  }, [condition, classification, token]);

  if (loading) return <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>;
  if (error) return <Alert severity="error">{error}</Alert>;
  if (scenarios.length === 0)
    return <Alert severity="info">No scenarios found for this classification. Run the generate-dataset CLI first.</Alert>;

  const scenariosWithDecisions = scenarios.map((s) => ({
    ...s,
    existingDecisions: decisionsMap[s.scenarioId] ?? {},
    onDecide: (rowKey: string, field: string, decision: 'correct' | 'needs_change', comment?: string) =>
      handleDecide(s.scenarioId, rowKey, field, decision, comment),
  }));

  return (
    <ScenarioList
      scenarios={scenariosWithDecisions}
      onApprove={handleApprove}
    />
  );
}
