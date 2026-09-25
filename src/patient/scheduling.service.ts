import { prisma } from '../core/database';
import { logger } from '../core/logger';
import { getTenantContext } from '../core/tenant-context-storage';

interface ScheduleCallInput {
  patientId: string;
  callPurpose: string;
  scheduledFor: Date;
  maxRetries?: number;
}

export class CallSchedulingService {
  /**
   * Schedule a new call
   */
  async scheduleCall(input: ScheduleCallInput): Promise<any> {
    try {
      // Get tenant context from AsyncLocalStorage
      const tenantContext = getTenantContext();

      if (!tenantContext) {
        throw new Error('Tenant context is required for scheduling calls');
      }

      logger.info('Scheduling new call', {
        patientId: input.patientId,
        callPurpose: input.callPurpose,
        scheduledFor: input.scheduledFor,
        tenantId: tenantContext.tenantId,
      });

      const scheduledCall = await prisma.scheduledCall.create({
        data: {
          patientId: input.patientId,
          callPurpose: input.callPurpose,
          scheduledFor: input.scheduledFor,
          status: 'PENDING',
          retryCount: 0,
          maxRetries: input.maxRetries || 3,
          tenantId: tenantContext.tenantId,
        },
      });

      logger.info('Call scheduled successfully', {
        id: scheduledCall.id,
        scheduledFor: scheduledCall.scheduledFor,
        tenantId: tenantContext.tenantId,
      });

      return scheduledCall;
    } catch (error: any) {
      logger.error('Failed to schedule call', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get all pending calls that are due
   */
  async getPendingCalls(currentTime: Date = new Date()): Promise<any[]> {
    try {
      // Tenant filtering is automatic via Prisma middleware
      const calls = await prisma.scheduledCall.findMany({
        where: {
          status: 'PENDING',
          scheduledFor: {
            lte: currentTime,
          },
        },
        include: {
          patient: true,
        },
        orderBy: {
          scheduledFor: 'asc',
        },
      });

      logger.info('Retrieved pending calls', {
        count: calls.length,
      });

      return calls;
    } catch (error: any) {
      logger.error('Failed to get pending calls', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Mark call as completed
   */
  async markAsCompleted(id: string, sessionId: string): Promise<any> {
    try {
      logger.info('Marking call as completed', { id, sessionId });

      // Tenant filtering is automatic via Prisma middleware
      const updated = await prisma.scheduledCall.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          sessionId,
        },
      });

      logger.info('Call marked as completed', { id });
      return updated;
    } catch (error: any) {
      logger.error('Failed to mark call as completed', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Mark call as failed
   */
  async markAsFailed(id: string): Promise<any> {
    try {
      logger.info('Marking call as failed', { id });

      // Tenant filtering is automatic via Prisma middleware
      const updated = await prisma.scheduledCall.update({
        where: { id },
        data: {
          status: 'FAILED',
        },
      });

      logger.info('Call marked as failed', { id });
      return updated;
    } catch (error: any) {
      logger.error('Failed to mark call as failed', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Increment retry count or mark as failed if max retries exceeded
   */
  async incrementRetry(id: string): Promise<any> {
    try {
      // Tenant filtering is automatic via Prisma middleware
      const call = await prisma.scheduledCall.findUnique({
        where: { id },
      });

      if (!call) {
        throw new Error('Scheduled call not found');
      }

      const newRetryCount = call.retryCount + 1;

      logger.info('Incrementing retry count', {
        id,
        currentRetryCount: call.retryCount,
        newRetryCount,
        maxRetries: call.maxRetries,
      });

      // Check if max retries exceeded
      if (newRetryCount >= call.maxRetries) {
        logger.warn('Max retries exceeded, marking as failed', { id });
        return await this.markAsFailed(id);
      }

      // Tenant filtering is automatic via Prisma middleware
      const updated = await prisma.scheduledCall.update({
        where: { id },
        data: {
          retryCount: newRetryCount,
        },
      });

      logger.info('Retry count incremented', { id, retryCount: newRetryCount });
      return updated;
    } catch (error: any) {
      logger.error('Failed to increment retry', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Cancel a scheduled call
   */
  async cancelScheduledCall(id: string): Promise<any> {
    try {
      logger.info('Cancelling scheduled call', { id });

      // Tenant filtering is automatic via Prisma middleware
      const updated = await prisma.scheduledCall.update({
        where: { id },
        data: {
          status: 'CANCELLED',
        },
      });

      logger.info('Scheduled call cancelled', { id });
      return updated;
    } catch (error: any) {
      logger.error('Failed to cancel scheduled call', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get scheduled calls for a patient
   */
  async getPatientScheduledCalls(patientId: string): Promise<any[]> {
    try {
      // Tenant filtering is automatic via Prisma middleware
      const calls = await prisma.scheduledCall.findMany({
        where: { patientId },
        orderBy: { scheduledFor: 'desc' },
      });

      logger.info('Retrieved patient scheduled calls', {
        patientId,
        count: calls.length,
      });

      return calls;
    } catch (error: any) {
      logger.error('Failed to get patient scheduled calls', {
        error: error.message,
      });
      throw error;
    }
  }
}

export const callSchedulingService = new CallSchedulingService();
