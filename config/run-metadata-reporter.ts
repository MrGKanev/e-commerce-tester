import { readSiteSettings } from './site-settings';
import { mergeFindings, type Finding } from '../scripts/spelling-model';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import type {
  Reporter,
  FullConfig,
  FullResult,
  Suite,
  TestCase,
  TestResult,
  TestError,
} from '@playwright/test/reporter';

const requireJson = createRequire(__filename);

function sourceRevision() {
  try {
    const options = {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8' as const,
      stdio: ['ignore', 'pipe', 'ignore'] as ['ignore', 'pipe', 'ignore'],
    };
    return {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], options).trim(),
      dirty: !!execFileSync('git', ['status', '--porcelain'], options).trim(),
    };
  } catch {
    return { commit: null, dirty: null };
  }
}

type Scenario = {
  id: string;
  name: string;
  title: string;
  project: string;
  file: string;
  line: number;
  tags: string[];
  outcome: string;
  notApplicable: boolean;
  reasons: string[];
  urls?: string[];
  artifacts?: Array<{ name: string; path: string; contentType: string }>;
  activeRetry?: number;
  attempts: Array<{ retry: number; status: string; errors: string[] }>;
};

export default class RunMetadataReporter implements Reporter {
  private file: string;
  private metadata: Record<string, unknown> = {};
  private scenarios = new Map<string, Scenario>();
  private errors: string[] = [];
  private findings: Finding[] = [];
  private uncheckedLanguages = new Set<string>();
  constructor(options: { outputFile: string }) {
    this.file = options.outputFile;
    if (fs.existsSync(this.file)) this.metadata = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    this.metadata = {
      ...this.metadata,
      versions: {
        project: requireJson('../package.json').version,
        playwright: requireJson('@playwright/test/package.json').version,
        node: process.version,
      },
      source: sourceRevision(),
      phase: 'starting',
      startedAt: new Date().toISOString(),
    };
    this.write();
  }
  printsToStdio() {
    return false;
  }
  private write() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(
      temporary,
      JSON.stringify(
        { ...this.metadata, scenarios: [...this.scenarios.values()], errors: this.errors },
        null,
        2,
      ),
    );
    fs.renameSync(temporary, this.file);
  }
  onBegin(config: FullConfig, suite: Suite) {
    const selectedProjects = new Set(suite.allTests().map(test => test.parent.project()?.name));
    this.metadata = {
      ...this.metadata,
      site: this.metadata.site || {
        name: process.env.SITE_SLUG || 'Direct run',
        slug: process.env.SITE_SLUG || null,
        url: process.env.STORE_URL || config.projects[0]?.use.baseURL || null,
      },
      schemaVersion: 1,
      phase: 'running',
      startedAt: new Date().toISOString(),
      versions: {
        project: requireJson('../package.json').version,
        playwright: requireJson('@playwright/test/package.json').version,
        node: process.version,
      },
      platform: process.platform,
      configuration: readSiteSettings(),
      mode: process.env.RUN_MODE || null,
      projects: config.projects
        .filter(project => selectedProjects.has(project.name))
        .map(p => ({
          name: p.name,
          browser: p.use.browserName || 'chromium',
          locale: p.use.locale || 'en-US',
          timezone: p.use.timezoneId || null,
          viewport: p.use.viewport,
          retries: p.retries,
          repeatEach: p.repeatEach,
        })),
      selection: {
        ...((this.metadata.selection as Record<string, unknown>) || {
          args: process.argv.slice(2),
        }),
        grep: String(config.grep),
        grepInvert: config.grepInvert ? String(config.grepInvert) : null,
        shard: config.shard,
        tags: [...new Set(suite.allTests().flatMap(t => t.tags))],
      },
      selectedTests: suite.allTests().length,
    };
    for (const test of suite.allTests()) {
      this.scenarios.set(test.id, {
        id: test.id,
        name: test.title,
        title: test.titlePath().filter(Boolean).join(' › '),
        project: test.parent.project()?.name || '',
        file: path.relative(config.rootDir, test.location.file),
        line: test.location.line,
        tags: test.tags,
        outcome: 'not-run',
        notApplicable: false,
        reasons: [],
        attempts: [],
      });
    }
    this.write();
  }
  onTestBegin(test: TestCase, result: TestResult) {
    const scenario = this.scenarios.get(test.id)!;
    scenario.outcome = 'running';
    scenario.activeRetry = result.retry;
    this.write();
  }
  onTestEnd(test: TestCase, result: TestResult) {
    const scenario = this.scenarios.get(test.id)!;
    delete scenario.activeRetry;
    const annotations = [...test.annotations, ...result.annotations];
    scenario.outcome =
      result.status === 'interrupted'
        ? 'interrupted'
        : test.outcome() === 'expected'
          ? 'passed'
          : test.outcome() === 'flaky'
            ? 'flaky'
            : result.status === 'skipped'
              ? annotations.some(a => ['skip', 'fixme'].includes(a.type))
                ? 'skipped'
                : 'not-run'
              : 'failed';
    scenario.notApplicable =
      scenario.outcome === 'skipped' && annotations.some(a => a.type === 'not-applicable');
    scenario.reasons = [
      ...new Set(
        annotations
          .filter(a => ['skip', 'fixme', 'not-applicable'].includes(a.type))
          .map(a => a.description)
          .filter((text): text is string => !!text),
      ),
    ];
    scenario.attempts.push({
      retry: result.retry,
      status: result.status,
      errors: result.errors.map(e => e.message || e.value || 'Unspecified error'),
    });
    scenario.urls = [
      ...new Set(
        annotations
          .filter(a => a.type === 'url' || a.type === 'failure-url')
          .map(a => a.description)
          .filter((value): value is string => !!value),
      ),
    ];
    scenario.artifacts = result.attachments
      .filter(a => a.path && (a.contentType.startsWith('image/') || a.name === 'trace'))
      .map(a => ({
        name: a.name,
        path: path.relative(path.dirname(this.file), a.path!),
        contentType: a.contentType,
      }));
    for (const attachment of result.attachments.filter(a => a.name === 'spelling.json')) {
      const report = JSON.parse(
        attachment.body ? attachment.body.toString() : fs.readFileSync(attachment.path!, 'utf8'),
      ) as { findings: Finding[]; unsupportedLanguages: string[] };
      this.findings = mergeFindings(this.findings, report.findings);
      report.unsupportedLanguages.forEach(language => this.uncheckedLanguages.add(language));
      const spellingFile = path.join(path.dirname(this.file), 'spelling.json');
      fs.writeFileSync(
        spellingFile + '.tmp',
        JSON.stringify(
          {
            schemaVersion: 1,
            findings: this.findings,
            unsupportedLanguages: [...this.uncheckedLanguages],
          },
          null,
          2,
        ),
      );
      fs.renameSync(spellingFile + '.tmp', spellingFile);
    }
    const browserVersion = annotations.find(a => a.type === 'browser-version')?.description;
    if (browserVersion) {
      const versions = (this.metadata.browserVersions || {}) as Record<string, string>;
      versions[scenario.project] = browserVersion;
      this.metadata.browserVersions = versions;
    }
    this.write();
  }
  onError(error: TestError) {
    this.errors.push(error.message || error.value || 'Global error');
    this.write();
  }
  onEnd(result: FullResult) {
    this.metadata = {
      ...this.metadata,
      phase: 'finished',
      status: result.status,
      endedAt: new Date().toISOString(),
      duration: result.duration,
    };
    this.write();
  }
}
