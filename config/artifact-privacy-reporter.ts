import fs from 'node:fs';
import path from 'node:path';
import type { Reporter } from '@playwright/test/reporter';
import { publishResults } from '../scripts/artifact-privacy';

/** Built-in JSON writes privately; only filtered complete JSON is atomically published. */
export default class ArtifactPrivacyReporter implements Reporter {
  constructor(private options: { inputFile: string; outputFile: string }) {}
  printsToStdio() {
    return false;
  }
  onBegin() {
    // A failed replacement run must not expose an earlier final JSON as current results.
    fs.rmSync(this.options.outputFile, { force: true });
  }
  async onExit() {
    try {
      publishResults(this.options.inputFile, this.options.outputFile);
    } finally {
      const directory = path.dirname(this.options.inputFile);
      if (path.basename(directory).startsWith('e-commerce-private-results-'))
        fs.rmSync(directory, { recursive: true, force: true });
    }
  }
}
