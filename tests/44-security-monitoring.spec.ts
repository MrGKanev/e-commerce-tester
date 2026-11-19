import { test, expect } from './fixtures';
import { readSiteSettings } from '../config/site-settings';
import { configuredPages } from './inventory';
import { BASE } from './helpers';
import { loadBaseline } from '../scripts/security-model';
import { observeSecurityScenario } from './security-monitoring';

const settings = readSiteSettings(),
  config = settings.securityMonitoring;
const pages = config.pages.length
  ? config.pages
  : configuredPages().map((entry, index) => ({
      name: `${entry.type}-${index}`,
      path: entry.url,
      role: 'storefront' as const,
    }));
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
for (const entry of pages)
  for (const choice of config.phases)
    test(
      `security monitoring — ${entry.name}: ${choice}`,
      { tag: ['@full', '@security'] },
      async ({ browser }, info) => {
        if (!config.enabled)
          info.annotations.push({
            type: 'not-applicable',
            description: 'Security monitoring disabled',
          });
        test.skip(!config.enabled, 'Security monitoring is not enabled');
        const context = await browser.newContext({
          ...info.project.use,
          storageState: { cookies: [], origins: [] },
          locale: settings.locale,
          timezoneId: settings.timezoneId,
          serviceWorkers: 'block',
        });
        try {
          const baseline = loadBaseline(config.baselineFile);
          const report = await observeSecurityScenario(
            await context.newPage(),
            config,
            {
              site: process.env.SITE_SLUG || new URL(BASE).hostname,
              project: info.project.name,
              page: entry.name,
              role: entry.role,
              choice,
              profile: config.profile,
              locale: settings.locale,
              timezoneId: settings.timezoneId,
            },
            new URL(entry.path, BASE).href,
            baseline,
          );
          await info.attach('security-monitoring.json', {
            body: JSON.stringify(report, null, 2),
            contentType: 'application/json',
          });
          await info.attach('security-monitoring.txt', {
            body:
              `Security monitoring: ${report.status}\n` +
              report.stages
                .map(
                  stage =>
                    `${stage.scope.stage}: ${stage.status}; ${stage.scripts.length} script observations; ${stage.destinations.length} destinations; ${stage.policy.observedCount} CSP events\n` +
                    stage.findings.map(f => `${f.severity}: ${f.rule}`).join('\n'),
                )
                .join('\n'),
            contentType: 'text/plain',
          });
          expect(
            report.stages.every(stage => stage.coverage.documentOk),
            'Security scenario must load its document and configured consent control',
          ).toBe(true);
          if (config.mode === 'strict')
            expect(
              report.status,
              'Security changes or incomplete evidence require review; see security-monitoring.json',
            ).toBe('matches-baseline');
        } finally {
          await context.close();
        }
      },
    );
