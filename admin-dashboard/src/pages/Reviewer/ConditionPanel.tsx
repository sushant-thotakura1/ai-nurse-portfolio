// admin-dashboard/src/pages/Reviewer/ConditionPanel.tsx
import { Box, Typography, List, ListItemButton, ListItemText } from '@mui/material';

interface Assignment {
  condition: string;
  classifications: string[];
}

interface Props {
  assignments: Assignment[];
  selected: { condition: string; classification: string } | null;
  onSelect: (condition: string, classification: string) => void;
}

export default function ConditionPanel({ assignments, selected, onSelect }: Props) {
  return (
    <Box sx={{ width: 240, borderRight: '1px solid #e0e0e0', height: '100%', overflow: 'auto', flexShrink: 0 }}>
      <Box sx={{ px: 2, py: 2, borderBottom: '1px solid #e0e0e0' }}>
        <Typography variant="subtitle2" fontWeight={700}>My Assignments</Typography>
      </Box>
      <List dense>
        {assignments.map((a) =>
          a.classifications.map((cls) => (
            <ListItemButton
              key={`${a.condition}__${cls}`}
              selected={selected?.condition === a.condition && selected?.classification === cls}
              onClick={() => onSelect(a.condition, cls)}
            >
              <ListItemText
                primary={cls}
                secondary={a.condition.replace(/_/g, ' ')}
              />
            </ListItemButton>
          ))
        )}
      </List>
    </Box>
  );
}
