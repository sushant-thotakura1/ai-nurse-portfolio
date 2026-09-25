import { ReactNode, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  Button,
  Drawer,
  AppBar,
  Toolbar,
  List,
  Typography,
  Divider,
  IconButton,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  People as PeopleIcon,
  Phone as PhoneIcon,
  Science as ScienceIcon,
  Settings as SettingsIcon,
  Description as KnowledgeIcon,
  Article as ArticleIcon,
  Vaccines as VaccinesIcon,
  Logout as LogoutIcon,
  AdminPanelSettings as SuperAdminIcon,
} from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { useScreeningEnabled } from '../hooks/useScreeningEnabled';

const drawerWidth = 240;

interface LayoutProps {
  children: ReactNode;
}

interface NavItem {
  text: string;
  icon: ReactNode;
  path: string;
}

const navItems: NavItem[] = [
  { text: 'Dashboard', icon: <DashboardIcon />, path: '/dashboard' },
  { text: 'Patients', icon: <PeopleIcon />, path: '/patients' },
  { text: 'Call Logs', icon: <PhoneIcon />, path: '/call-logs' },
  { text: 'Knowledge Graphs', icon: <KnowledgeIcon />, path: '/knowledge-graphs' },
  { text: 'Clinical Documents', icon: <ArticleIcon />, path: '/documents' },
  { text: 'Test Conversation', icon: <ScienceIcon />, path: '/test-conversation' },
  { text: 'Settings', icon: <SettingsIcon />, path: '/settings' },
];

const superAdminNavItem: NavItem = {
  text: 'Super Admin',
  icon: <SuperAdminIcon />,
  path: '/super-admin',
};

export default function Layout({ children }: LayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { email, logout, isSuperAdmin } = useAuth();
  const { tenantId, setTenantId, tenants } = useTenant();
  const { enabled: screeningEnabled } = useScreeningEnabled();

  const screeningNavItem: NavItem = {
    text: 'Screening Records',
    icon: <VaccinesIcon />,
    path: '/screening-records',
  };
  const baseNavItems = screeningEnabled
    ? [...navItems.slice(0, 3), screeningNavItem, ...navItems.slice(3)]
    : navItems;
  const allNavItems = isSuperAdmin ? [...baseNavItems, superAdminNavItem] : baseNavItems;

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleNavigation = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };

  const drawer = (
    <div>
      <Toolbar>
        <Typography variant="h6" noWrap component="div">
          AI Nurse Admin
        </Typography>
      </Toolbar>
      <Divider />
      <List>
        {allNavItems.map((item) => (
          <ListItem key={item.text} disablePadding>
            <ListItemButton
              selected={location.pathname === item.path}
              onClick={() => handleNavigation(item.path)}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.text} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </div>
  );

  return (
    <Box sx={{ display: 'flex', width: '100%' }}>
      <AppBar
        position="fixed"
        sx={{
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          ml: { sm: `${drawerWidth}px` },
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { sm: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
            REAN Foundation - AI Nurse Voice Agent
          </Typography>
          {email && (
            <Typography variant="body2" sx={{ mr: 2, opacity: 0.85, display: { xs: 'none', sm: 'block' } }}>
              {email}
            </Typography>
          )}
          {isSuperAdmin && tenants.length > 0 && (
            <FormControl size="small" sx={{ minWidth: 200, mr: 2 }}>
              <InputLabel id="tenant-select-label" sx={{ color: 'white' }}>Tenant</InputLabel>
              <Select
                labelId="tenant-select-label"
                value={tenantId}
                label="Tenant"
                onChange={(e: SelectChangeEvent) => setTenantId(e.target.value)}
                sx={{ color: 'white', '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.5)' } }}
              >
                {tenants.map((t) => (
                  <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          <Tooltip title="Sign out">
            <Button
              color="inherit"
              onClick={logout}
              startIcon={<LogoutIcon />}
              size="small"
            >
              Logout
            </Button>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Box
        component="nav"
        sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{
            keepMounted: true,
          }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
            },
          }}
        >
          {drawer}
        </Drawer>

        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
            },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { sm: `calc(100% - ${drawerWidth}px)` },
        }}
      >
        <Toolbar />
        {children}
      </Box>
    </Box>
  );
}
