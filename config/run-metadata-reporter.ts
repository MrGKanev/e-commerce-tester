import { controlEvent } from './control-events';
import type { VitalDocument } from '../tests/web-vitals';
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
  private completed = 0;
  private total = 0;
  private metadata: Record<string, unknown> = {};
  private scenarios = new Map<string, Scenario>();
  private errors: string[] = [];
  private findings: Finding[] = [];
  private vitalChecks: Record<string, unknown>[] = [];
  private vitalDocuments = new Map<string, VitalDocument>();
  private commerceChecks: Record<string, unknown>[] = [];
  private buyerJourneys: Record<string, unknown>[] = [];
  private ocrTotals = { imagesChecked: 0, wordsRecognized: 0, lowConfidenceSkipped: 0 };
  private ocrEnabled = false;
  private ocrEngines = new Set<string>();
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
      cookieConsent: readSiteSettings().cookieConsent,
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
    this.total = suite.allTests().length;
    controlEvent({ type: 'begin', total: this.total, completed: 0 });
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
      visualBaseline: config.metadata.visualBaseline || null,
      configuration: readSiteSettings(),
      mode: process.env.RUN_MODE || null,
      projects: config.projects
        .filter(project => selectedProjects.has(project.name))
        .map(p => ({
          name: p.name || 'Unknown browser',
          isMobile: p.use.isMobile || false,
          hasTouch: p.use.hasTouch || false,
          deviceScaleFactor: p.use.deviceScaleFactor || 1,
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
        project: test.parent.project()?.name || 'Unknown browser',
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
  onStepBegin(
    _test: TestCase,
    _result: TestResult,
    step: import('@playwright/test/reporter').TestStep,
  ) {
    if (step.category === 'test.step' || step.category === 'pw:api')
      controlEvent({ type: 'step', title: step.title });
  }
  onTestBegin(test: TestCase, result: TestResult) {
    controlEvent({
      type: 'test',
      title: test.titlePath().slice(1).join(' › '),
      project: test.parent.project()?.name,
      file: path.basename(test.location.file),
      total: this.total,
      completed: this.completed,
    });
    const scenario = this.scenarios.get(test.id)!;
    scenario.outcome = 'running';
    scenario.activeRetry = result.retry;
    this.write();
  }
  onTestEnd(test: TestCase, result: TestResult) {
    this.completed++;
    controlEvent({
      type: 'result',
      title: test.title,
      status: result.status,
      total: this.total,
      completed: this.completed,
    });
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
      .filter(
        a =>
          a.path &&
          (a.contentType.startsWith('image/') ||
            a.name === 'trace' ||
            a.name === 'commerce-consistency.json' ||
            a.name === 'buyer-journey.json'),
      )
      .map(a => ({
        name: a.name,
        path: path.relative(path.dirname(this.file), a.path!),
        contentType: a.contentType,
      }));
    for (const attachment of result.attachments.filter(
      a => a.name === 'third-party-scripts.json',
    )) {
      const report = JSON.parse(
        attachment.body ? attachment.body.toString() : fs.readFileSync(attachment.path!, 'utf8'),
      );
      const file = path.join(path.dirname(this.file), 'third-party-scripts.json');
      const prior = fs.existsSync(file)
        ? JSON.parse(fs.readFileSync(file, 'utf8'))
        : { scripts: [] };
      fs.writeFileSync(
        file,
        JSON.stringify(
          { complete: true, scripts: [...new Set([...prior.scripts, ...report.scripts])].sort() },
          null,
          2,
        ),
      );
    }
    for (const attachment of result.attachments.filter(a => a.name === 'buyer-journey.json')) {
      const report = JSON.parse(
        attachment.body ? attachment.body.toString() : fs.readFileSync(attachment.path!, 'utf8'),
      ) as Record<string, unknown>;
      this.buyerJourneys.push(report);
      const file = path.join(path.dirname(this.file), 'buyer-journeys.json');
      fs.writeFileSync(
        file + '.tmp',
        JSON.stringify({ schemaVersion: 1, checks: this.buyerJourneys }, null, 2),
      );
      fs.renameSync(file + '.tmp', file);
    }
    for (const attachment of result.attachments.filter(
      a => a.name === 'commerce-consistency.json',
    )) {
      const report = JSON.parse(
        attachment.body ? attachment.body.toString() : fs.readFileSync(attachment.path!, 'utf8'),
      ) as Record<string, unknown>;
      this.commerceChecks.push(report);
      const file = path.join(path.dirname(this.file), 'commerce-consistency.json');
      fs.writeFileSync(
        file + '.tmp',
        JSON.stringify({ schemaVersion: 1, checks: this.commerceChecks }, null, 2),
      );
      fs.renameSync(file + '.tmp', file);
    }
    for (const attachment of result.attachments.filter(a => a.name === 'web-vitals.json')) {
      const report = JSON.parse(
        attachment.body ? attachment.body.toString() : fs.readFileSync(attachment.path!, 'utf8'),
      ) as { documents: VitalDocument[]; checks: Record<string, unknown>[] };
      this.vitalChecks.push(...report.checks);
      for (const document of report.documents) this.vitalDocuments.set(document.id, document);
      const file = path.join(path.dirname(this.file), 'web-vitals.json');
      fs.writeFileSync(
        file + '.tmp',
        JSON.stringify(
          {
            schemaVersion: 1,
            synthetic: true,
            documents: [...this.vitalDocuments.values()],
            checks: this.vitalChecks,
          },
          null,
          2,
        ),
      );
      fs.renameSync(file + '.tmp', file);
    }
    for (const attachment of result.attachments.filter(a => a.name === 'spelling.json')) {
      const report = JSON.parse(
        attachment.body ? attachment.body.toString() : fs.readFileSync(attachment.path!, 'utf8'),
      ) as {
        findings: Finding[];
        unsupportedLanguages: string[];
        ocr?: {
          enabled: boolean;
          engine: string;
          imagesChecked: number;
          wordsRecognized: number;
          lowConfidenceSkipped: number;
        };
      };
      this.findings = mergeFindings(this.findings, report.findings);
      if (report.ocr) {
        this.ocrEnabled ||= report.ocr.enabled;
        if (report.ocr.engine) this.ocrEngines.add(report.ocr.engine);
        for (const key of ['imagesChecked', 'wordsRecognized', 'lowConfidenceSkipped'] as const)
          this.ocrTotals[key] += report.ocr[key];
      }
      report.unsupportedLanguages.forEach(language => this.uncheckedLanguages.add(language));
      const spellingFile = path.join(path.dirname(this.file), 'spelling.json');
      fs.writeFileSync(
        spellingFile + '.tmp',
        JSON.stringify(
          {
            schemaVersion: 1,
            ocr: { enabled: this.ocrEnabled, ...this.ocrTotals, engines: [...this.ocrEngines] },
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
