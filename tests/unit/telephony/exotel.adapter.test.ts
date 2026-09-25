import { ExotelAdapter } from '../../../src/telephony/adapters/exotel.adapter';
import { OutboundCallRequest, CallStatus } from '../../../src/telephony/interfaces';

// Mock axios
jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ExotelAdapter', () => {
  let adapter: ExotelAdapter;
  const mockPost = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock axios.create to return an object with post method
    mockedAxios.create = jest.fn().mockReturnValue({
      post: mockPost,
    });

    adapter = new ExotelAdapter({
      apiKey: 'test-key',
      apiToken: 'test-token',
      sid: 'test-sid',
    });
  });

  describe('makeOutboundCall', () => {
    it('should initiate outbound call successfully', async () => {
      const request: OutboundCallRequest = {
        patientPhone: '+919876543210',
        locale: 'hi-IN',
        callPurpose: 'POST_SURGERY',
        sessionId: 'session-123',
      };

      mockPost.mockResolvedValueOnce({
        data: {
          Call: {
            Sid: 'call-sid-123',
            Status: 'queued',
          },
        },
      });

      const session = await adapter.makeOutboundCall(request);

      expect(session.sessionId).toBe('session-123');
      expect(session.callId).toBe('call-sid-123');
      expect(session.status).toBe(CallStatus.INITIATED);
    });
  });

  describe('endCall', () => {
    it('should end call successfully', async () => {
      mockPost.mockResolvedValueOnce({
        data: { success: true },
      });

      await expect(adapter.endCall('call-123')).resolves.not.toThrow();
    });
  });
});
