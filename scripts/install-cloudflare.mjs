#!/usr/bin/env node
/** Windows bootstrap's second stage. Cloudflare access stays inside official Wrangler OAuth. */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface, emitKeypressEvents } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LOGIN_SCOPES = ['account:read', 'user:read', 'workers:write', 'workers_scripts:write', 'd1:write'];
const ZERO_DB = '00000000-0000-0000-0000-000000000000';
const accountPattern = /^[a-f0-9]{32}$/i;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const namePattern = /^rooyesh-[a-f0-9]{24}(?:-db)?$/;
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseArguments(args) {
  const flags = new Set(args);
  const known = ['--dry-run', '--device-login', '--reset-password', '--help'];
  for (const flag of flags) if (!known.includes(flag)) throw new Error(`Unknown option: ${flag}`);
  if (flags.has('--dry-run') && flags.has('--reset-password')) throw new Error('--dry-run cannot reset a cloud password.');
  return { dryRun: flags.has('--dry-run'), deviceLogin: flags.has('--device-login'), resetPassword: flags.has('--reset-password'), help: flags.has('--help') };
}

/** Remove JSONC comments without changing // inside URLs or escaped strings. */
export function parseJSONC(text) {
  let output = '', quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') { quoted = true; output += char; }
    else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      output += '\n';
    } else if (char === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        output += text[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i >= text.length) throw new Error('Unclosed configuration comment.');
      i++;
    } else output += char;
  }
  return JSON.parse(output);
}

export function parseCommandJSON(output) {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '').trim();
  try { return JSON.parse(clean); } catch { /* Wrangler may prepend a proxy warning. */ }
  for (let i = 0; i < clean.length; i++) {
    if (!['{', '['].includes(clean[i])) continue;
    try { return JSON.parse(clean.slice(i)); } catch { /* Keep looking for complete JSON. */ }
  }
  throw new Error('Wrangler returned unexpected data. Please rerun the installer.');
}

export function cloudEnvironment(env, extra = {}) {
  const result = { ...env };
  // Use browser-approved OAuth, never an unrelated inherited global API key/token.
  for (const key of ['CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_KEY', 'CLOUDFLARE_EMAIL', 'CF_EMAIL', 'CLOUDFLARE_ACCOUNT_ID', 'CF_ACCOUNT_ID', 'WRANGLER_OUTPUT_FILE_PATH', 'WRANGLER_OUTPUT_FILE_DIRECTORY']) delete result[key];
  return { ...result, WRANGLER_SEND_METRICS: 'false', WRANGLER_SEND_ERROR_REPORTS: 'false', WRANGLER_LOG_SANITIZE: 'true', WRANGLER_HIDE_BANNER: 'true', NO_COLOR: '1', ...extra };
}

export async function findNpmCLI(nodePath = process.execPath, env = process.env) {
  const nodeDirectory = path.dirname(nodePath);
  const candidates = [env.npm_execpath, path.join(nodeDirectory, 'node_modules/npm/bin/npm-cli.js'), path.resolve(nodeDirectory, '../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean);
  for (const candidate of candidates) {
    try { await access(candidate, constants.R_OK); return await realpath(candidate); } catch { /* next installed layout */ }
  }
  throw new Error('npm was not found next to Node.js. Run Install-Rooyesh.cmd again.');
}

export function commandRunner({ log = console.log } = {}) {
  return async ({ command, args, cwd, env, interactive = false, input, quiet = false, label = 'Command' }) => {
    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true, stdio: interactive ? 'inherit' : ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', settled = false;
      const redact = value => input ? value.split(input.trimEnd()).join('[hidden]') : value;
      const fail = error => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      child.on('error', error => fail(new Error(`${label} could not start: ${error.code || 'process error'}`)));
      if (!interactive) {
        child.stdout.on('data', data => { stdout += data; if (!quiet) process.stdout.write(redact(String(data))); });
        child.stderr.on('data', data => { stderr += data; if (!quiet) process.stderr.write(redact(String(data))); });
        child.stdin.on('error', error => { if (error.code !== 'EPIPE') fail(new Error(`${label} could not receive input.`)); });
        child.stdin.end(input ?? '');
      }
      child.on('close', (code, signal) => {
        if (settled) return;
        settled = true;
        if (code === 0) resolve({ stdout, stderr });
        else {
          const error = new Error(`${label} failed (${signal || `exit ${code}`}).`);
          // Diagnostic output is already Wrangler-sanitized; redact secret stdin again.
          error.output = redact(`${stdout}\n${stderr}`);
          error.exitCode = code;
          reject(error);
        }
      });
    });
  };
}

export async function promptText(message) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try { return await new Promise(resolve => terminal.question(message, resolve)); }
  finally { terminal.close(); }
}

export async function promptHidden(message) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Password entry needs an interactive terminal. Open Install-Rooyesh.cmd directly.');
  process.stdout.write(message);
  emitKeypressEvents(process.stdin);
  const previousRaw = Boolean(process.stdin.isRaw);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return await new Promise((resolve, reject) => {
    let value = '';
    const finish = (error) => {
      process.stdin.off('keypress', onKey);
      process.stdin.setRawMode(previousRaw);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onKey = (text, key = {}) => {
      if (key.ctrl && ['c', 'd'].includes(key.name)) return finish(new Error('Installation cancelled. Rerun the same installer to resume.'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') {
        if (value.length) { value = [...value].slice(0, -1).join(''); process.stdout.write('\b \b'); }
        return;
      }
      if (!text || key.ctrl || key.meta || /[\u0000-\u001f\u007f]/.test(text) || value.length + text.length > 1024) return;
      value += text;
      process.stdout.write('*'.repeat([...text].length));
    };
    process.stdin.on('keypress', onKey);
  });
}

export function validPassword(value) {
  return typeof value === 'string' && value.length >= 12 && value.length <= 1024 && !/[\r\n\u0000]/.test(value) && value.trim() === value;
}

async function newPassword(secret, log) {
  for (;;) {
    const password = await secret('Choose the app password (12+ characters): ');
    if (!validPassword(password)) { log('Use 12 to 1024 characters, with no leading or trailing spaces.'); continue; }
    if (password !== await secret('Enter the app password again: ')) { log('Passwords did not match. Try again.'); continue; }
    return password;
  }
}

async function atomicJSON(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filename);
}

function validateState(state) {
  if (state.schema !== 1 || !namePattern.test(state.workerName) || state.databaseName !== `${state.workerName}-db` || !/^[a-f0-9]{24}$/.test(state.installationId) || state.workerName !== `rooyesh-${state.installationId}`) throw new Error('The saved installation identity is invalid. Keep it for recovery; do not delete it.');
  if (state.accountId !== undefined && !accountPattern.test(state.accountId)) throw new Error('The saved account ID is invalid.');
  if (state.databaseId !== undefined && (!uuidPattern.test(state.databaseId) || state.databaseId === ZERO_DB)) throw new Error('The saved database ID is invalid.');
  if (state.url !== undefined) validateWorkerURL(state.url, state.workerName);
  return state;
}

export function validateWorkerURL(value, workerName) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname.startsWith(`${workerName}.`) || !url.hostname.endsWith('.workers.dev') || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) throw new Error('Cloudflare did not return a valid app address.');
  return url.origin;
}

export function deploymentURL(output, workerName) {
  const entries = output.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
  const deployment = entries.reverse().find(entry => entry.type === 'deploy' && entry.worker_name === workerName);
  if (!deployment || !Array.isArray(deployment.targets)) throw new Error('Deployment completed without a workers.dev address. Rerun the installer after enabling workers.dev in Cloudflare.');
  for (const target of deployment.targets) {
    if (typeof target !== 'string') continue;
    try { return validateWorkerURL(target, workerName); } catch { /* route, cron, or another target */ }
  }
  throw new Error('No workers.dev address was returned. Check the Cloudflare Workers dashboard and rerun.');
}

export async function openApp(url) {
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false, windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

export async function verifyDeployment(url, password, { fetcher = fetch, sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), log = console.log } = {}) {
  // DNS/TLS propagation can lag a successful publish. Password is sent only to the exact verified HTTPS origin.
  let configured = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const response = await fetcher(`${url}/api/status`, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
      if (response.ok && (await response.json()).configured === true) { configured = true; break; }
    } catch { /* retry public readiness; never retry failed password guesses */ }
    if (attempt < 11) { log('Waiting for the published app to become ready...'); await sleep(5000); }
  }
  if (!configured) throw new Error(`The app is published at ${url}, but its cloud connection is not ready. Rerun this installer to retry without replacing data.`);
  const login = await fetcher(`${url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url }, body: JSON.stringify({ password }), redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (login.status === 401) throw new Error('The app password was incorrect. Cloud data and password have not been changed. Rerun the installer and enter the existing app password.');
  if (!login.ok) throw new Error(`The app login check failed (HTTP ${login.status}). Rerun later to retry.`);
  const cookie = login.headers.get('set-cookie')?.match(/(?:^|,\s*)seo_session=([^;]+)/)?.[1];
  if (!cookie) throw new Error('The published app did not return its secure session.');
  const result = await fetcher(`${url}/api/state`, { headers: { Cookie: `seo_session=${cookie}` }, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!result.ok) throw new Error(`The database read check failed (HTTP ${result.status}). Rerun the installer to recheck migrations.`);
  const state = await result.json();
  if (!Number.isSafeInteger(state.revision) || state.revision < 0 || !Object.hasOwn(state, 'state')) throw new Error('The database returned unexpected data. Existing project data has not been overwritten.');
  return state.revision;
}

export async function installCloudflare(options = {}, dependencies = {}) {
  const root = dependencies.root || sourceRoot;
  const installDir = path.resolve(dependencies.installDir || process.env.ROOYESH_INSTALL_DIR || path.join(root, '.rooyesh-install'));
  const runner = dependencies.runner || commandRunner();
  const log = dependencies.log || console.log;
  const prompt = dependencies.prompt || promptText;
  const secret = dependencies.secret || promptHidden;
  const browser = dependencies.openBrowser || openApp;
  const npmCLI = dependencies.npmCLI || await findNpmCLI();
  const wranglerCLI = path.join(root, 'node_modules/wrangler/bin/wrangler.js');
  const env = cloudEnvironment(dependencies.env || process.env, { WRANGLER_LOG_PATH: path.join(installDir, 'wrangler-logs'), npm_config_cache: path.join(installDir, 'npm-cache') });
  const stateFile = path.join(installDir, 'state.json');
  const configFile = path.join(installDir, 'wrangler.json');
  const outputFile = path.join(installDir, 'deploy-output.jsonl');
  let state;
  await mkdir(installDir, { recursive: true });
  // Acquire an atomic local lock. A second installer cannot race secret/database creation.
  const lockFile = path.join(installDir, 'install.lock');
  try { await writeFile(lockFile, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let lock;
    try { lock = JSON.parse(await readFile(lockFile, 'utf8')); } catch { throw new Error(`An installation lock needs review: ${lockFile}`); }
    let active = false;
    if (Number.isSafeInteger(lock.pid) && lock.pid > 0) {
      try { process.kill(lock.pid, 0); active = true; } catch (problem) { if (problem.code === 'EPERM') active = true; }
    }
    if (active) throw new Error('Another Rooyesh installer is already running. Close that installer before trying again.');
    await rm(lockFile);
    await writeFile(lockFile, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 });
  }
  let password;
  try {
    log('Rooyesh cloud installer');
    log(options.dryRun ? 'Local checks only: no Cloudflare login, resources, or publishing.' : 'The installer will publish your private SEO app to your Cloudflare account.');
    await runner({ command: process.execPath, args: [npmCLI, 'ci', '--no-audit', '--no-fund'], cwd: root, env, label: 'Dependency installation' });
    await runner({ command: process.execPath, args: [npmCLI, 'run', 'build'], cwd: root, env, label: 'App build' });
    await runner({ command: process.execPath, args: [npmCLI, 'test'], cwd: root, env, label: 'App tests' });
    // JSONC paths always refer to the current release, while identity remains stable across upgrades.
    const base = parseJSONC(await readFile(path.join(root, 'wrangler.jsonc'), 'utf8'));
    const generatedConfig = identity => ({
      ...base,
      $schema: path.join(root, 'node_modules/wrangler/config-schema.json'),
      name: identity.workerName,
      ...(identity.accountId ? { account_id: identity.accountId } : {}),
      main: path.resolve(root, base.main),
      // Wrangler discovers TypeScript settings from the source entry. Its tsconfig
      // field joins paths to the generated config directory, including absolute paths.
      workers_dev: true,
      preview_urls: false,
      assets: { ...base.assets, directory: path.resolve(root, base.assets.directory) },
      d1_databases: [{ ...base.d1_databases.find(database => database.binding === 'DB'), binding: 'DB', database_name: identity.databaseName, database_id: identity.databaseId || ZERO_DB, migrations_dir: path.resolve(root, 'migrations') }],
    });
    if (options.dryRun) {
      const dryConfig = path.join(installDir, 'wrangler-dry-run.json');
      await atomicJSON(dryConfig, generatedConfig({ workerName: 'rooyesh-dry-run', databaseName: 'rooyesh-dry-run-db' }));
      await runner({ command: process.execPath, args: [wranglerCLI, 'deploy', '--config', dryConfig, '--dry-run', '--outdir', path.join(installDir, 'dry-run-bundle')], cwd: root, env, label: 'Cloudflare dry run' });
      log('Local checks passed. Cloudflare has not been changed.');
      return { dryRun: true };
    }
    try { state = validateState(JSON.parse(await readFile(stateFile, 'utf8'))); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Saved installation could not be read: ${error.message}. Keep ${stateFile} for recovery.`);
      const installationId = (dependencies.randomBytes || randomBytes)(12).toString('hex');
      state = { schema: 1, installationId, workerName: `rooyesh-${installationId}`, databaseName: `rooyesh-${installationId}-db`, createdAt: new Date().toISOString() };
      await atomicJSON(stateFile, state);
    }
    const save = () => atomicJSON(stateFile, state);
    await atomicJSON(configFile, generatedConfig(state));
    const wrangler = (args, settings = {}) => runner({ command: process.execPath, args: [wranglerCLI, ...args, '--config', configFile], cwd: root, env, label: `Cloudflare ${args[0]}`, ...settings });
    let user;
    try { user = parseCommandJSON((await wrangler(['whoami', '--json'], { quiet: true })).stdout); } catch { /* official browser login below */ }
    const scopesOK = user?.authType === 'OAuth Token' && Array.isArray(user.tokenPermissions) && LOGIN_SCOPES.every(scope => user.tokenPermissions.includes(scope));
    if (!user?.loggedIn || !scopesOK || options.deviceLogin) {
      log('Your browser will open Cloudflare. Sign in and approve the displayed Workers and D1 permissions.');
      await wrangler(['login', '--scopes', ...LOGIN_SCOPES, ...(options.deviceLogin ? ['--device'] : [])], { interactive: true });
      user = parseCommandJSON((await wrangler(['whoami', '--json'], { quiet: true })).stdout);
    }
    if (!user?.loggedIn || !Array.isArray(user.accounts) || user.accounts.length === 0) throw new Error('No Cloudflare account is available. Complete account setup in Cloudflare, then rerun.');
    const accounts = user.accounts.filter(account => accountPattern.test(account.id) && typeof account.name === 'string');
    if (state.accountId) {
      if (!accounts.some(account => account.id === state.accountId)) throw new Error('This installation belongs to a different Cloudflare account. Sign in to the original account to preserve your database.');
    } else {
      let selected;
      if (accounts.length === 1) selected = accounts[0];
      else {
        if (!accounts.length) throw new Error('Cloudflare returned no valid account IDs.');
        log('Choose the Cloudflare account for this app:');
        accounts.forEach((account, index) => log(`  ${index + 1}. ${account.name} (${account.id})`));
        while (!selected) {
          const input = (await prompt(`Account number (1-${accounts.length}): `)).trim();
          if (/^[1-9][0-9]*$/.test(input)) selected = accounts[Number(input) - 1];
          if (!selected) log('Enter one of the account numbers shown above.');
        }
      }
      state.accountId = selected.id;
      state.accountName = selected.name;
      await save(); // Scope every mutation to this account; never rely on Wrangler's account chooser.
      await atomicJSON(configFile, generatedConfig(state));
    }
    log(`Cloudflare account: ${state.accountName || state.accountId}`);
    const listDB = async () => {
      const data = parseCommandJSON((await wrangler(['d1', 'list', '--json'], { quiet: true })).stdout);
      if (!Array.isArray(data)) throw new Error('Cloudflare returned an invalid database list.');
      return data;
    };
    let databases = await listDB();
    const matching = data => data.filter(database => database.name === state.databaseName);
    if (state.databaseId) {
      if (!databases.some(database => database.uuid === state.databaseId && database.name === state.databaseName)) throw new Error('The saved database is missing or renamed. Installation stopped to protect existing projects. Check your Cloudflare D1 dashboard.');
    } else {
      if (!matching(databases).length) {
        state.databaseCreating = true;
        await save(); // If interrupted after remote creation, the next run finds this exact stable name.
        log('Creating the app database...');
        await wrangler(['d1', 'create', state.databaseName, '--no-update-config']);
        databases = await listDB();
      } else if (!state.databaseCreating) throw new Error('An unexpected database already uses this installation name. Installation stopped without modifying it.');
      const matches = matching(databases);
      if (matches.length !== 1 || !uuidPattern.test(matches[0].uuid) || matches[0].uuid === ZERO_DB) throw new Error('The created database could not be identified. Rerun the same installer to retry.');
      state.databaseId = matches[0].uuid;
      state.databaseCreating = false;
      await save();
      await atomicJSON(configFile, generatedConfig(state));
    }
    log('Preparing the database (existing projects are preserved)...');
    await wrangler(['d1', 'migrations', 'apply', 'DB', '--remote']);
    state.migrated = true;
    await save();
    let secrets;
    try { secrets = parseCommandJSON((await wrangler(['secret', 'list', '--format', 'json'], { quiet: true })).stdout); }
    catch (error) {
      const missingWorker = typeof error.output === 'string' && error.output.includes(`Worker "${state.workerName}" not found`);
      if (!missingWorker || state.deployed || state.passwordConfigured) throw error;
      secrets = [];
    }
    if (!Array.isArray(secrets)) throw new Error('Cloudflare returned an invalid secret list.');
    const hasPassword = secrets.some(item => item.name === 'APP_PASSWORD');
    if (!hasPassword && state.passwordConfigured && !options.resetPassword) throw new Error('The existing cloud password is missing. Check Cloudflare, or deliberately rerun with --reset-password to set a new one.');
    if (options.resetPassword && hasPassword) {
      const answer = (await prompt('Changing the password signs out every device. Type RESET to continue: ')).trim();
      if (answer !== 'RESET') throw new Error('Password change cancelled. Existing projects and password are unchanged.');
    }
    if (!hasPassword || options.resetPassword) {
      log('Choose a password for signing into the app. It will be stored as a Cloudflare secret.');
      password = await newPassword(secret, log);
      try { await wrangler(['secret', 'put', 'APP_PASSWORD'], { input: `${password}\n`, quiet: true, label: 'App password upload' }); }
      finally { await rm(path.join(installDir, 'wrangler-logs'), { recursive: true, force: true }); }
      // Verify existence so a cancelled/no-op Wrangler secret command cannot be treated as success.
      const savedSecrets = parseCommandJSON((await wrangler(['secret', 'list', '--format', 'json'], { quiet: true })).stdout);
      if (!Array.isArray(savedSecrets) || !savedSecrets.some(item => item.name === 'APP_PASSWORD')) throw new Error('The cloud password was not saved. Rerun the installer.');
      state.passwordConfigured = true;
      await save();
    } else {
      log('The existing app password will be kept. Enter it only to verify the published app.');
      password = await secret('Existing app password: ');
      if (!validPassword(password)) throw new Error('The existing app password must contain at least 12 characters.');
    }
    log('Publishing the app...');
    log('A new Cloudflare account may ask once to choose its workers.dev subdomain.');
    await rm(outputFile, { force: true });
    await wrangler(['deploy'], { interactive: true, env: { ...env, WRANGLER_OUTPUT_FILE_PATH: outputFile } });
    const url = deploymentURL(await readFile(outputFile, 'utf8'), state.workerName);
    state.url = url;
    state.deployed = true;
    state.deployedAt = new Date().toISOString();
    await save();
    log('Checking login and reading the database...');
    const revision = await verifyDeployment(url, password, { fetcher: dependencies.fetcher, sleep: dependencies.sleep, log });
    password = undefined;
    state.verifiedAt = new Date().toISOString();
    await save();
    await writeFile(path.join(installDir, 'Open-Rooyesh.url'), `[InternetShortcut]\r\nURL=${url}\r\n`, { mode: 0o600 });
    log(`Installation complete. App: ${url}`);
    log(`Database read verified (revision ${revision}). Your password was not saved on this computer.`);
    log(`To open it later: ${path.join(installDir, 'Open-Rooyesh.url')}`);
    try { await browser(url); } catch { log(`Open this address in your browser: ${url}`); }
    return { url, workerName: state.workerName, databaseId: state.databaseId, accountId: state.accountId, revision };
  } finally {
    password = undefined;
    await rm(lockFile, { force: true });
  }
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || '')).href) {
  try {
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required. Run Install-Rooyesh.cmd.');
    const options = parseArguments(process.argv.slice(2));
    if (options.help) console.log('Usage: node scripts/install-cloudflare.mjs [--dry-run] [--device-login] [--reset-password]\nBrowser OAuth approves Workers/D1 access. The app password is entered hidden.\nRerun the same installer after a failure; resources and existing projects are preserved.');
    else await installCloudflare(options);
  } catch (error) {
    console.error(`\nInstallation stopped: ${error.message}`);
    if (error.output) console.error(error.output);
    console.error('Keep the installation folder and rerun the same installer to resume. No database is deleted by this installer.');
    process.exitCode = 1;
  }
}
