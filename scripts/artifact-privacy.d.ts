export function sanitizeArtifact(value: unknown): unknown;
export function stringifyArtifact(value: unknown, replacer?: null, space?: number | string): string;
export function redactText(value: string): string;
export function createLogRedactor(
  write: (chunk: string) => void,
  maximumLineBytes?: number,
): { write(chunk: string | Buffer): void; end(): void };
export function privateResultsFile(outputFile?: string): string;
export function publishResults(inputFile: string, outputFile: string): void;
