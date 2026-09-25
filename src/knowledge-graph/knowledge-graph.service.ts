/**
 * Knowledge Graph Service
 * Manages XLSX clinical protocol parsing, validation, and storage
 */

import { prisma } from '../core/database';
import { logger } from '../core/logger';
import { getTenantContext } from '../core/tenant-context-storage';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import {
  KnowledgeGraph,
  ParseResult,
  UploadKnowledgeGraphRequest,
  UploadKnowledgeGraphResponse,
  ActivateKnowledgeGraphRequest,
  ActivateKnowledgeGraphResponse,
  ListKnowledgeGraphsQuery,
  KnowledgeGraphListItem,
} from './types';

export class KnowledgeGraphService {
  /**
   * Execute Python parser script and return parse result
   */
  private async executePythonParser(xlsxFilePath: string): Promise<ParseResult> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(xlsxFilePath)) {
        reject(new Error(`XLSX file not found: ${xlsxFilePath}`));
        return;
      }

      const scriptPath = path.join(
        __dirname,
        '..',
        '..',
        'scripts',
        'generate-knowledge-graph.py'
      );

      if (!fs.existsSync(scriptPath)) {
        reject(new Error(`Python script not found: ${scriptPath}`));
        return;
      }

      logger.info('Executing Python parser', { scriptPath, xlsxFilePath });

      const pythonProcess = spawn('python', [scriptPath, xlsxFilePath]);

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (data) => { stdout += data.toString(); });
      pythonProcess.stderr.on('data', (data) => { stderr += data.toString(); });

      pythonProcess.on('close', (code) => {
        if (code !== 0 && code !== 1) {
          logger.error('Python parser failed', { exitCode: code, stderr, stdout });
          reject(new Error(`Python parser exited with code ${code}: ${stderr || 'Unknown error'}`));
          return;
        }

        try {
          const result = JSON.parse(stdout) as ParseResult;
          logger.info('Python parser completed', { valid: result.valid, errorCount: result.error_count });
          resolve(result);
        } catch (error: any) {
          logger.error('Failed to parse Python output', { error: error.message, stdout, stderr });
          reject(new Error(`Failed to parse Python output: ${error.message}`));
        }
      });

      pythonProcess.on('error', (error) => {
        logger.error('Python process error', { error: error.message });
        reject(new Error(`Failed to spawn Python process: ${error.message}. Ensure Python 3.9+ is installed and in PATH.`));
      });
    });
  }

  /**
   * Upload and process a new knowledge graph from XLSX file.
   * The Condition name is derived from the parsed file — no manual input needed.
   */
  async uploadKnowledgeGraph(
    request: UploadKnowledgeGraphRequest
  ): Promise<UploadKnowledgeGraphResponse> {
    try {
      if (!fs.existsSync(request.filePath)) {
        throw new Error(`File not found: ${request.filePath}`);
      }

      const tenantContext = getTenantContext();
      if (!tenantContext) {
        throw new Error('Tenant context is required for uploading knowledge graphs');
      }

      // Parse first so we can derive the Condition name from the file
      const parseResult = await this.executePythonParser(request.filePath);

      const condition = parseResult.knowledge_graph?.condition?.name ?? request.condition;

      logger.info('Uploading knowledge graph', { condition, version: request.version });

      const existing = await prisma.knowledgeGraph.findUnique({
        where: {
          tenantId_condition_version: {
            tenantId: tenantContext.tenantId,
            condition,
            version: request.version,
          },
        },
      });

      if (existing) {
        throw new Error(`Knowledge graph already exists for condition "${condition}" version ${request.version}`);
      }

      // Extract phase names (union across all classifications)
      let phaseNames: string[] = [];
      const classifications = parseResult.knowledge_graph?.condition?.classifications;
      if (classifications) {
        const seen = new Set<string>();
        for (const cls of Object.values(classifications)) {
          for (const phaseKey of Object.keys(cls.phases || {})) seen.add(phaseKey);
        }
        phaseNames = Array.from(seen);
      }

      const sourceFileName = path.basename(request.filePath);

      const kg = await prisma.knowledgeGraph.create({
        data: {
          tenantId: tenantContext.tenantId,
          condition,
          version: request.version,
          status: 'DRAFT',
          isValid: parseResult.valid,
          validationErrors: parseResult.errors.length > 0 ? (parseResult.errors as any) : null,
          jsonData: (parseResult.knowledge_graph || {}) as any,
          filePath: request.filePath,
          sourceFileName,
          phaseNames,
        },
      });

      logger.info('Knowledge graph uploaded', { id: kg.id, isValid: kg.isValid, errorCount: parseResult.error_count });

      return {
        id: kg.id,
        isValid: kg.isValid,
        validationErrors: parseResult.errors.length > 0 ? parseResult.errors : null,
        knowledgeGraph: parseResult.knowledge_graph,
        status: kg.status as 'DRAFT' | 'ACTIVE' | 'ARCHIVED',
      };
    } catch (error: any) {
      logger.error('Failed to upload knowledge graph', { error: error.message, request });
      throw error;
    }
  }

  /**
   * Activate a knowledge graph (sets status to ACTIVE).
   * Deactivates any previously active graph for the same condition.
   */
  async activateKnowledgeGraph(
    request: ActivateKnowledgeGraphRequest
  ): Promise<ActivateKnowledgeGraphResponse> {
    try {
      logger.info('Activating knowledge graph', { id: request.id });

      const kg = await prisma.knowledgeGraph.findUnique({ where: { id: request.id } });

      if (!kg) throw new Error('Knowledge graph not found');
      if (!kg.isValid) throw new Error('Cannot activate invalid knowledge graph. Please fix validation errors first.');

      const currentActive = await prisma.knowledgeGraph.findFirst({
        where: { condition: kg.condition, status: 'ACTIVE', id: { not: request.id } },
      });

      await prisma.$transaction(async (tx) => {
        if (currentActive) {
          await tx.knowledgeGraph.update({ where: { id: currentActive.id }, data: { status: 'ARCHIVED' } });
          logger.info('Deactivated previous knowledge graph', { id: currentActive.id, condition: kg.condition });
        }
        await tx.knowledgeGraph.update({ where: { id: request.id }, data: { status: 'ACTIVE' } });
      });

      logger.info('Knowledge graph activated', { id: request.id, previousActiveId: currentActive?.id });

      return { id: request.id, status: 'ACTIVE', previousActiveId: currentActive?.id };
    } catch (error: any) {
      logger.error('Failed to activate knowledge graph', { error: error.message, id: request.id });
      throw error;
    }
  }

  /**
   * List knowledge graphs with optional filtering.
   */
  async listKnowledgeGraphs(query: ListKnowledgeGraphsQuery): Promise<KnowledgeGraphListItem[]> {
    try {
      logger.info('Listing knowledge graphs', query);

      const tenantContext = getTenantContext();
      if (!tenantContext) throw new Error('Tenant context is required for listing knowledge graphs');

      const whereClause: any = { tenantId: tenantContext.tenantId };
      if (query.condition) whereClause.condition = query.condition;
      if (query.status) whereClause.status = query.status;

      const knowledgeGraphs = await prisma.knowledgeGraph.findMany({
        where: whereClause,
        orderBy: [
          { condition: 'asc' },
          { status: 'desc' }, // ACTIVE first
          { createdAt: 'desc' },
        ],
        select: {
          id: true,
          condition: true,
          version: true,
          status: true,
          isValid: true,
          phaseNames: true,
          createdAt: true,
          updatedAt: true,
          jsonData: true,
        },
      });

      logger.info('Listed knowledge graphs', { count: knowledgeGraphs.length });

      return knowledgeGraphs.map((kg: any) => {
        const classificationMap = (kg.jsonData as any)?.condition?.classifications ?? {};
        const classifications = Object.keys(classificationMap);
        const conditionType = (kg.jsonData as any)?.condition?.condition_type ?? null;
        return {
          id: kg.id,
          condition: kg.condition,
          conditionType,
          classifications,
          version: kg.version,
          status: kg.status as 'DRAFT' | 'ACTIVE' | 'ARCHIVED',
          isValid: kg.isValid,
          phaseNames: kg.phaseNames,
          createdAt: kg.createdAt,
          updatedAt: kg.updatedAt,
        };
      });
    } catch (error: any) {
      logger.error('Failed to list knowledge graphs', { error: error.message, query });
      throw error;
    }
  }

  /**
   * Get a specific knowledge graph by ID
   */
  async getKnowledgeGraph(id: string): Promise<KnowledgeGraph | null> {
    try {
      logger.info('Getting knowledge graph', { id });
      const kg = await prisma.knowledgeGraph.findUnique({ where: { id } });
      if (!kg) return null;
      return kg.jsonData as unknown as KnowledgeGraph;
    } catch (error: any) {
      logger.error('Failed to get knowledge graph', { error: error.message, id });
      throw error;
    }
  }

  /**
   * Get the active knowledge graph for a condition name
   */
  async getActiveKnowledgeGraph(condition: string): Promise<KnowledgeGraph | null> {
    try {
      logger.info('Getting active knowledge graph', { condition });
      const kg = await prisma.knowledgeGraph.findFirst({
        where: { condition, status: 'ACTIVE' },
      });
      if (!kg) return null;
      return kg.jsonData as unknown as KnowledgeGraph;
    } catch (error: any) {
      logger.error('Failed to get active knowledge graph', { error: error.message, condition });
      throw error;
    }
  }

  /**
   * Get a specific knowledge graph by ID (returns full JSON)
   */
  async getKnowledgeGraphById(id: string): Promise<KnowledgeGraph | null> {
    try {
      logger.info('Getting knowledge graph by ID', { id });
      const kg = await prisma.knowledgeGraph.findUnique({ where: { id } });
      if (!kg) {
        logger.warn('Knowledge graph not found', { id });
        return null;
      }
      return kg.jsonData as unknown as KnowledgeGraph;
    } catch (error: any) {
      logger.error('Failed to get knowledge graph by ID', { error: error.message, id });
      throw error;
    }
  }

  /**
   * Delete a knowledge graph
   */
  async deleteKnowledgeGraph(id: string): Promise<void> {
    try {
      logger.info('Deleting knowledge graph', { id });

      const kg = await prisma.knowledgeGraph.findUnique({ where: { id } });
      if (!kg) throw new Error('Knowledge graph not found');

      // Patients no longer reference a KG at all (always resolved live to
      // whatever's active), and CallSession.knowledgeGraphId is a soft
      // historical reference, not a real foreign key -- so nothing blocks
      // deleting an old KG anymore, including archived ones.
      await prisma.knowledgeGraph.delete({ where: { id } });
      logger.info('Knowledge graph deleted', { id });
    } catch (error: any) {
      logger.error('Failed to delete knowledge graph', { error: error.message, id });
      throw error;
    }
  }

  /**
   * Archive a knowledge graph
   */
  async archiveKnowledgeGraph(id: string): Promise<void> {
    try {
      logger.info('Archiving knowledge graph', { id });
      await prisma.knowledgeGraph.update({ where: { id }, data: { status: 'ARCHIVED' } });
      logger.info('Knowledge graph archived', { id });
    } catch (error: any) {
      logger.error('Failed to archive knowledge graph', { error: error.message, id });
      throw error;
    }
  }
}

export const knowledgeGraphService = new KnowledgeGraphService();
