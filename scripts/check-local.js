'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { stripVTControlCharacters } = require('node:util');
const { redactText } = require('./artifact-privacy');

const root = path.resolve(__dirname, '..');
const marker = '<!-- e-commerce-tester:local-quality -->';
const commands = ['check', 'build:css', 'test:acceptance:local'];
const exec = (file, args, input) => execFileSync(file, args, {
  cwd: root, encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, GH_PROMPT_DISABLED: '1' },
}).trim();

function report(state) {
  const rows = state.checks.map(check =>
    `| \`pnpm ${check.command}\` | ${check.status} | ${check.seconds == null ? '—' : `${check.seconds} s`} |`,
  );
  let body = `${marker}\n## Local quality and browser checks\n\nGenerated automatically by \`scripts/check-local.js\`.\n\n` +
    `**Result: ${state.status}**\n\nCommit: \`${state.commit}\`\n\n` +
    `Environment: ${state.environment}\n\nStarted (UTC): ${state.startedAt}\n` +
    (state.finishedAt ? `\nFinished (UTC): ${state.finishedAt}\n` : '') +
    `\n| Command | Result | Duration |\n| --- | --- | --- |\n${rows.join('\n')}\n\n` +
    'The maintained CI acceptance chain runs sequentially against local fixtures. ' +
    'Expected negative reporting/visual/security fixtures are validated by their parent runners; command exit codes determine the result. ' +
    'Live stores and the additional five-profile Modern Web matrix are outside this run.\n\n' +
    'Full logs and report files stay in the ignored `reports/local-quality/` directory. ' +
    'Developer-local reports do not replace hosted GitHub Actions check results.\n';
  const diagnostics = state.checks.filter(check => check.tail).map(check => ({ label: `pnpm ${check.command}`, tail: check.tail }));
  if (state.problem) diagnostics.push({ label: 'Validation/reporting', tail: state.problem });
  for (const diagnostic of diagnostics) {
    const text = redactText(stripVTControlCharacters(diagnostic.tail)
      .replaceAll(root, '<repo>').replaceAll(os.homedir(), '<home>'))
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    body += `\n<details><summary>Diagnostic tail: ${diagnostic.label}</summary>\n\n<pre>${text}</pre>\n</details>\n`;
  }
  return body;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args[0] !== '--pr' || args.length > 2 || (args[1] && !/^[1-9]\d*$/.test(args[1]))))
    throw new Error('Usage: pnpm check:local OR pnpm check:pr [PR number]');
  const commit = exec('git', ['rev-parse', 'HEAD']);
  let api, commentPath, repoApi, prNumber, commentExists = false;
  if (args[0] === '--pr') {
    if (exec('git', ['status', '--porcelain']))
      throw new Error('Commit and push your changes before running PR validation.');
    const pr = JSON.parse(exec('gh', ['pr', 'view', ...(args[1] ? [args[1]] : []), '--json', 'number,url,state,headRefOid']));
    if (pr.state !== 'OPEN' || pr.headRefOid !== commit)
      throw new Error('The open PR must point to this exact local commit. Push it first.');
    const url = new URL(pr.url);
    const repository = url.pathname.split('/').slice(1, 3).join('/');
    repoApi = `repos/${repository}`;
    prNumber = pr.number;
    api = (method, endpoint, body) => JSON.parse(exec('gh', [
      'api', '--hostname', url.hostname, '--method', method, endpoint,
      ...(body ? ['--input', '-'] : []),
    ], body ? JSON.stringify(body) : undefined));
    const user = api('GET', 'user').login;
    const endpoint = `repos/${repository}/issues/${pr.number}/comments`;
    const pages = JSON.parse(exec('gh', ['api', '--hostname', url.hostname, '--paginate', '--slurp', `${endpoint}?per_page=100`]));
    const previous = pages.flat().findLast(comment => comment.user.login === user && comment.body?.startsWith(marker));
    commentPath = previous ? `repos/${repository}/issues/comments/${previous.id}` : endpoint;
    commentExists = Boolean(previous);
  }

  const directory = path.join(root, 'reports/local-quality', `${commit.slice(0, 12)}-${new Date().toISOString().replaceAll(':', '-')}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const state = {
    commit, status: 'running', startedAt: new Date().toISOString(),
    environment: `${os.platform()} ${os.arch()}, Node.js ${process.version}, pnpm ${exec('pnpm', ['--version'])}`,
    checks: commands.map(command => ({ command, status: 'pending' })),
  };
  let commentUrl, child, interrupted;
  const interrupt = signal => {
    interrupted = signal;
    if (child?.pid) {
      try {
        if (process.platform === 'win32') child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  };
  const onInt = () => interrupt('SIGINT');
  const onTerm = () => interrupt('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  function save() {
    const body = report(state);
    fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    fs.writeFileSync(path.join(directory, 'report.md'), body, { mode: 0o600 });
    return body;
  }
  function publish() {
    const body = save();
    if (api) {
      const comment = api(commentExists ? 'PATCH' : 'POST', commentPath, { body });
      if (!commentUrl) console.log(`PR report: ${comment.html_url}`);
      commentUrl = comment.html_url;
      commentPath = `${repoApi}/issues/comments/${comment.id}`;
      commentExists = true;
    }
  }
  try {
    publish();
    for (const [index, check] of state.checks.entries()) {
      if (interrupted) break;
      if (exec('git', ['rev-parse', 'HEAD']) !== commit || (api && exec('git', ['status', '--porcelain'])))
        throw new Error('The checkout changed during validation; this result is not valid for the PR.');
      check.status = 'running';
      publish();
      console.log(`[${index + 1}/${commands.length}] pnpm ${check.command}`);
      const log = path.join(directory, `${index + 1}.log`);
      const fd = fs.openSync(log, 'w', 0o600);
      const started = performance.now();
      const outcome = await new Promise(resolve => {
        child = spawn('pnpm', [check.command], { cwd: root, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
        for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]])
          stream.on('data', data => { fs.writeSync(fd, data); output.write(data); });
        child.on('error', error => fs.writeSync(fd, error.message));
        child.on('close', (code, signal) => resolve({ code, signal }));
      });
      child = undefined;
      fs.closeSync(fd);
      check.seconds = Number(((performance.now() - started) / 1000).toFixed(2));
      check.exitCode = outcome.code;
      check.signal = outcome.signal;
      check.status = interrupted ? 'cancelled' : outcome.code === 0 ? 'passed' : 'failed';
      console.log(`pnpm ${check.command}: ${check.status} (${check.seconds} s)`);
      if (check.status !== 'passed') {
        check.tail = fs.readFileSync(log, 'utf8').slice(-6000);
        break;
      }
      publish();
    }
    if (exec('git', ['rev-parse', 'HEAD']) !== commit || (api && exec('git', ['status', '--porcelain'])))
      throw new Error('The checkout changed during validation; this result is not valid for the PR.');
    if (api) {
      const pr = api('GET', `${repoApi}/pulls/${prNumber}`);
      if (pr.state !== 'open' || pr.head.sha !== commit)
        throw new Error('The PR changed during validation; this result is not valid for its current head.');
    }
    state.status = interrupted ? 'cancelled' : state.checks.every(check => check.status === 'passed') ? 'passed' : 'failed';
  } catch (error) {
    state.status = interrupted ? 'cancelled' : 'failed';
    state.problem = error.message;
  } finally {
    state.finishedAt = new Date().toISOString();
    for (const check of state.checks) {
      if (check.status === 'pending') check.status = 'not run';
      if (check.status === 'running') check.status = 'not completed';
    }
    try {
      publish();
    } catch (error) {
      state.status = interrupted ? 'cancelled' : 'failed';
      state.problem = error.message;
      save();
      console.error(redactText(error.message));
    } finally {
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
      console.log(`Local report: ${path.join(directory, 'report.md')}`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report(state));
  }
  process.exitCode = interrupted ? (interrupted === 'SIGINT' ? 130 : 143) : state.status === 'passed' ? 0 : 1;
}

main().catch(error => {
  console.error(redactText(error.message));
  process.exitCode = 1;
});
