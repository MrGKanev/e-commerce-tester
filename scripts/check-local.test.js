'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const sha = 'a'.repeat(40);
const marker = '<!-- e-commerce-tester:local-quality -->';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-pr-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'bin'));
  for (const name of ['check-local.js', 'artifact-privacy.js'])
    fs.copyFileSync(path.join(__dirname, name), path.join(root, 'scripts', name));
  fs.writeFileSync(path.join(root, 'head'), sha);
  fs.writeFileSync(path.join(root, 'comments.json'), '[]');
  function binary(name, body) {
    fs.writeFileSync(path.join(root, 'bin', name), `#!/usr/bin/env node\nconst fs=require('node:fs');\n${body}\n`, { mode: 0o755 });
  }
  binary('git', `
    if(process.argv[2]==='rev-parse')console.log(fs.readFileSync('head','utf8'));
    else if(process.argv[2]==='status')process.stdout.write(process.env.STUB_DIRTY||'');
    else process.exit(9);
  `);
  binary('pnpm', `
    const command=process.argv[2];
    if(command==='--version'){console.log('12.21.0');process.exit(0);}
    fs.appendFileSync('calls.jsonl',JSON.stringify(command)+'\\n');
    if(command===process.env.STUB_CHANGE_STEP)fs.writeFileSync('head','b'.repeat(40));
    if(command===process.env.STUB_WAIT_STEP){fs.writeFileSync('child-pid',String(process.pid));setInterval(()=>{},1000);}
    else if(command===process.env.STUB_FAIL_STEP){console.error('Authorization: Bearer sensitive-value\\nemail=person@example.test\\n</pre><script>unsafe</script>');process.exit(7);}
    else console.log('fixture passed');
  `);
  binary('gh', `
    const args=process.argv.slice(2);
    if(args[0]==='pr'){console.log(JSON.stringify({number:29,url:'https://github.com/example/store/pull/29',state:'OPEN',headRefOid:process.env.STUB_REMOTE_HEAD||'${sha}'}));process.exit(0);}
    if(args[0]!=='api')process.exit(9);
    const endpoint=args.find(arg=>arg.startsWith('repos/'));
    if(args.includes('user')){console.log(JSON.stringify({login:'tester'}));process.exit(0);}
    let comments=JSON.parse(fs.readFileSync('comments.json','utf8'));
    if(args.includes('--paginate')){console.log(JSON.stringify([comments]));process.exit(0);}
    const method=args[args.indexOf('--method')+1];
    if(method==='GET'&&endpoint.endsWith('/pulls/29')){console.log(JSON.stringify({state:'open',head:{sha:process.env.STUB_REMOTE_CHANGED?'b'.repeat(40):'${sha}'}}));process.exit(0);}
    const body=JSON.parse(fs.readFileSync(0,'utf8')).body;
    fs.appendFileSync('comment-writes.jsonl',JSON.stringify({method,body})+'\\n');
    if(process.env.STUB_UPLOAD_FAIL==='all'||(process.env.STUB_UPLOAD_FAIL&&body.includes('**Result: passed**'))){console.error('GitHub unavailable');process.exit(1);}
    const id=method==='PATCH'?Number(endpoint.split('/').at(-1)):100+comments.length;
    const comment={id,user:{login:'tester'},body,html_url:'https://github.com/example/store/pull/29#issuecomment-'+id};
    if(method==='PATCH')comments=comments.filter(item=>item.id!==id);
    comments.push(comment);fs.writeFileSync('comments.json',JSON.stringify(comments));console.log(JSON.stringify(comment));
  `);
  const env = { ...process.env, PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}` };
  delete env.GITHUB_STEP_SUMMARY;
  return { root, env };
}
function run(f, args = ['--pr']) {
  return spawnSync(process.execPath, ['scripts/check-local.js', ...args], { cwd: f.root, env: f.env, encoding: 'utf8', timeout: 15000 });
}
function calls(f) {
  const file = path.join(f.root, 'calls.jsonl');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse) : [];
}
function result(f) {
  const directory = path.join(f.root, 'reports/local-quality');
  return JSON.parse(fs.readFileSync(path.join(directory, fs.readdirSync(directory).sort().at(-1), 'result.json'), 'utf8'));
}
function comments(f) {
  return JSON.parse(fs.readFileSync(path.join(f.root, 'comments.json'), 'utf8'));
}

test('runs the shared sequence and updates only its own marked PR comment across repeated runs', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'comments.json'), JSON.stringify([
    { id: 1, user: { login: 'someone-else' }, body: marker + '\nOther author' },
    { id: 2, user: { login: 'tester' }, body: 'Unrelated review' },
  ]));
  for (let repeat = 0; repeat < 2; repeat++) {
    const execution = run(f, ['--pr', '29']);
    assert.equal(execution.status, 0, execution.stderr);
    assert.equal(result(f).status, 'passed');
    assert.equal(comments(f).length, 3);
  }
  assert.deepEqual(calls(f), ['check', 'build:css', 'test:acceptance:local', 'check', 'build:css', 'test:acceptance:local']);
  assert.equal(comments(f).find(comment => comment.id === 1).body, marker + '\nOther author');
  assert.equal(comments(f).find(comment => comment.id === 2).body, 'Unrelated review');
  assert.match(comments(f).find(comment => comment.id === 102).body, /Result: passed/);
  const writes = fs.readFileSync(path.join(f.root, 'comment-writes.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(writes.length, 2, 'One final publication per execution');
  for (const { body } of writes) {
    assert.doesNotMatch(body, /Result: running|Generated automatically|Full logs and report files|Developer-local reports/);
  }
});

test('failed checks stop the sequence, return nonzero and publish escaped/redacted diagnostics', t => {
  const f = fixture(t);
  f.env.STUB_FAIL_STEP = 'build:css';
  assert.equal(run(f).status, 1);
  assert.deepEqual(calls(f), ['check', 'build:css']);
  assert.equal(result(f).status, 'failed');
  assert.equal(result(f).checks[2].status, 'not run');
  const body = comments(f)[0].body;
  assert.match(body, /Result: failed/);
  assert.match(body, /&lt;\/pre&gt;&lt;script&gt;/);
  assert.doesNotMatch(body, /sensitive-value|person@example.test|<script>/);
});

test('CI/local mode requires no GitHub calls and writes the same formatted job summary', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'bin/gh'), '#!/usr/bin/env node\nprocess.exit(99);\n');
  f.env.GITHUB_STEP_SUMMARY = path.join(f.root, 'summary.md');
  assert.equal(run(f, []).status, 0);
  assert.equal(comments(f).length, 0);
  assert.deepEqual(calls(f), ['check', 'build:css', 'test:acceptance:local']);
  assert.match(fs.readFileSync(f.env.GITHUB_STEP_SUMMARY, 'utf8'), /Result: passed/);
});

test('dirty, unpushed or malformed requests are rejected before checks or comment writes', t => {
  for (const [key, value, args] of [
    ['STUB_DIRTY', ' M package.json', ['--pr']],
    ['STUB_REMOTE_HEAD', 'b'.repeat(40), ['--pr']],
    ['UNUSED', '', ['--pr', '29;unexpected']],
  ]) {
    const f = fixture(t);
    f.env[key] = value;
    assert.equal(run(f, args).status, 1);
    assert.deepEqual(calls(f), []);
    assert.equal(comments(f).length, 0);
  }
});

test('local or remote revision changes invalidate a completed run', t => {
  for (const [key, value] of [['STUB_CHANGE_STEP', 'build:css'], ['STUB_REMOTE_CHANGED', '1']]) {
    const f = fixture(t);
    f.env[key] = value;
    assert.equal(run(f).status, 1);
    assert.equal(result(f).status, 'failed');
    assert.match(comments(f)[0].body, /changed during validation/);
  }
});

test('publication failure returns nonzero and persists a failed local report', t => {
  for (const mode of ['passed', 'all']) {
    const f = fixture(t);
    f.env.STUB_UPLOAD_FAIL = mode;
    assert.equal(run(f).status, 1);
    assert.equal(result(f).status, 'failed');
    assert.match(result(f).problem, /GitHub unavailable/);
    for (const comment of comments(f)) assert.doesNotMatch(comment.body, /Result: passed/);
    assert.deepEqual(calls(f), ['check', 'build:css', 'test:acceptance:local']);
  }
});

test('SIGTERM stops the child process and reports cancellation without running later checks', { timeout: 15000 }, async t => {
  const f = fixture(t);
  f.env.STUB_WAIT_STEP = 'check';
  const child = spawn(process.execPath, ['scripts/check-local.js', '--pr'], { cwd: f.root, env: f.env, stdio: 'ignore' });
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
  const exited = new Promise(resolve => child.once('exit', resolve));
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(path.join(f.root, 'child-pid'))) {
    assert.ok(Date.now() < deadline, 'Stub check must start');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  child.kill('SIGTERM');
  assert.equal(await exited, 143);
  assert.deepEqual(calls(f), ['check']);
  assert.equal(result(f).status, 'cancelled');
  assert.match(comments(f)[0].body, /Result: cancelled/);
  const pid = Number(fs.readFileSync(path.join(f.root, 'child-pid'), 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
