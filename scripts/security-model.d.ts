export type Scope = {
  site: string;
  project: string;
  page: string;
  role: string;
  choice: string;
  profile: string;
  locale: string;
  timezoneId: string;
  stage: string;
};
export type Script = {
  key: string;
  kind: string;
  context: string;
  origin: string;
  urlHash: string;
  status: string;
  sha256?: string;
  bytes?: number;
  statusCode?: number;
  redirectFromHash?: string;
};
export type Destination = {
  key: string;
  origin: string;
  type: string;
  method: string;
  context: string;
  urlHash: string;
};
export type Payment = {
  documents: string[];
  forms: string[];
  formActions: string[];
  frames: string[];
  cardFields: number;
  overlayCardFields: number;
  sampleTruncated: boolean;
  framesInspected: number;
};
export type Finding = {
  rule: string;
  severity: 'warning' | 'high';
  evidence: Record<string, unknown>;
};
export type Stage = {
  scope: Scope;
  scripts: Script[];
  destinations: Destination[];
  payment: Payment;
  policy: {
    events: import('../tests/security-csp').CspViolation[];
    observedCount: number;
    truncated: boolean;
    installed: boolean;
    phaseAttribution: 'binding-receipt';
    tamperResistant: false;
  };
  coverage: { complete: boolean; [key: string]: unknown };
  findings: Finding[];
  status: string;
};
export type Approval = {
  scope: Scope;
  approvedAt: string;
  signature: {
    scripts: Array<{ key: string; sha256: string }>;
    destinations: string[];
    payment: Omit<Payment, 'sampleTruncated' | 'framesInspected'>;
  };
};
export type ReviewOptions = { replace?: boolean; addVariant?: boolean };
export type Baseline = {
  schemaVersion: 1;
  approvals: Approval[];
  history?: Array<{
    id: string;
    previousId: string | null;
    at: string;
    reason: string;
    mode: 'create' | 'replace' | 'add-variant';
    candidateHash: string;
    reviewHash: string;
    beforeHash: string;
    afterHash: string;
    changes: Array<{ before: Approval | null; after: Approval }>;
  }>;
};
export function hash(value: string | Buffer): string;
export function identity(value: string): { origin: string; pathHash: string; urlHash: string };
export function scopeKey(scope: Scope): string;
export function signature(stage: Stage): Baseline['approvals'][number]['signature'];
export function compare(stage: Stage, baseline?: Baseline): Finding[];
export function validateBaseline(value: unknown): Baseline;
export function baselinePath(file: string, repositoryRoot?: string): string;
export function loadBaseline(file: string, repositoryRoot?: string): Baseline | undefined;
export function approve(
  candidate: unknown,
  existing?: Baseline,
  options?: ReviewOptions & { reviewed?: boolean; reason?: string; reviewHash?: string },
): Baseline;

export function review(
  candidate: unknown,
  existing?: Baseline,
  options?: ReviewOptions,
): {
  schemaVersion: number;
  mode: string;
  baseHash: string;
  candidateHash: string;
  approvable: boolean;
  reviewHash: string;
  issues: Array<{ scopeHash: string; code: string }>;
  scopes: Array<{
    scopeHash: string;
    scope: Scope;
    complete: boolean;
    state: string;
    approvedAt: string | null;
    scripts: Array<{ keyHash: string; origin: string | null; before: string[]; after: string[] }>;
    destinations: {
      added: Array<{ keyHash: string; origin: string | null }>;
      removed: Array<{ keyHash: string; origin: string | null }>;
    };
    payment: Array<{ field: string; before: unknown; after: unknown }>;
  }>;
};

export function history(
  existing: Baseline,
  options?: { limit?: number; before?: string },
): {
  schemaVersion: number;
  baselineHash: string;
  total: number;
  legacy: boolean;
  nextBefore: string | null;
  entries: Array<{
    id: string;
    previousId: string | null;
    at: string;
    reason: string;
    mode: string;
    candidateHash: string;
    reviewHash: string;
    beforeHash: string;
    afterHash: string;
    scopes: Array<
      Omit<ReturnType<typeof review>['scopes'][number], 'complete' | 'state' | 'approvedAt'>
    >;
  }>;
};
