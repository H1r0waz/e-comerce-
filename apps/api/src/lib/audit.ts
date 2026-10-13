export interface AuditEntryInput {
  organizationId: string;
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/** Persistence port; an adapter will write immutable entries to the database. */
export interface AuditWriter {
  append(entry: AuditEntryInput): Promise<void>;
}

export class NoopAuditWriter implements AuditWriter {
  async append(_entry: AuditEntryInput): Promise<void> {
    // Safe local-development default. Production composition must provide storage.
  }
}
