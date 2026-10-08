import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { installCloudflare, verifyDeployment, LOGIN_SCOPES, parseArguments, parseJSONC, parseCommandJSON, cloudEnvironment, validPassword, validExistingPassword, validateWorkerURL, deploymentURL } from './install-cloudflare.mjs';

const firstAccount = 'a'.repeat(32), secondAccount = 'b'.repeat(32);
const dbId = '12345678-1234-4321-9876-123456789abc';
const password = 'Installer-password-123!';
const user = { loggedIn: true, authType: 'OAuth Token', accounts: [{ id: firstAccount, name: 'Personal' }], tokenPermissions: LOGIN_SCOPES };

async function fixture(t, settings = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rooyesh installer فارسی-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'source with spaces'), installDir = path.join(directory, 'saved-install');
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'wrangler.jsonc'), '{ "name":"seo-studio", "main":"worker/index.ts", "compatibility_date":"2026-10-07", "assets":{"directory":"./dist","binding":"ASSETS"}, "d1_databases":[{"binding":"DB", "database_id":"00000000-0000-0000-0000-000000000000", "database_name":"seo-studio-db", "migrations_dir":"migrations"}] }');
  const calls = [], requests = [], messages = [], opened = [], prompts = [], secretPrompts = [];
  const cloud = { databases: [], secrets: [], user: structuredClone(user), revision: 7, ...settings.cloud };
  let createFailures = settings.createFailures || 0, secretFailures = settings.secretFailures || 0, authFailures = settings.authFailures || 0;
  const secretAnswers = [...(settings.secretAnswers || [password, password, password])];
  const promptAnswers = [...(settings.promptAnswers || [])];
  const runner = async call => {
    calls.push({ ...call });
    const args = call.args.slice(1);
    if (call.args[0] === 'npm-cli-test.js') {
      if (settings.npmFailure) throw new Error('Build failed');
      return { stdout: '', stderr: '' };
    }
    const [command, operation] = args;
    const config = JSON.parse(await readFile(args[args.indexOf('--config') + 1], 'utf8'));
    if (command === 'whoami') {
      if (authFailures > 0) { authFailures--; throw new Error('Not signed in'); }
      return { stdout: JSON.stringify(cloud.user), stderr: '' };
    }
    if (command === 'login') return { stdout: '', stderr: '' };
    if (command === 'd1' && operation === 'list') return { stdout: JSON.stringify(cloud.databases), stderr: '' };
    if (command === 'd1' && operation === 'create') {
      cloud.databases.push({ name: args[2], uuid: dbId, account: config.account_id });
      if (createFailures > 0) { createFailures--; throw new Error('Connection lost after database creation'); }
      return { stdout: 'Database created', stderr: '' };
    }
    if (command === 'd1' && operation === 'migrations') return { stdout: 'Migrations applied', stderr: '' };
    if (command === 'secret' && operation === 'list') {
      if (settings.secretListFailure && cloud.secrets.length === 0) {
        const error = new Error('Cloudflare secret list failed');
        error.output = settings.secretListFailure === 'missing-worker' ? `Worker \"${config.name}\" not found.\nIf this is a new Worker, run wrangler deploy first.` : 'Authentication denied [code: 10000]';
        throw error;
      }
      return { stdout: JSON.stringify(cloud.secrets), stderr: '' };
    }
    if (command === 'secret' && operation === 'put') {
      assert.equal(call.input, `${password}\n`);
      cloud.secrets.push({ name: 'APP_PASSWORD', type: 'secret_text' });
      if (secretFailures > 0) { secretFailures--; throw new Error('Connection lost after password upload'); }
      return { stdout: 'Secret uploaded', stderr: '' };
    }
    if (command === 'deploy' && args.includes('--dry-run')) return { stdout: 'Dry run passed', stderr: '' };
    if (command === 'deploy') {
      const outputPath = call.env.WRANGLER_OUTPUT_FILE_PATH;
      assert.equal(call.interactive, true, 'first-time workers.dev prompts remain interactive');
      try { await readFile(outputPath); assert.fail('previous deployment output should be cleared'); } catch (error) { assert.equal(error.code, 'ENOENT'); }
      const url = `https://${config.name}.personal.workers.dev`;
      await writeFile(outputPath, `${JSON.stringify({ type: 'deploy', worker_name: config.name, targets: [url] })}\n`);
      return { stdout: '', stderr: '' };
    }
    throw new Error(`Unexpected command ${args.join(' ')}`);
  };
  const dependencies = {
    root, installDir, runner, npmCLI: 'npm-cli-test.js', randomBytes: () => Buffer.from('1234567890abcdef12345678', 'hex'),
    env: { PATH: 'example', CLOUDFLARE_API_TOKEN: 'unrelated inherited token', CLOUDFLARE_ACCOUNT_ID: secondAccount },
    log: line => messages.push(line),
    prompt: async message => { prompts.push(message); assert.ok(promptAnswers.length, 'unexpected prompt'); return promptAnswers.shift(); },
    secret: async message => { secretPrompts.push(message); assert.ok(secretAnswers.length, 'unexpected secret prompt'); return secretAnswers.shift(); },
    openBrowser: async url => opened.push(url), sleep: async () => {},
    fetcher: async (url, options = {}) => {
      requests.push({ url, options });
      assert.equal(options.redirect, 'error');
      if (url.endsWith('/api/status')) return Response.json({ configured: true });
      if (url.endsWith('/api/login')) {
        if (settings.badPassword) return Response.json({ error: 'INVALID_PASSWORD' }, { status: 401 });
        assert.equal(JSON.parse(options.body).password, settings.loginPassword ?? password);
        return Response.json({ authenticated: true }, { headers: { 'set-cookie': 'seo_session=test-session; HttpOnly; Secure; Path=/' } });
      }
      if (url.endsWith('/api/state')) {
        assert.equal(options.headers.Cookie, 'seo_session=test-session');
        return Response.json({ state: { existingData: true }, revision: cloud.revision });
      }
      throw new Error(`Unexpected HTTP request ${url}`);
    },
  };
  return { dependencies, calls, requests, cloud, messages, opened, prompts, secretPrompts, root, installDir };
}

const wranglerCalls = calls => calls.filter(call => call.args[0] !== 'npm-cli-test.js');
const hasCommand = (call, command, operation) => call.args[1] === command && (operation === undefined || call.args[2] === operation);

test('update mode stops before any build or cloud command when the saved app is missing', async t => {
  const f = await fixture(t);
  await assert.rejects(installCloudflare({ updateOnly: true }, f.dependencies), /selected installation is missing/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.secretPrompts.length, 0);
  await assert.rejects(readFile(path.join(f.installDir, 'state.json')), { code: 'ENOENT' });
});

test('new-install mode cannot replace an existing app and incompatible modes are rejected', async t => {
  const f = await fixture(t);
  await installCloudflare({ newInstall: true }, f.dependencies);
  const stateFile = path.join(f.installDir, 'state.json'), saved = await readFile(stateFile, 'utf8'), before = f.calls.length;
  await assert.rejects(installCloudflare({ newInstall: true }, f.dependencies), /already has an installation/);
  assert.equal(f.calls.length, before);
  assert.equal(await readFile(stateFile, 'utf8'), saved);
  for (const flags of [['--update', '--new-install'], ['--update', '--dry-run'], ['--new-install', '--verify-only']]) assert.throws(() => parseArguments(flags));
  assert.equal(parseArguments(['--update']).updateOnly, true);
  assert.equal(parseArguments(['--new-install']).newInstall, true);
});

test('update mode preserves legacy Rooyesh identities and skips client-side test suites', async t => {
  const f = await fixture(t);
  await installCloudflare({}, f.dependencies);
  const stateFile = path.join(f.installDir, 'state.json'), saved = JSON.parse(await readFile(stateFile, 'utf8'));
  saved.workerName = saved.workerName.replace('roshdimo-', 'rooyesh-');
  saved.databaseName = `${saved.workerName}-db`;
  saved.url = saved.url.replace('roshdimo-', 'rooyesh-');
  f.cloud.databases[0].name = saved.databaseName;
  await writeFile(stateFile, JSON.stringify(saved));
  const before = f.calls.length, result = await installCloudflare({ updateOnly: true }, f.dependencies);
  assert.equal(result.url, saved.url);
  assert.equal(result.databaseId, saved.databaseId);
  assert.equal(f.cloud.databases.length, 1);
  assert.equal(f.cloud.secrets.length, 1);
  assert.ok(!f.calls.slice(before).some(call => hasCommand(call, 'd1', 'create') || hasCommand(call, 'secret', 'put') || call.args[1] === 'test'));
  assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).workerName, saved.workerName);
});

test('independent installation folders keep existing saved identity and get different Worker and database names', async t => {
  const first = await fixture(t), second = await fixture(t);
  const original = await installCloudflare({ newInstall: true }, first.dependencies);
  const filename = path.join(first.installDir, 'state.json'), snapshot = await readFile(filename, 'utf8');
  second.dependencies.randomBytes = () => Buffer.from('abcdef1234567890abcdef12', 'hex');
  const fresh = await installCloudflare({ newInstall: true }, second.dependencies);
  assert.notEqual(original.url, fresh.url);
  assert.notEqual(first.cloud.databases[0].name, second.cloud.databases[0].name);
  assert.equal(await readFile(filename, 'utf8'), snapshot);
  assert.equal(first.cloud.secrets.length, 1);
  assert.equal(second.cloud.secrets.length, 1);
});

test('fresh install scopes account, saves stable IDs, sends secret only through stdin, and verifies read only', async t => {
  const f = await fixture(t);
  const result = await installCloudflare({}, f.dependencies);
  assert.equal(result.accountId, firstAccount);
  assert.equal(result.databaseId, dbId);
  assert.equal(result.revision, 7);
  assert.equal(f.opened[0], result.url);
  assert.equal(f.requests.length, 3);
  assert.ok(f.requests.every(request => request.options.method !== 'PUT'));
  for (const call of wranglerCalls(f.calls)) {
    assert.equal(call.env.CLOUDFLARE_API_TOKEN, undefined);
    assert.equal(call.env.CLOUDFLARE_ACCOUNT_ID, undefined);
    assert.ok(!JSON.stringify(call.args).includes(password));
    assert.ok(!JSON.stringify(call.env).includes(password));
  }
  const stateText = await readFile(path.join(f.installDir, 'state.json'), 'utf8');
  const configText = await readFile(path.join(f.installDir, 'wrangler.json'), 'utf8');
  assert.ok(!stateText.includes(password) && !configText.includes(password));
  const config = JSON.parse(configText);
  assert.equal(config.account_id, firstAccount);
  assert.equal(config.main, path.join(f.root, 'worker/index.ts'));
  assert.equal(config.d1_databases[0].database_id, dbId);
  assert.ok(f.messages.every(message => !message.includes(password)));
  await assert.rejects(readFile(path.join(f.installDir, 'install.lock')), { code: 'ENOENT' });
});

test('rerun reuses database and existing password without rotating or clearing any project', async t => {
  const f = await fixture(t);
  const first = await installCloudflare({}, f.dependencies);
  const firstCount = f.calls.length;
  const second = await installCloudflare({}, f.dependencies);
  assert.equal(second.url, first.url);
  assert.equal(f.cloud.databases.length, 1);
  assert.equal(f.cloud.secrets.length, 1);
  const calls = f.calls.slice(firstCount);
  assert.ok(!calls.some(call => hasCommand(call, 'd1', 'create') || hasCommand(call, 'secret', 'put')));
  assert.ok(f.requests.every(request => !['PUT', 'DELETE', 'PATCH'].includes(request.options.method)));
});

test('interruption after remote database creation resumes same identity without creating duplicate', async t => {
  const f = await fixture(t, { createFailures: 1 });
  await assert.rejects(installCloudflare({}, f.dependencies), /Connection lost/);
  const saved = JSON.parse(await readFile(path.join(f.installDir, 'state.json'), 'utf8'));
  assert.equal(saved.databaseCreating, true);
  assert.equal(f.cloud.databases.length, 1);
  assert.equal(f.calls.some(call => hasCommand(call, 'secret', 'put')), false);
  const result = await installCloudflare({}, f.dependencies);
  assert.equal(result.databaseId, dbId);
  assert.equal(f.calls.filter(call => hasCommand(call, 'd1', 'create')).length, 1);
});

test('interruption after secret upload discovers existing secret and does not replace it', async t => {
  const f = await fixture(t, { secretFailures: 1 });
  await assert.rejects(installCloudflare({}, f.dependencies), /Connection lost/);
  assert.equal(f.cloud.secrets.length, 1);
  await installCloudflare({}, f.dependencies);
  assert.equal(f.calls.filter(call => hasCommand(call, 'secret', 'put')).length, 1);
  const state = JSON.parse(await readFile(path.join(f.installDir, 'state.json'), 'utf8'));
  assert.equal(state.passwordConfigured, true);
  f.cloud.secrets = [];
  const before = f.calls.length;
  await assert.rejects(installCloudflare({}, f.dependencies), /existing session secret is missing/);
  assert.equal(f.calls.slice(before).some(call => hasCommand(call, 'secret', 'put') || hasCommand(call, 'deploy')), false);
});

test('updating accepts the exact existing account password including leading and trailing spaces', async t => {
  const existingPassword = '  Account-password-123!  ';
  const f = await fixture(t, {
    cloud: { secrets: [{ name: 'APP_PASSWORD', type: 'secret_text' }] },
    secretAnswers: [existingPassword], loginPassword: existingPassword,
  });
  await installCloudflare({}, f.dependencies);
  assert.equal(f.calls.some(call => hasCommand(call, 'secret', 'put')), false);
  assert.equal(JSON.parse(f.requests.find(request => request.url.endsWith('/api/login')).options.body).password, existingPassword);
  assert.ok(f.messages.every(message => !message.includes(existingPassword)));
});

test('an older deployed identity cannot recreate a missing session secret even without its old flag', async t => {
  const f = await fixture(t);
  await installCloudflare({}, f.dependencies);
  const stateFile = path.join(f.installDir, 'state.json');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  delete state.passwordConfigured;
  await writeFile(stateFile, JSON.stringify(state));
  f.cloud.secrets = [];
  const before = f.calls.length;
  await assert.rejects(installCloudflare({}, f.dependencies), /existing session secret is missing/);
  assert.equal(f.calls.slice(before).some(call => hasCommand(call, 'secret', 'put') || hasCommand(call, 'deploy')), false);
});

test('multiple account choice rejects invalid choice and binds every remote command to chosen account', async t => {
  const f = await fixture(t, { cloud: { user: { ...user, accounts: [{ id: firstAccount, name: 'Personal' }, { id: secondAccount, name: 'Company' }] } }, promptAnswers: ['not a number', '9', '2'] });
  const result = await installCloudflare({}, f.dependencies);
  assert.equal(result.accountId, secondAccount);
  assert.equal(f.prompts.length, 3);
  assert.equal(f.cloud.databases[0].account, secondAccount);
});

test('authentication failure opens official browser with restricted scopes before cloud writes', async t => {
  const f = await fixture(t, { authFailures: 1 });
  await installCloudflare({}, f.dependencies);
  const loginIndex = f.calls.findIndex(call => hasCommand(call, 'login'));
  const createIndex = f.calls.findIndex(call => hasCommand(call, 'd1', 'create'));
  assert.ok(loginIndex > 0 && loginIndex < createIndex);
  assert.equal(f.calls[loginIndex].interactive, true);
  assert.deepEqual(f.calls[loginIndex].args.slice(3, 8), LOGIN_SCOPES);
});

test('dry run performs build/test/compile but no browser, secrets, account login, or persistent cloud identity', async t => {
  const f = await fixture(t);
  assert.deepEqual(await installCloudflare({ dryRun: true }, f.dependencies), { dryRun: true });
  assert.equal(f.calls.length, 4);
  assert.equal(f.calls[3].args.includes('--dry-run'), true);
  assert.equal(f.requests.length, 0);
  assert.equal(f.opened.length, 0);
  assert.equal(f.secretPrompts.length, 0);
  await assert.rejects(readFile(path.join(f.installDir, 'state.json')), { code: 'ENOENT' });
});

test('failed dependency installation stops before auth and resource operations', async t => {
  const f = await fixture(t, { npmFailure: true });
  await assert.rejects(installCloudflare({}, f.dependencies), /Build failed/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.cloud.databases.length, 0);
  assert.equal(f.requests.length, 0);
});

test('switching cloud accounts on rerun stops before mutations', async t => {
  const f = await fixture(t);
  await installCloudflare({}, f.dependencies);
  f.cloud.user.accounts = [{ id: secondAccount, name: 'Other account' }];
  const before = f.calls.length;
  await assert.rejects(installCloudflare({}, f.dependencies), /different Cloudflare account/);
  assert.ok(f.calls.slice(before).every(call => call.args[0] === 'npm-cli-test.js' || hasCommand(call, 'whoami')));
});

test('missing saved database stops instead of recreating potentially lost project storage', async t => {
  const f = await fixture(t);
  await installCloudflare({}, f.dependencies);
  f.cloud.databases = [];
  const before = f.calls.length;
  await assert.rejects(installCloudflare({}, f.dependencies), /saved database is missing/);
  assert.equal(f.calls.slice(before).some(call => hasCommand(call, 'd1', 'create') || hasCommand(call, 'deploy')), false);
});

test('wrong existing password gets one login attempt and preserves cloud secret', async t => {
  const f = await fixture(t, { badPassword: true });
  await assert.rejects(installCloudflare({}, f.dependencies), /password was incorrect/);
  assert.equal(f.requests.filter(request => request.url.endsWith('/api/login')).length, 1);
  assert.equal(f.cloud.secrets.length, 1);
});

test('installer password reset cannot overwrite independent team account passwords', async t => {
  const f = await fixture(t, { promptAnswers: ['no'] });
  await installCloudflare({}, f.dependencies);
  const before = f.calls.length;
  await assert.rejects(installCloudflare({ resetPassword: true }, f.dependencies), /Change account passwords in the app/);
  assert.equal(f.calls.length, before);
  assert.equal(f.calls.slice(before).some(call => hasCommand(call, 'secret', 'put')), false);
});

test('running second installer concurrently fails without removing active lock', async t => {
  const f = await fixture(t);
  await mkdir(f.installDir, { recursive: true });
  const lock = path.join(f.installDir, 'install.lock');
  await writeFile(lock, JSON.stringify({ pid: process.pid }));
  await assert.rejects(installCloudflare({}, f.dependencies), /already running/);
  assert.equal(JSON.parse(await readFile(lock, 'utf8')).pid, process.pid);
});

test('damaged state remains untouched and cannot trigger resource replacement', async t => {
  const f = await fixture(t);
  await mkdir(f.installDir, { recursive: true });
  const filename = path.join(f.installDir, 'state.json');
  await writeFile(filename, 'broken saved identity');
  await assert.rejects(installCloudflare({}, f.dependencies), /Saved installation could not be read/);
  assert.equal(await readFile(filename, 'utf8'), 'broken saved identity');
  assert.equal(f.cloud.databases.length, 0);
});

test('helpers preserve URLs in JSONC, parse warning-prefixed JSON, and validate safe flags/passwords/addresses', () => {
  assert.deepEqual(parseJSONC('{ // comment\n "url": "https://example.com/a//b", /* hi */ "value": "escaped\\\"quote" }'), { url: 'https://example.com/a//b', value: 'escaped"quote' });
  assert.deepEqual(parseCommandJSON('WARNING: Proxy environment detected\n{"loggedIn":true}'), { loggedIn: true });
  assert.throws(() => parseArguments(['--force']), /Unknown option/);
  assert.throws(() => parseArguments(['--dry-run', '--reset-password']), /cannot reset/);
  assert.equal(validPassword(password), true);
  assert.equal(validPassword(` ${password}`), false);
  assert.equal(validPassword(`${password} `), false);
  assert.equal(validPassword('short'), false);
  assert.equal(validExistingPassword(` ${password} `), true);
  assert.equal(validExistingPassword(''), false);
  assert.equal(validExistingPassword('x'.repeat(1025)), false);
  assert.equal(cloudEnvironment({ CLOUDFLARE_API_TOKEN: 'secret', CF_ACCOUNT_ID: 'account', PATH: 'good' }).PATH, 'good');
  const worker = 'rooyesh-1234567890abcdef12345678';
  assert.equal(validateWorkerURL(`https://${worker}.personal.workers.dev`, worker), `https://${worker}.personal.workers.dev`);
  assert.throws(() => validateWorkerURL(`https://${worker}.personal.workers.dev.evil.com`, worker));
  assert.throws(() => validateWorkerURL(`http://${worker}.personal.workers.dev`, worker));
  const log = `${JSON.stringify({ type: 'deploy', worker_name: worker, targets: ['schedule: daily', `https://${worker}.personal.workers.dev`] })}\n`;
  assert.equal(deploymentURL(log, worker), `https://${worker}.personal.workers.dev`);
});


test('first Worker secret-list not-found is handled while authorization errors stop before setting a password', async t => {
  const missing = await fixture(t, { secretListFailure: 'missing-worker' });
  await installCloudflare({}, missing.dependencies);
  assert.equal(missing.cloud.secrets.length, 1);
  const denied = await fixture(t, { secretListFailure: 'denied' });
  await assert.rejects(installCloudflare({}, denied.dependencies), /Cloudflare secret list failed/);
  assert.equal(denied.secretPrompts.length, 0);
  assert.equal(denied.calls.some(call => hasCommand(call, 'secret', 'put') || hasCommand(call, 'deploy')), false);
});

test('a lost login response and temporary edge failure retry the same password without replacing secrets', async t => {
  const f = await fixture(t);
  const original = f.dependencies.fetcher;
  const logins = [];
  f.dependencies.fetcher = async (url, options) => {
    if (url.endsWith('/api/login')) {
      logins.push({ url, options });
      if (logins.length === 1) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      if (logins.length === 2) return new Response('temporary edge failure', { status: 502 });
    }
    return original(url, options);
  };
  const result = await installCloudflare({}, f.dependencies);
  assert.equal(result.revision, 7);
  assert.equal(logins.length, 3);
  assert.ok(logins.every(request => JSON.parse(request.options.body).password === password && request.options.redirect === 'error'));
  assert.equal(f.calls.filter(call => hasCommand(call, 'secret', 'put')).length, 1);
  assert.equal(f.calls.filter(call => hasCommand(call, 'deploy')).length, 1);
  assert.ok(f.messages.every(message => !message.includes(password)));
});

test('database connection timeouts and edge failures retry reads without repeating login or writing projects', async t => {
  const f = await fixture(t);
  const original = f.dependencies.fetcher;
  const reads = [];
  f.dependencies.fetcher = async (url, options) => {
    if (url.endsWith('/api/state')) {
      reads.push(options);
      if (reads.length === 1) throw new DOMException('Timed out', 'TimeoutError');
      if (reads.length === 2) return new Response('edge timeout', { status: 524 });
    }
    return original(url, options);
  };
  const result = await installCloudflare({}, f.dependencies);
  assert.equal(result.revision, 7);
  assert.equal(reads.length, 3);
  assert.ok(reads.every(options => options.method === undefined && options.headers.Cookie === 'seo_session=test-session'));
  assert.equal(f.requests.filter(request => request.url.endsWith('/api/login')).length, 1);
});

test('a response body timeout is retried before treating the database as verified', async t => {
  const f = await fixture(t);
  const original = f.dependencies.fetcher;
  let reads = 0;
  f.dependencies.fetcher = async (url, options) => {
    const response = await original(url, options);
    if (url.endsWith('/api/state') && ++reads === 1) {
      response.json = async () => { throw new DOMException('Body download timed out', 'TimeoutError'); };
    }
    return response;
  };
  assert.equal((await installCloudflare({}, f.dependencies)).revision, 7);
  assert.equal(reads, 2);
});

test('published installation stays recoverable after verification timeout and resumes without any build or cloud command', async t => {
  const f = await fixture(t);
  const original = f.dependencies.fetcher;
  let loginAttempts = 0;
  f.dependencies.fetcher = async (url, options) => {
    if (url.endsWith('/api/login')) {
      loginAttempts++;
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }
    return original(url, options);
  };
  await assert.rejects(installCloudflare({}, f.dependencies), error => error.stage === 'login' && /HTTPS request timed out/.test(error.message));
  assert.equal(loginAttempts, 3);
  const stateFile = path.join(f.installDir, 'state.json');
  const pendingText = await readFile(stateFile, 'utf8');
  const pending = JSON.parse(pendingText);
  assert.equal(pending.deployed, true);
  assert.equal(pending.verificationPending, true);
  assert.equal(pending.verificationStage, 'login');
  assert.equal(pending.verifiedAt, undefined);
  assert.equal(pending.databaseId, dbId);
  assert.ok(!pendingText.includes(password));
  assert.match(await readFile(path.join(f.installDir, 'Open-Rooyesh.url'), 'utf8'), new RegExp(`URL=${pending.url}`));
  assert.equal(f.opened.length, 0);
  assert.ok(!f.messages.some(message => message.startsWith('Installation complete.')));
  await assert.rejects(readFile(path.join(f.installDir, 'install.lock')), { code: 'ENOENT' });

  f.dependencies.fetcher = original;
  f.dependencies.runner = async () => { assert.fail('verification must not run npm or Wrangler'); };
  delete f.dependencies.npmCLI;
  const result = await installCloudflare({ verifyOnly: true }, f.dependencies);
  assert.equal(result.url, pending.url);
  assert.equal(result.revision, 7);
  const complete = JSON.parse(await readFile(stateFile, 'utf8'));
  for (const key of ['workerName', 'databaseId', 'accountId', 'deployedAt']) assert.equal(complete[key], pending[key]);
  assert.equal(complete.verificationPending, false);
  assert.equal(complete.verificationStage, undefined);
  assert.ok(complete.verifiedAt);
  assert.equal(f.cloud.databases.length, 1);
  assert.equal(f.cloud.secrets.length, 1);
  assert.equal(f.calls.filter(call => hasCommand(call, 'deploy')).length, 1);
  assert.deepEqual(f.opened, [pending.url]);
});

test('verification-only reads a legacy saved installation and preserves the exact current account password', async t => {
  const currentPassword = '  Current-account-password  ';
  const f = await fixture(t, { secretAnswers: [password, password, currentPassword] });
  await installCloudflare({}, f.dependencies);
  const stateFile = path.join(f.installDir, 'state.json');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  delete state.verificationPending;
  delete state.verifiedAt;
  await writeFile(stateFile, JSON.stringify(state));
  const before = f.calls.length;
  const original = f.dependencies.fetcher;
  f.dependencies.fetcher = async (url, options) => {
    if (url.endsWith('/api/login')) {
      assert.equal(JSON.parse(options.body).password, currentPassword);
      return Response.json({ authenticated: true }, { headers: { 'set-cookie': 'seo_session=test-session; HttpOnly; Secure; Path=/' } });
    }
    return original(url, options);
  };
  const result = await installCloudflare({ verifyOnly: true }, f.dependencies);
  assert.equal(result.url, state.url);
  assert.equal(f.calls.length, before);
  assert.ok(!JSON.stringify(JSON.parse(await readFile(stateFile, 'utf8'))).includes(currentPassword));
});

test('verification-only with no saved identity never creates another installation or prompts for a password', async t => {
  const f = await fixture(t);
  await assert.rejects(installCloudflare({ verifyOnly: true }, f.dependencies), /No saved installation/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.requests.length, 0);
  assert.equal(f.secretPrompts.length, 0);
  await assert.rejects(readFile(path.join(f.installDir, 'state.json')), { code: 'ENOENT' });
});

test('verification-only preserves damaged identity files and stops before password entry or network requests', async t => {
  const f = await fixture(t);
  await mkdir(f.installDir, { recursive: true });
  const stateFile = path.join(f.installDir, 'state.json');
  await writeFile(stateFile, 'broken saved identity');
  await assert.rejects(installCloudflare({ verifyOnly: true }, f.dependencies), /Saved installation could not be read/);
  assert.equal(await readFile(stateFile, 'utf8'), 'broken saved identity');
  assert.equal(f.calls.length, 0);
  assert.equal(f.requests.length, 0);
  assert.equal(f.secretPrompts.length, 0);
});

test('verification-only cannot send a password to a modified or redirected installation address', async t => {
  const f = await fixture(t);
  await installCloudflare({}, f.dependencies);
  const stateFile = path.join(f.installDir, 'state.json');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  state.url += '.evil.example';
  await writeFile(stateFile, JSON.stringify(state));
  const beforeRequests = f.requests.length, beforePrompts = f.secretPrompts.length, beforeCalls = f.calls.length;
  await assert.rejects(installCloudflare({ verifyOnly: true }, f.dependencies), /valid app address/);
  assert.equal(f.requests.length, beforeRequests);
  assert.equal(f.secretPrompts.length, beforePrompts);
  assert.equal(f.calls.length, beforeCalls);
});

test('authorization and rate-limit responses stop after one login attempt', async t => {
  for (const status of [403, 429]) {
    const f = await fixture(t);
    const original = f.dependencies.fetcher;
    let logins = 0;
    f.dependencies.fetcher = async (url, options) => {
      if (url.endsWith('/api/login')) { logins++; return Response.json({ error: 'denied' }, { status }); }
      return original(url, options);
    };
    await assert.rejects(installCloudflare({}, f.dependencies), error => error.stage === 'login' && error.retryable === false);
    assert.equal(logins, 1);
    assert.equal(f.requests.some(request => request.url.endsWith('/api/state')), false);
    assert.equal(f.cloud.secrets.length, 1);
  }
});

test('an expired session stops database checks immediately without repeating password attempts', async t => {
  const f = await fixture(t);
  const original = f.dependencies.fetcher;
  let reads = 0;
  f.dependencies.fetcher = async (url, options) => {
    if (url.endsWith('/api/state')) { reads++; return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 }); }
    return original(url, options);
  };
  await assert.rejects(installCloudflare({}, f.dependencies), error => error.stage === 'database' && error.retryable === false);
  assert.equal(reads, 1);
  assert.equal(f.requests.filter(request => request.url.endsWith('/api/login')).length, 1);
});

test('invalid database payloads cannot complete installation or cause project writes', async t => {
  for (const state of [null, { state: null, revision: -1 }, { revision: 7 }, { state: null, revision: 1.5 }]) {
    const f = await fixture(t);
    const original = f.dependencies.fetcher;
    let reads = 0;
    f.dependencies.fetcher = async (url, options) => {
      if (url.endsWith('/api/state')) { reads++; return Response.json(state); }
      return original(url, options);
    };
    await assert.rejects(installCloudflare({}, f.dependencies), /database returned unexpected data/);
    assert.equal(reads, 1);
    assert.equal(f.opened.length, 0);
    assert.equal(JSON.parse(await readFile(path.join(f.installDir, 'state.json'), 'utf8')).verifiedAt, undefined);
  }
});

test('readiness waits for a configured response before transmitting account credentials', async t => {
  const f = await fixture(t);
  const original = f.dependencies.fetcher;
  let checks = 0;
  f.dependencies.fetcher = async (url, options) => {
    if (url.endsWith('/api/status') && ++checks < 4) return Response.json({ configured: false });
    if (url.endsWith('/api/login')) assert.equal(checks, 4);
    return original(url, options);
  };
  await installCloudflare({}, f.dependencies);
  assert.equal(checks, 4);
});

test('verification-only network failure is bounded and leaves the published identity and password unchanged', async t => {
  const f = await fixture(t);
  await installCloudflare({}, f.dependencies);
  const stateFile = path.join(f.installDir, 'state.json');
  const previous = JSON.parse(await readFile(stateFile, 'utf8'));
  const before = f.calls.length;
  let checks = 0;
  f.dependencies.fetcher = async (url) => {
    assert.ok(url.endsWith('/api/status'), 'no password may be sent before readiness');
    checks++;
    throw new Error(`Network failure including ${password}`);
  };
  await assert.rejects(installCloudflare({ verifyOnly: true }, f.dependencies), error => error.stage === 'status' && !error.message.includes(password));
  assert.equal(checks, 12);
  assert.equal(f.calls.length, before);
  const pending = JSON.parse(await readFile(stateFile, 'utf8'));
  assert.equal(pending.databaseId, previous.databaseId);
  assert.equal(pending.url, previous.url);
  assert.equal(pending.verificationPending, true);
  assert.equal(pending.verificationStage, 'status');
  assert.equal(pending.verifiedAt, undefined);
  assert.ok(f.messages.every(message => !message.includes(password)));
});

test('verification-only rejects mixed modes before touching any installation', async t => {
  for (const flag of ['--dry-run', '--device-login', '--reset-password']) assert.throws(() => parseArguments(['--verify-only', flag]), /cannot be combined/);
  assert.equal(parseArguments(['--verify-only']).verifyOnly, true);
  const f = await fixture(t);
  await assert.rejects(installCloudflare({ verifyOnly: true, dryRun: true }, f.dependencies), /cannot be combined/);
  assert.equal(f.calls.length, 0);
});

test('real HTTP response interruption retries the database download and returns the preserved revision', async t => {
  let reads = 0, logins = 0;
  const methods = [];
  const server = createServer(async (request, response) => {
    methods.push(request.method);
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/status') return response.end('{"configured":true}');
    if (request.url === '/api/login') {
      logins++;
      let body = '';
      for await (const chunk of request) body += chunk;
      assert.equal(JSON.parse(body).password, password);
      response.setHeader('Set-Cookie', 'seo_session=real-http-test; HttpOnly; Path=/');
      return response.end('{"authenticated":true}');
    }
    assert.equal(request.url, '/api/state');
    assert.equal(request.headers.cookie, 'seo_session=real-http-test');
    if (++reads === 1) {
      response.write('{"state":');
      response.flushHeaders();
      setTimeout(() => response.destroy(), 25);
    } else response.end('{"state":{"existingProject":true},"revision":19}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const localOrigin = `http://127.0.0.1:${server.address().port}`;
  const url = 'https://rooyesh-1234567890abcdef12345678.personal.workers.dev';
  // Bridge only synthetic credentials to the disposable local server; production URLs stay validated HTTPS.
  const revision = await verifyDeployment(url, password, {
    fetcher: (target, options) => fetch(`${localOrigin}${new URL(target).pathname}`, options),
    sleep: async () => {}, log: () => {},
  });
  assert.equal(revision, 19);
  assert.equal(logins, 1);
  assert.equal(reads, 2);
  assert.deepEqual(methods, ['GET', 'POST', 'GET', 'GET']);
});
