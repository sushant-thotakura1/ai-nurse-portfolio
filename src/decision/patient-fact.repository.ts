import { Prisma, PrismaClient } from '@prisma/client';

export interface FactRow {
  id: string;
  factId: string;
  value: number | boolean | string | null;
  observedAt: Date;
  timeUncertaintyHours: number;
  extractionClass: string;
}

function extractValue(row: {
  valueNumber: number | null;
  valueBoolean: boolean | null;
  valueString: string | null;
}): number | boolean | string | null {
  if (row.valueNumber !== null) return row.valueNumber;
  if (row.valueBoolean !== null) return row.valueBoolean;
  if (row.valueString !== null) return row.valueString;
  return null;
}

function toFactRow(row: {
  id: string;
  factId: string;
  valueNumber: number | null;
  valueBoolean: boolean | null;
  valueString: string | null;
  observedAt: Date;
  timeUncertaintyHours: number;
  extractionClass: string;
}): FactRow {
  return {
    id: row.id,
    factId: row.factId,
    value: extractValue(row),
    observedAt: row.observedAt,
    timeUncertaintyHours: row.timeUncertaintyHours,
    extractionClass: row.extractionClass,
  };
}

export class PatientFactRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Live rows only — a row is live iff no row's supersedesId points to it.
   * Ordered: observedAt ASC, recordedAt ASC, id ASC.
   */
  async getLiveFacts(
    tenantId: string,
    patientId: string,
    factId: string,
  ): Promise<FactRow[]> {
    const rows = await this.prisma.patientFact.findMany({
      where: {
        tenantId,
        patientId,
        factId,
        supersededBy: { is: null },
      },
      orderBy: [
        { observedAt: 'asc' },
        { recordedAt: 'asc' },
        { id: 'asc' },
      ],
    });
    return rows.map(toFactRow);
  }

  /**
   * Newest live row within validForHours of now, else null.
   * Current-value clock: filters by observedAt >= now - validForHours.
   */
  async getCurrentValue(
    tenantId: string,
    patientId: string,
    factId: string,
    now: Date,
    validForHours: number,
  ): Promise<FactRow | null> {
    const cutoff = new Date(now.getTime() - validForHours * 60 * 60 * 1000);
    const rows = await this.prisma.patientFact.findMany({
      where: {
        tenantId,
        patientId,
        factId,
        supersededBy: { is: null },
        observedAt: { gte: cutoff },
      },
      orderBy: [
        { observedAt: 'asc' },
        { recordedAt: 'asc' },
        { id: 'asc' },
      ],
    });
    if (rows.length === 0) return null;
    return toFactRow(rows[rows.length - 1]);
  }

  /**
   * Live rows in [now - windowHours, now], oldest first.
   * Window clock — NOT filtered by validForHours.
   */
  async getWindowHistory(
    tenantId: string,
    patientId: string,
    factId: string,
    now: Date,
    windowHours: number,
  ): Promise<FactRow[]> {
    const cutoff = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
    const rows = await this.prisma.patientFact.findMany({
      where: {
        tenantId,
        patientId,
        factId,
        supersededBy: { is: null },
        observedAt: { gte: cutoff, lte: now },
      },
      orderBy: [
        { observedAt: 'asc' },
        { recordedAt: 'asc' },
        { id: 'asc' },
      ],
    });
    return rows.map(toFactRow);
  }

  /**
   * Write a new fact observation. tenantId is always explicit.
   */
  async save(data: {
    tenantId: string;
    patientId: string;
    factId: string;
    valueNumber?: number;
    valueBoolean?: boolean;
    valueString?: string;
    observedAt: Date;
    timeUncertaintyHours?: number;
    sourceSessionId?: string;
    supersedesId?: string;
    confidence?: number;
    extractionClass: string;
  }): Promise<FactRow> {
    const row = await this.prisma.patientFact.create({
      data: {
        tenantId: data.tenantId,
        patientId: data.patientId,
        factId: data.factId,
        valueNumber: data.valueNumber ?? null,
        valueBoolean: data.valueBoolean ?? null,
        valueString: data.valueString ?? null,
        observedAt: data.observedAt,
        timeUncertaintyHours: data.timeUncertaintyHours ?? 0,
        sourceSessionId: data.sourceSessionId,
        supersedesId: data.supersedesId,
        confidence: data.confidence,
        extractionClass: data.extractionClass,
      },
    });
    return toFactRow(row);
  }

  /**
   * Deletes every PatientFact row for this patient. Breaks the self-referential
   * supersedesId chain first (null out every row's supersedesId) so the
   * onDelete: Restrict constraint on that self-relation can't block the
   * deleteMany that follows -- a row can't be deleted while another row's
   * supersedesId still points at it.
   *
   * Pass an already-open `tx` (from a caller's own prisma.$transaction) to
   * compose this into a larger atomic operation -- e.g. flushing facts
   * atomically with the condition reassignment that triggered the flush.
   * When omitted, this method opens and commits its own transaction.
   *
   * Scoped to isTestIdentity patients only by the caller (see
   * set-health-condition.flow.ts) -- this method itself has no test-identity
   * check, it just does what it's told for the given patientId.
   */
  async flushForPatient(
    tenantId: string,
    patientId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const run = async (client: Prisma.TransactionClient | PrismaClient) => {
      await client.patientFact.updateMany({
        where: { tenantId, patientId },
        data: { supersedesId: null },
      });
      await client.patientFact.deleteMany({
        where: { tenantId, patientId },
      });
    };

    if (tx) {
      await run(tx);
    } else {
      await this.prisma.$transaction((innerTx) => run(innerTx));
    }
  }
}
