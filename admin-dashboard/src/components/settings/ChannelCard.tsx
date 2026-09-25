import { useState, useEffect } from 'react';
import {
  Button, Card, CardContent, Chip, CircularProgress,
  IconButton, InputAdornment, Stack, TextField, Typography, Alert,
} from '@mui/material';
import { ContentCopy as CopyIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import { ChannelName, ChannelSummary, generateSecureToken } from '../../services/channelsApi';
import { tenantStore } from '../../services/tenantStore';
import { useTenant } from '../../context/TenantContext';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TelegramFields {
  botToken: string;
  secretToken: string;
}

export interface WhatsAppFields {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  appSecret?: string;
}

export type ChannelFields = TelegramFields | WhatsAppFields;

interface ChannelCardProps {
  channel: ChannelName;
  config: ChannelSummary | null;
  baseUrl: string;
  onSaveAndActivate: (fields: ChannelFields) => Promise<void>;
  onDeactivate: () => Promise<void>;
}

// ── Status badge ─────────────────────────────────────────────────────────────

function StatusChip({ config }: { config: ChannelSummary | null }) {
  if (!config) return <Chip label="Not configured" color="warning" size="small" variant="outlined" />;
  if (config.isActive && config.channel === 'telegram') return <Chip label="Active" color="success" size="small" />;
  if (config.isActive && config.channel === 'whatsapp') return <Chip label="Configured" color="info" size="small" />;
  return <Chip label="Inactive" color="default" size="small" variant="outlined" />;
}

// ── Webhook URL row ───────────────────────────────────────────────────────────

function WebhookUrlRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <TextField
        label="Webhook URL"
        value={url}
        size="small"
        fullWidth
        slotProps={{ input: { readOnly: true } }}
        helperText={url ? undefined : 'Set App Base URL above first'}
      />
      {url && (
        <IconButton size="small" onClick={copy} title="Copy URL">
          <CopyIcon fontSize="small" color={copied ? 'success' : 'inherit'} />
        </IconButton>
      )}
    </Stack>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ChannelCard({ channel, config, baseUrl, onSaveAndActivate, onDeactivate }: ChannelCardProps) {
  const { tenantId, tenants } = useTenant();
  const tenantSlug = tenants.find(t => t.id === tenantId)?.slug ?? tenantStore.get();
  const webhookUrl = baseUrl ? `${baseUrl}/v1/api/${tenantSlug}/webhooks/${channel}` : '';

  // Credential fields are initialised with the masked values returned by the server
  // so they are visible on load. Unchanged masked values are detected in handleSave
  // and excluded from the update payload — only genuinely edited fields are sent.
  const m = config?.maskedSecrets ?? {};
  const [botToken, setBotToken] = useState(m.botToken ?? '');
  const [secretToken, setSecretToken] = useState(m.secretToken ?? '');
  const [phoneNumberId, setPhoneNumberId] = useState(m.phoneNumberId ?? '');
  const [accessToken, setAccessToken] = useState(m.accessToken ?? '');
  const [verifyToken, setVerifyToken] = useState(m.verifyToken ?? '');
  const [appSecret, setAppSecret] = useState(m.appSecret ?? '');

  // Re-sync field display whenever the parent passes updated config (e.g. after a save).
  useEffect(() => {
    const ms = config?.maskedSecrets ?? {};
    setBotToken(ms.botToken ?? '');
    setSecretToken(ms.secretToken ?? '');
    setPhoneNumberId(ms.phoneNumberId ?? '');
    setAccessToken(ms.accessToken ?? '');
    setVerifyToken(ms.verifyToken ?? '');
    setAppSecret(ms.appSecret ?? '');
  }, [config]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNote, setSuccessNote] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    setSuccessNote(null);

    // A field is "changed" when the user cleared the masked placeholder and typed
    // a new value. Unchanged masked values must NOT be sent — the backend treats
    // missing fields as "keep existing stored value".
    const masked = config?.maskedSecrets ?? {};
    const isChanged = (value: string, key: string) =>
      value.trim() !== '' && value !== masked[key];

    const hasExisting = !!config?.configured;
    if (channel === 'telegram') {
      if (!hasExisting && (!isChanged(botToken, 'botToken') || !isChanged(secretToken, 'secretToken'))) {
        setError('Bot Token and Secret Token are required.'); return;
      }
    } else {
      if (!hasExisting && (!isChanged(phoneNumberId, 'phoneNumberId') || !isChanged(accessToken, 'accessToken') || !isChanged(verifyToken, 'verifyToken'))) {
        setError('Phone Number ID, Access Token, and Verify Token are required.'); return;
      }
    }

    setLoading(true);
    try {
      // Only include genuinely changed fields — masked/unchanged values are omitted
      // so the backend can merge with the existing stored credentials.
      const fields = channel === 'telegram'
        ? { ...(isChanged(botToken, 'botToken') ? { botToken: botToken.trim() } : {}), ...(isChanged(secretToken, 'secretToken') ? { secretToken: secretToken.trim() } : {}) }
        : { ...(isChanged(phoneNumberId, 'phoneNumberId') ? { phoneNumberId: phoneNumberId.trim() } : {}), ...(isChanged(accessToken, 'accessToken') ? { accessToken: accessToken.trim() } : {}), ...(isChanged(verifyToken, 'verifyToken') ? { verifyToken: verifyToken.trim() } : {}), ...(isChanged(appSecret, 'appSecret') ? { appSecret: appSecret.trim() } : {}) };
      await onSaveAndActivate(fields as ChannelFields);
      if (channel === 'whatsapp') {
        setSuccessNote('Credentials saved. Paste the webhook URL above into your Meta developer portal to complete setup.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      const axiosMsg = (err as any)?.response?.data?.error;
      setError(axiosMsg ?? msg);
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivate = async () => {
    setError(null);
    setLoading(true);
    try {
      await onDeactivate();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Deactivate failed';
      const axiosMsg = (err as any)?.response?.data?.error;
      setError(axiosMsg ?? msg);
    } finally {
      setLoading(false);
    }
  };

  const title = channel === 'telegram' ? '🤖 Telegram' : '💬 WhatsApp Business';

  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
          <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
          <StatusChip config={config} />
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {successNote && <Alert severity="info" sx={{ mb: 2 }}>{successNote}</Alert>}

        <Stack spacing={2}>
          {config?.configured && (
            <Typography variant="caption" color="text.secondary">
              Existing credentials are shown masked. Clear a field and type a new value to update only that credential — unchanged fields are kept as-is.
            </Typography>
          )}

          {channel === 'telegram' ? (
            <>
              <TextField
                label="Bot Token *"
                value={botToken}
                onChange={e => setBotToken(e.target.value)}
                placeholder="Enter bot token"
                size="small"
                fullWidth
              />
              <TextField
                label="Secret Token *"
                value={secretToken}
                onChange={e => setSecretToken(e.target.value)}
                placeholder="Enter or generate a secret token"
                size="small"
                fullWidth
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={() => setSecretToken(generateSecureToken())} title="Generate">
                          <RefreshIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />
            </>
          ) : (
            <>
              <TextField label="Phone Number ID *" value={phoneNumberId} onChange={e => setPhoneNumberId(e.target.value)} placeholder="Enter phone number ID" size="small" fullWidth />
              <TextField label="Access Token *" value={accessToken} onChange={e => setAccessToken(e.target.value)} placeholder="Enter access token" size="small" fullWidth />
              <TextField
                label="Verify Token *"
                value={verifyToken}
                onChange={e => setVerifyToken(e.target.value)}
                placeholder="Enter or generate a verify token"
                size="small"
                fullWidth
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={() => setVerifyToken(generateSecureToken())} title="Generate">
                          <RefreshIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />
              <TextField label="App Secret (optional)" value={appSecret} onChange={e => setAppSecret(e.target.value)} placeholder="Enter app secret (optional)" size="small" fullWidth />
            </>
          )}

          <WebhookUrlRow url={webhookUrl} />
        </Stack>

        <Stack direction="row" spacing={1} mt={2}>
          <Button variant="contained" onClick={handleSave} disabled={loading}>
            {loading ? <CircularProgress size={18} /> : 'Save & Activate'}
          </Button>
          {config?.isActive && (
            <Button variant="outlined" color="error" onClick={handleDeactivate} disabled={loading}>
              Deactivate
            </Button>
          )}
        </Stack>

        {config?.lastRegisteredAt && (
          <Typography variant="caption" color="text.secondary" display="block" mt={1}>
            Last registered: {new Date(config.lastRegisteredAt).toLocaleString()}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
