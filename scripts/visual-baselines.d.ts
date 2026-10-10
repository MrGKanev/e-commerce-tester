export interface VisualEntry {
  id: string;
  site: string;
  run: string;
  name: string;
  project: string;
  file: string;
  sha256: string;
  environment: Record<string, unknown>;
  status: 'matched' | 'changed' | 'missing' | 'incompatible' | 'error';
  baselineRevision: string | null;
  hasBaseline: boolean;
  hasDiff: boolean;
  maxDiffPixelRatio: number;
}
export interface VisualManifest {
  revision: string | null;
  entries: Record<string, VisualEntry>;
}
export function baselineRoot(): string;
export function pin(
  root: string,
  site: string,
  run: string,
): { site: string; run: string; revision: string | null };
export function approved(root: string, site: string, revision?: string | null): VisualManifest;
export function baselineImage(
  root: string,
  site: string,
  manifest: VisualManifest,
  id: string,
): Buffer;
export function digest(value: string | Buffer): string;
export function atomic(file: string, data: unknown): void;
