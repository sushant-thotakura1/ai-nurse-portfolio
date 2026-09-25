// admin-dashboard/src/pages/Reviewer/ScenarioList.tsx
import { Box, Typography, Divider } from '@mui/material';
import ScenarioCard, { ScenarioCardProps } from './ScenarioCard';

// Each scenario already carries its own onDecide bound to its scenarioId (via ClassificationView).
// ScenarioList does not need a shared onDecide — it just passes each scenario's own through the spread.
interface GroupedScenario extends Omit<ScenarioCardProps, 'onApprove'> {
  phase: string;
}

interface Props {
  scenarios: GroupedScenario[];
  onApprove: ScenarioCardProps['onApprove'];
}

export default function ScenarioList({ scenarios, onApprove }: Props) {
  // Group by phase
  const phases = Array.from(new Set(scenarios.map((s) => s.phase)));

  return (
    <Box>
      {phases.map((phase) => (
        <Box key={phase} mb={3}>
          <Typography variant="caption" fontWeight={700} textTransform="uppercase" letterSpacing={0.6} color="text.secondary">
            {phase}
          </Typography>
          <Divider sx={{ mb: 1 }} />
          {scenarios.filter((s) => s.phase === phase).map((s) => (
            <ScenarioCard
              key={s.scenarioId}
              {...s}
              onApprove={onApprove}
            />
          ))}
        </Box>
      ))}
    </Box>
  );
}
