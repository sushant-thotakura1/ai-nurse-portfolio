import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import * as authModule from '../admin/auth/middleware';
import { ChannelsService, ChannelName, SttProviderName, VoiceProviderName, TtsProviderName } from './channels.service';

export function createChannelsRoutes(prisma: PrismaClient): Router {
  const router = Router({ mergeParams: true });

  // Factory creates a new service instance per call; allows test mocks on the prototype to take effect.
  const makeService = (): ChannelsService => new ChannelsService(prisma);

  // Apply auth + admin check to all routes in this router.
  // Delegates through module namespace so jest.spyOn on authMiddleware works in tests.
  router.use(
    (req: Request, res: Response, next: NextFunction) => authModule.authMiddleware(req, res, next),
    authModule.requireRole('admin', 'super_admin'),
  );

  // GET /v1/api/:tenantId/channels
  router.get('/', async (req: Request, res: Response): Promise<void> => {
    const tenantId = (req as any).tenantContext?.tenantId as string;
    const service = makeService();
    try {
      const [channels, baseUrl] = await Promise.all([
        service.getChannels(tenantId),
        service.getBaseUrl(tenantId),
      ]);
      res.json({ channels, baseUrl });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /v1/api/:tenantId/channels/base-url
  router.get('/base-url', async (req: Request, res: Response): Promise<void> => {
    const tenantId = (req as any).tenantContext?.tenantId as string;
    const service = makeService();
    try {
      const url = await service.getBaseUrl(tenantId);
      res.json({ url });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /v1/api/:tenantId/channels/base-url
  router.put('/base-url', async (req: Request, res: Response): Promise<void> => {
    const tenantId = (req as any).tenantContext?.tenantId as string;
    const { url } = req.body;
    if (!url) { res.status(400).json({ error: 'url is required' }); return; }
    const service = makeService();
    try {
      await service.saveBaseUrl(url, tenantId);
      res.json({ url });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /v1/api/:tenantId/channels/voice-provider
  router.get('/voice-provider', async (req: Request, res: Response): Promise<void> => {
    const tenantId = (req as any).tenantContext?.tenantId as string;
    try {
      const config = await makeService().getVoiceProviderConfig(tenantId);
      res.json(config);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /v1/api/:tenantId/channels/voice-provider
  router.put('/voice-provider', async (req: Request, res: Response): Promise<void> => {
    const tenantId = (req as any).tenantContext?.tenantId as string;
    const { provider, whisperBaseUrl } = req.body;
    if (provider !== 'sarvam' && provider !== 'whisper') {
      res.status(400).json({ error: 'provider must be "sarvam" or "whisper"' }); return;
    }
    try {
      await makeService().saveVoiceProviderConfig(tenantId, provider as VoiceProviderName, whisperBaseUrl);
      res.json({ success: true, provider });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /v1/api/:tenantId/channels/stt-provider
  router.get('/stt-provider', async (req: Request, res: Response): Promise<void> => {
    const tenantId = (req as any).tenantContext?.tenantId as string;
    try {
      const config = await makeService().getSttProviderConfig(tenantId);
      res.json(config);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /v1/api/:tenantId/channels/stt-provider
  router.put('/stt-provider', async (req: Request, res: Response): Promise<void> => {
    const tenantId = (req as any).tenantContext?.tenantId as string;
    const { provider, whisperBaseUrl } = req.body;
    if (provider !== 'sarvam' && provider !== 'whisper' && provider !== 'intron') {
      res.status(400).json({ error: 'provider must be "sarvam", "whisper", or "intron"' }); return;
    }
    try {
      await makeService().saveSttProviderConfig(tenantId, provider as SttProviderName, whisperBaseUrl);
      res.json({ success: true, provider });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /v1/api/:tenantId/channels/tts-provider
  router.get('/tts-provider', async (req: Request, res: Response): Promise<void> => {
    const tenantId = (req as any).tenantContext?.tenantId as string;
    try {
      const config = await makeService().getTtsConfig(tenantId);
      res.json(config);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /v1/api/:tenantId/channels/tts-provider
  router.put('/tts-provider', async (req: Request, res: Response): Promise<void> => {
    const tenantId = (req as any).tenantContext?.tenantId as string;
    const { provider, baseUrl } = req.body;
    if (!['sarvam', 'whisper-tts', 'edge-tts', 'intron'].includes(provider)) {
      res.status(400).json({ error: 'provider must be "sarvam", "whisper-tts", "edge-tts", or "intron"' }); return;
    }
    try {
      await makeService().saveTtsConfig(tenantId, provider as TtsProviderName, baseUrl);
      res.json({ success: true, provider });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /v1/api/:tenantId/channels/:channel
  router.put('/:channel', async (req: Request, res: Response): Promise<void> => {
    const tenantId = (req as any).tenantContext?.tenantId as string;
    const tenantSlug = (req as any).tenantContext?.tenantSlug as string;
    const channel = req.params['channel'] as string;
    if (channel !== 'telegram' && channel !== 'whatsapp') {
      res.status(400).json({ error: `Unsupported channel: ${channel}` }); return;
    }
    let baseUrl: string;
    try {
      baseUrl = await makeService().getBaseUrl(tenantId);
    } catch (err: any) {
      res.status(500).json({ error: err.message }); return;
    }
    if (!baseUrl) {
      res.status(400).json({ error: 'App Base URL is not configured. Set it first.' }); return;
    }
    try {
      const svc = makeService();
      const result = await svc.saveAndActivate(channel as ChannelName, req.body, tenantId, baseUrl, tenantSlug);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // DELETE /v1/api/:tenantId/channels/:channel
  router.delete('/:channel', async (req: Request, res: Response): Promise<void> => {
    const tenantId = (req as any).tenantContext?.tenantId as string;
    const channel = req.params['channel'] as string;
    if (channel !== 'telegram' && channel !== 'whatsapp') {
      res.status(400).json({ error: `Unsupported channel: ${channel}` }); return;
    }
    const service = makeService();
    try {
      const result = await service.deactivate(channel as ChannelName, tenantId);
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
