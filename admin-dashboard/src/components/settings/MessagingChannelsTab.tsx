import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, CircularProgress, FormControlLabel, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material';
import { channelsApi, ChannelSummary, ChannelName, sttProviderApi, SttProviderName, SttProviderConfig, ttsProviderApi, TtsProviderName, TtsProviderConfig } from '../../services/channelsApi';
import ChannelCard, { ChannelFields } from './ChannelCard';
import { useTenant } from '../../context/TenantContext';
import { tenantsApi } from '../../services/tenantsApi';
import { tenantStore } from '../../services/tenantStore';

export default function MessagingChannelsTab() {
  const [baseUrl, setBaseUrl] = useState('');
  const [baseUrlInput, setBaseUrlInput] = useState('');
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [baseUrlSaving, setBaseUrlSaving] = useState(false);
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // STT provider state
  const [sttConfig, setSttConfig] = useState<SttProviderConfig>({ activeProvider: 'sarvam', whisperBaseUrl: 'http://speaches:8000/v1' });
  const [sttProvider, setSttProvider] = useState<SttProviderName>('sarvam');
  const [sttWhisperUrl, setSttWhisperUrl] = useState('http://speaches:8000/v1');
  const [sttSaving, setSttSaving] = useState(false);
  const [sttError, setSttError] = useState<string | null>(null);
  const [sttSuccess, setSttSuccess] = useState(false);

  // Session timeout setting
  const { tenants } = useTenant();
  const activeTenantId = tenantStore.get();
  const activeTenant = tenants.find(t => t.id === activeTenantId) ?? null;

  const [sessionTimeout, setSessionTimeout] = useState<number>(
    activeTenant?.settings?.whatsappSessionTimeoutMinutes ?? 30
  );
  const [timeoutSaving, setTimeoutSaving] = useState(false);
  const [timeoutError, setTimeoutError] = useState<string | null>(null);
  const [timeoutSuccess, setTimeoutSuccess] = useState(false);

  // TTS provider state
  const [ttsConfig, setTtsConfig] = useState<TtsProviderConfig>({ activeProvider: 'sarvam', baseUrl: 'http://edge-tts:8000/v1' });
  const [ttsProvider, setTtsProvider] = useState<TtsProviderName>('sarvam');
  const [ttsEdgeUrl, setTtsEdgeUrl] = useState('http://edge-tts:8000/v1');
  const [ttsSaving, setTtsSaving] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [ttsSuccess, setTtsSuccess] = useState(false);

  useEffect(() => {
    const timeout = activeTenant?.settings?.whatsappSessionTimeoutMinutes ?? 30;
    setSessionTimeout(timeout);
  }, [activeTenant]);

  // Load on mount
  useEffect(() => {
    Promise.all([
      channelsApi.getAll(),
      sttProviderApi.get(),
      ttsProviderApi.get(),
    ])
      .then(([{ channels, baseUrl }, stt, tts]) => {
        setChannels(channels);
        setBaseUrl(baseUrl);
        setBaseUrlInput(baseUrl);
        setSttConfig(stt);
        setSttProvider(stt.activeProvider);
        setSttWhisperUrl(stt.whisperBaseUrl);
        setTtsConfig(tts);
        setTtsProvider(tts.activeProvider);
        setTtsEdgeUrl(tts.baseUrl || 'http://edge-tts:8000/v1');
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to load channel configuration';
        setLoadError(msg);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSaveSessionTimeout = async () => {
    if (!activeTenantId) { setTimeoutError('No active tenant selected'); return; }
    setTimeoutError(null);
    setTimeoutSuccess(false);
    setTimeoutSaving(true);
    try {
      await tenantsApi.update(activeTenantId, {
        settings: { whatsappSessionTimeoutMinutes: sessionTimeout },
      });
      setTimeoutSuccess(true);
      setTimeout(() => setTimeoutSuccess(false), 3000);
    } catch (err: unknown) {
      setTimeoutError((err as any)?.response?.data?.error ?? (err instanceof Error ? err.message : 'Failed to save'));
    } finally {
      setTimeoutSaving(false);
    }
  };

  const handleSaveBaseUrl = async () => {
    setBaseUrlError(null);
    setBaseUrlSaving(true);
    try {
      await channelsApi.saveBaseUrl(baseUrlInput);
      setBaseUrl(baseUrlInput);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save URL';
      setBaseUrlError((err as any)?.response?.data?.error ?? msg);
    } finally {
      setBaseUrlSaving(false);
    }
  };

  const getChannelConfig = (channel: ChannelName): ChannelSummary | null =>
    channels.find(c => c.channel === channel) ?? null;

  const handleSaveAndActivate = (channel: ChannelName) => async (fields: ChannelFields) => {
    await channelsApi.saveAndActivate(channel, fields as unknown as Record<string, string>);
    try {
      const { channels: updated, baseUrl: updatedUrl } = await channelsApi.getAll();
      setChannels(updated);
      setBaseUrl(updatedUrl);
      setBaseUrlInput(updatedUrl);
    } catch {
      // Refresh failed but save succeeded — UI may be stale
    }
  };

  const handleSaveSttProvider = async () => {
    setSttError(null);
    setSttSuccess(false);
    setSttSaving(true);
    try {
      await sttProviderApi.save(
        sttProvider,
        sttProvider === 'whisper' ? sttWhisperUrl : undefined,
      );
      setSttConfig({ activeProvider: sttProvider, whisperBaseUrl: sttWhisperUrl });
      setSttSuccess(true);
      setTimeout(() => setSttSuccess(false), 3000);
    } catch (err: unknown) {
      setSttError((err as any)?.response?.data?.error ?? (err instanceof Error ? err.message : 'Failed to save'));
    } finally {
      setSttSaving(false);
    }
  };

  const handleSaveTtsProvider = async () => {
    setTtsError(null);
    setTtsSuccess(false);
    setTtsSaving(true);
    try {
      await ttsProviderApi.save(
        ttsProvider,
        ttsProvider === 'edge-tts' ? ttsEdgeUrl : undefined,
      );
      setTtsConfig({ activeProvider: ttsProvider, baseUrl: ttsEdgeUrl });
      setTtsSuccess(true);
      setTimeout(() => setTtsSuccess(false), 3000);
    } catch (err: unknown) {
      setTtsError((err as any)?.response?.data?.error ?? (err instanceof Error ? err.message : 'Failed to save'));
    } finally {
      setTtsSaving(false);
    }
  };

  const handleDeactivate = (channel: ChannelName) => async () => {
    await channelsApi.deactivate(channel);
    try {
      const { channels: updated } = await channelsApi.getAll();
      setChannels(updated);
    } catch {
      // Refresh failed but deactivate succeeded
    }
  };

  const sttLabel =
    sttConfig.activeProvider === 'whisper' ? 'OpenAI Whisper (speaches)' :
    sttConfig.activeProvider === 'intron' ? 'Intron AI (African languages)' :
    'Sarvam AI';
  const ttsLabel =
    ttsConfig.activeProvider === 'whisper-tts' ? 'Kokoro TTS (speaches)' :
    ttsConfig.activeProvider === 'edge-tts' ? 'edge-tts (Microsoft Neural)' :
    ttsConfig.activeProvider === 'intron' ? 'Intron AI (African languages)' :
    'Sarvam AI';

  if (loading) {
    return <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>;
  }

  return (
    <Box>
      {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}</Alert>}

      {/* App Base URL */}
      <Card variant="outlined" sx={{ mb: 3, bgcolor: 'primary.50' }}>
        <CardContent>
          <Typography variant="subtitle2" fontWeight={700} gutterBottom>App Base URL</Typography>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <TextField
              value={baseUrlInput}
              onChange={e => setBaseUrlInput(e.target.value)}
              placeholder="https://your-domain.com"
              size="small"
              fullWidth
              error={!!baseUrlError}
              helperText={baseUrlError ?? 'Webhook paths are derived automatically from this URL for all channels.'}
            />
            <Button variant="contained" onClick={handleSaveBaseUrl} disabled={baseUrlSaving} sx={{ whiteSpace: 'nowrap' }}>
              {baseUrlSaving ? <CircularProgress size={18} /> : 'Save URL'}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {/* Channel cards */}
      <ChannelCard
        channel="telegram"
        config={getChannelConfig('telegram')}
        baseUrl={baseUrl}
        onSaveAndActivate={handleSaveAndActivate('telegram')}
        onDeactivate={handleDeactivate('telegram')}
      />
      <ChannelCard
        channel="whatsapp"
        config={getChannelConfig('whatsapp')}
        baseUrl={baseUrl}
        onSaveAndActivate={handleSaveAndActivate('whatsapp')}
        onDeactivate={handleDeactivate('whatsapp')}
      />

      {/* Messaging Settings */}
      <Card variant="outlined" sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" fontWeight={700} gutterBottom>
            Messaging Settings
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Configure automatic session management for WhatsApp conversations.
          </Typography>

          <Stack direction="row" spacing={2} alignItems="flex-start">
            <TextField
              label="Session timeout (minutes)"
              type="number"
              value={sessionTimeout}
              onChange={e => setSessionTimeout(Math.max(5, Math.min(1440, Number(e.target.value))))}
              size="small"
              inputProps={{ min: 5, max: 1440 }}
              helperText="WhatsApp sessions with no activity for this long are automatically saved to Call Logs."
              sx={{ width: 260 }}
            />
            <Button
              variant="contained"
              onClick={handleSaveSessionTimeout}
              disabled={timeoutSaving}
              sx={{ mt: 0.5 }}
            >
              {timeoutSaving ? <CircularProgress size={18} /> : 'Save'}
            </Button>
          </Stack>

          {timeoutError && <Alert severity="error" sx={{ mt: 2 }}>{timeoutError}</Alert>}
          {timeoutSuccess && <Alert severity="success" sx={{ mt: 2 }}>Session timeout saved.</Alert>}
        </CardContent>
      </Card>

      {/* STT Provider */}
      <Card variant="outlined" sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" fontWeight={700} gutterBottom>
            Speech-to-Text (STT) Provider
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Handles transcription of patient audio. Currently active: <strong>{sttLabel}</strong>
          </Typography>

          <RadioGroup value={sttProvider} onChange={e => setSttProvider(e.target.value as SttProviderName)}>
            <FormControlLabel value="sarvam" control={<Radio />} label="Sarvam AI — best for Indian languages, cloud-based" />
            <FormControlLabel value="whisper" control={<Radio />} label="OpenAI Whisper (self-hosted via speaches) — language auto-detected" />
            <FormControlLabel value="intron" control={<Radio />} label="Intron AI — best for African languages (Swahili, Hausa, Yoruba, Zulu…), cloud-based" />
          </RadioGroup>

          {sttProvider === 'whisper' && (
            <TextField
              label="Speaches Base URL"
              value={sttWhisperUrl}
              onChange={e => setSttWhisperUrl(e.target.value)}
              size="small"
              fullWidth
              sx={{ mt: 2 }}
              helperText="URL of the speaches container (e.g. http://speaches:8000/v1)"
            />
          )}

          {sttProvider === 'intron' && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, ml: 0.5 }}>
              API key is read from the <code>INTRON_API_KEY</code> server environment variable.
            </Typography>
          )}

          {sttError && <Alert severity="error" sx={{ mt: 2 }}>{sttError}</Alert>}
          {sttSuccess && <Alert severity="success" sx={{ mt: 2 }}>STT provider saved successfully.</Alert>}

          <Box sx={{ mt: 2 }}>
            <Button variant="contained" onClick={handleSaveSttProvider} disabled={sttSaving}>
              {sttSaving ? <CircularProgress size={18} /> : 'Save STT Provider'}
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* TTS Provider */}
      <Card variant="outlined" sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" fontWeight={700} gutterBottom>
            Text-to-Speech (TTS) Provider
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Handles audio synthesis for nurse responses. Currently active: <strong>{ttsLabel}</strong>
          </Typography>

          <RadioGroup value={ttsProvider} onChange={e => setTtsProvider(e.target.value as TtsProviderName)}>
            <FormControlLabel value="sarvam" control={<Radio />} label="Sarvam AI — best for Indian languages, cloud-based" />
            <FormControlLabel
              value="whisper-tts"
              control={<Radio />}
              label="Kokoro TTS (speaches) — self-hosted, supports EN + HI; auto-falls back to Sarvam for other languages"
            />
            <FormControlLabel
              value="edge-tts"
              control={<Radio />}
              label="edge-tts (Microsoft Neural) — self-hosted, all Indian & African languages, voice auto-selected from locale"
            />
            <FormControlLabel
              value="intron"
              control={<Radio />}
              label="Intron AI — best for African languages (Swahili, Hausa, Yoruba, Zulu…), cloud-based"
            />
          </RadioGroup>

          {ttsProvider === 'edge-tts' && (
            <TextField
              label="edge-tts Base URL"
              value={ttsEdgeUrl}
              onChange={e => setTtsEdgeUrl(e.target.value)}
              size="small"
              fullWidth
              sx={{ mt: 2 }}
              helperText="URL of the openedai-speech container (e.g. http://edge-tts:8000/v1)"
            />
          )}

          {ttsProvider === 'intron' && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, ml: 0.5 }}>
              API key is read from the <code>INTRON_API_KEY</code> server environment variable.
            </Typography>
          )}

          {ttsError && <Alert severity="error" sx={{ mt: 2 }}>{ttsError}</Alert>}
          {ttsSuccess && <Alert severity="success" sx={{ mt: 2 }}>TTS provider saved successfully.</Alert>}

          <Box sx={{ mt: 2 }}>
            <Button variant="contained" onClick={handleSaveTtsProvider} disabled={ttsSaving}>
              {ttsSaving ? <CircularProgress size={18} /> : 'Save TTS Provider'}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
