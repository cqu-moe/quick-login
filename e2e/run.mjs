import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { viewport } from './run-evidence.mjs';

const startedAt = new Date().toISOString();
const args = process.argv.slice(2);
let active;
let interrupted = false;
function stop() { interrupted = true; active?.kill('SIGINT'); }
process.once('SIGINT', stop); process.once('SIGTERM', stop);
async function command(argv, env = {}, quiet = false) {
  active = spawn(process.execPath, argv, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, E2E_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1', ...env } });
  let stdout = '', stderr = '';
  active.stdout.on('data', data => { stdout += data; if (!quiet) process.stdout.write(data); });
  active.stderr.on('data', data => { stderr += data; if (!quiet) process.stderr.write(data); });
  const code = await new Promise((done, fail) => { active.once('error', fail); active.once('close', code => done(code ?? 1)); });
  active = undefined;
  return { code, stdout, stderr };
}
const discovery = await command(['node_modules/e2e/dist/cli/bin.js', 'list', '--config', 'e2e.config.ts', '--reporter', 'json', ...args], {}, true);
if (discovery.code) {
  if (discovery.code === 2 && discovery.stderr.includes('NO_TESTS')) {
    process.exitCode = (await command(['e2e/run-single.mjs', ...args], { QUICKLOGIN_E2E_SCHOOL: '' })).code;
  } else { process.stderr.write(discovery.stderr); process.exitCode = discovery.code; }
}
else {
  const pairs = JSON.parse(discovery.stdout).pairs.filter(pair => pair.kind === 'test' && pair.disposition === 'run');
  const school = pairs.filter(pair => ['e2e/school.e2e.ts', 'e2e/school-guards.e2e.ts', 'e2e/device-school.e2e.ts'].includes(pair.file));
  const independent = pairs.filter(pair => school.includes(pair) || pair.file === 'e2e/device-lifecycle.e2e.ts');
  if (!independent.length || pairs.length === 1) {
    const result = await command(['e2e/run-single.mjs', ...args], school.length ? { QUICKLOGIN_E2E_SCHOOL: '1' } : { QUICKLOGIN_E2E_SCHOOL: '' });
    process.exitCode = interrupted ? 1 : result.code;
  } else {
    const output = resolve(process.env.QUICKLOGIN_E2E_OUTPUT || `.e2e/run-${Date.now()}`);
    if (!output.startsWith(resolve('.e2e') + '/')) throw new Error('E2E output must be a child of .e2e');
    await mkdir(dirname(output), { recursive: true });
    await mkdir(output);
    const full = await command(['node_modules/e2e/dist/cli/bin.js', 'list', '--config', 'e2e.config.ts', '--reporter', 'json'], {}, true);
    if (full.code) throw new Error('Unfiltered framework discovery failed');
    await writeFile(join(output, 'discovery.json'), JSON.stringify({ ...JSON.parse(discovery.stdout), all: JSON.parse(full.stdout).pairs }, null, 2) + '\n');
    const base = pairs.filter(pair => !independent.includes(pair));
    const groups = [...(base.length ? [{ name: 'authorization', pairs: base, school: false }] : []), ...independent.map((pair, index) => ({ name: `isolated-${index + 1}-${pair.id.slice(0, 12)}`, pairs: [pair], school: school.includes(pair) }))];
    const executionArgs = args.filter((arg, index) => arg !== '--grep' && !arg.startsWith('--grep=') && args[index - 1] !== '--grep');
    const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const reports = [], runtimes = [], logs = [], failures = [];
    for (const group of groups) {
      if (interrupted) { failures.push('Run interrupted'); break; }
      const path = join(output, group.name);
      const selected = group.pairs.flatMap(pair => ['--grep', `^${escape(pair.titlePath.join(' '))}$`]);
      console.log(`[quicklogin-e2e] isolated runtime ${group.name} (${group.pairs.length} tests)`);
      const result = await command(['e2e/run-single.mjs', ...executionArgs, ...selected], { QUICKLOGIN_E2E_OUTPUT: path, QUICKLOGIN_E2E_SCHOOL: group.school ? '1' : '' });
      logs.push(result.stdout + result.stderr);
      let runtime, report;
      try {
        runtime = JSON.parse(await readFile(join(path, 'runtime.json'), 'utf8'));
        runtimes.push({ ...runtime, group: group.name });
        report = JSON.parse(await readFile(join(path, 'report.json'), 'utf8'));
        const selectedIds = report.run.results.filter(test => test.kind === 'test' && test.selected).map(test => test.id).sort();
        const executedIds = report.run.results.filter(test => test.kind === 'test' && test.selected && test.status !== 'skipped').map(test => test.id).sort();
        const expectedIds = group.pairs.map(pair => pair.id).sort();
        if (JSON.stringify(expectedIds) !== JSON.stringify(selectedIds) || JSON.stringify(expectedIds) !== JSON.stringify(executedIds)) throw new Error('Framework discovered/selected/executed test IDs differ');
        reports.push(report);
        if (runtime.cleanup !== 'passed') failures.push(`${group.name}: cleanup failed`);
      } catch (error) {
        failures.push(`${group.name}: ${error.message}`);
        if (!runtime) runtimes.push({ group: group.name, cleanup: 'evidence-missing', cleanupFailures: ['Runtime cleanup evidence unavailable'] });
      }
      if (result.code) failures.push(`${group.name}: wrapper exited ${result.code}`);
      if (failures.length) break;
    }
    const results = reports.flatMap(report => report.run.results.filter(test => test.kind === 'test' && test.selected));
    if (JSON.stringify(results.map(test => test.id).sort()) !== JSON.stringify(pairs.map(pair => pair.id).sort())) failures.push('Aggregate test IDs do not equal framework discovery');
    const summary = { discovered: pairs.length, selected: pairs.length, executed: results.length, passed: results.filter(test => test.status === 'passed').length, failed: results.filter(test => test.status === 'failed').length, interrupted: interrupted ? 1 : 0, skipped: pairs.length - results.length, flaky: 0 };
    if (summary.passed !== pairs.length) failures.push('Not every discovered test passed');
    const report = { ...(reports[0] ?? {}), run: { ...(reports[0]?.run ?? {}), startedAt, finishedAt: new Date().toISOString(), exitCode: failures.length ? 1 : 0, status: failures.length ? 'failed' : 'passed', summary, results, errors: failures.map(message => ({ message })) } };
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    await writeFile(join(output, 'runner.log'), logs.join('\n'));
    const runtime = { ...(runtimes[0] ?? {}), output, viewport,
      selection: runtimes.flatMap(value => value.selection ?? []).sort((a, b) => a.id.localeCompare(b.id)),
      viewportObservations: runtimes.flatMap(value => value.viewportObservations ?? []),
      groups: runtimes, completedGroups: runtimes.length, expectedGroups: groups.length, cleanup: runtimes.length && runtimes.every(value => value.cleanup === 'passed') ? 'passed' : 'incomplete-or-failed', primaryFailures: failures, cleanupFailures: runtimes.flatMap(value => value.cleanupFailures ?? []) };
    await writeFile(join(output, 'runtime.json'), JSON.stringify(runtime, null, 2) + '\n');
    console.log(`[quicklogin-e2e] ${summary.passed}/${pairs.length} independent runtime tests passed; cleanup ${runtime.cleanup}`);
    process.exitCode = failures.length ? 1 : 0;
  }
}
process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
