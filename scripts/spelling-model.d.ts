export interface Finding {
  id: string; language: string; component: string; source: string; text: string; word: string;
  suggestions: string[]; accepted: boolean; urls: string[];
  locations: Array<{ url: string; locator: string; rect: { x: number; y: number; width: number; height: number } }>;
}
export function fingerprint(finding: Omit<Finding, 'id'>): string;
export function mergeFindings(existing: Finding[], incoming: Finding[]): Finding[];
