import { useState, type ReactNode } from 'react';
import { Box, Tab, Tabs, Typography, Paper } from '@mui/material';
import { useAuth } from '../context/AuthContext';
import MessagingChannelsTab from '../components/settings/MessagingChannelsTab';
import UserManagementTab from '../components/settings/UserManagementTab';

interface TabPanelProps {
  children: ReactNode;
  value: number;
  index: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div role="tabpanel" hidden={value !== index}>
      {value === index && <Box pt={3}>{children}</Box>}
    </div>
  );
}

export default function Settings() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState(0);

  return (
    <Box>
      <Typography variant="h4" gutterBottom>Settings</Typography>

      <Paper sx={{ mt: 2 }}>
        <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
          <Tab label="General" />
          {isAdmin && <Tab label="Messaging Channels" />}
          {isAdmin && <Tab label="User Management" />}
        </Tabs>

        <Box px={3} pb={3}>
          <TabPanel value={tab} index={0}>
            <Typography variant="body2" color="text.secondary">
              General settings coming soon.
            </Typography>
          </TabPanel>

          {isAdmin && (
            <TabPanel value={tab} index={1}>
              <MessagingChannelsTab />
            </TabPanel>
          )}

          {isAdmin && (
            <TabPanel value={tab} index={2}>
              <UserManagementTab />
            </TabPanel>
          )}
        </Box>
      </Paper>
    </Box>
  );
}
