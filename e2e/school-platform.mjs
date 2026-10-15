import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Configuration and external mail transport only; production handlers run unchanged.
export async function schoolPlatform(authRoot, fixtureDirectory) {
  const { schoolContainerCleanup } = await import(pathToFileURL(join(authRoot, 'e2e/school/containers.mjs')).href);
  const docker = args => execFileSync('docker', args, { cwd: authRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 }).trim();
  const base = execFileSync(process.execPath, ['--input-type=module', '-e', "import {browserBase} from './e2e/school/image.mjs'; process.stdout.write(browserBase())"], { cwd: authRoot, encoding: 'utf8' }).trim();
  const image = `quicklogin-school-fixture:${randomUUID()}`;
  const interceptor = 'cloudflare/proxy-everything:3cb1195@sha256:0ef6716c52430096900b150d84a3302057d6cd2319dae7987128c85d0733e3c8';
  const containerCleanup = schoolContainerCleanup({ docker, image, interceptor });
  docker(['image', 'inspect', base]); docker(['image', 'inspect', interceptor]);
  const rawSocket = process.env.AUTH_SCHOOL_DOCKER_SOCKET || docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
  docker(['build', '--platform', 'linux/amd64', '--build-context', `school-fixture=${fixtureDirectory}`, '--build-arg', `BASE=${base}`, '--build-arg', `RUN_ID=${randomUUID()}`, '-t', image, '-f', 'e2e/school/Dockerfile', '.']);
  let mf, timer, pumping = false;
  const users = new Map(), errors = [], sensitive = new Set();
  const outcomes = { fixtureImage: image, deliveries: 0, acceptedDeliveries: 0, containerObjectsRemoved: false, proxyObjectsRemoved: false, imageRemoved: false };
  async function control(userId, path, body) {
    if (!users.has(userId)) users.set(userId, userId.startsWith("quicklogin:") ? userId.split(":")[1] : userId);
    const ns = await mf.getDurableObjectNamespace('CQU_LOGIN', 'quicklogin-consumer-auth');
    const instanceId = ns.idFromName(userId);
    containerCleanup.track('quicklogin-consumer-auth', instanceId);
    const response = await ns.get(instanceId).fetch(`http://fixture/__fixture/${path}`, body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`School fixture transport failed (${response.status})`);
    return response.json();
  }
  return {
    sensitive, control, outcomes,
    configure(options) {
      return {
        host: options.host, port: options.port, log: options.log,
        d1Persist: options.d1Persist, durableObjectsPersist: join(options.d1Persist, '../do'), workflowsPersist: join(options.d1Persist, '../workflows'),
        handleRuntimeStdio(stdout, stderr) { stdout.resume(); stderr.resume(); },
        containerEngine: { localDocker: { socketPath: rawSocket.startsWith('/') ? `unix://${rawSocket}` : rawSocket, containerEgressInterceptorImage: interceptor } },
        workers: [{ ...options,
          d1Databases: { ...options.d1Databases, EVIDENCE: 'quicklogin-school-evidence' },
          durableObjects: { ...options.durableObjects, CQU_LOGIN: { className: 'CquLoginContainer', useSQLite: true, container: { imageName: image } } },
          workflows: { CQU_SESSION_RECOVERY: { name: 'quicklogin-school-recovery', className: 'CquSessionRecoveryWorkflow' } },
        }, {
          name: 'quicklogin-school-mail', modules: true, compatibilityDate: '2026-05-01',
          script: "export default {async fetch(request,env){return Response.json(await env.MAIL.deliver(await request.json()))}}",
          serviceBindings: { MAIL: { name: options.name, entrypoint: 'SyntheticSchoolMail' } },
          outboundService: () => { errors.push('Unexpected mail transport egress'); return new Response(null, { status: 502 }); },
        }],
      };
    },
    async ready(instance, db) {
      mf = instance;
      const evidence = await mf.getD1Database('EVIDENCE', 'quicklogin-consumer-auth');
      await evidence.prepare('CREATE TABLE workflows(id TEXT PRIMARY KEY)').run();
      await evidence.prepare('CREATE TABLE browser_outcomes(id INTEGER PRIMARY KEY,ok INTEGER,code TEXT,phase TEXT)').run();
      const caller = await mf.getWorker('quicklogin-school-mail');
      timer = setInterval(async () => {
        if (pumping) return;
        pumping = true;
        try {
          for (const userId of [...new Set(users.values())]) {
            const devices = await db.prepare("SELECT device_id FROM quicklogin_device_projection WHERE user_id=?").bind(userId).all();
            for (const device of devices.results) users.set(`quicklogin:${userId}:${device.device_id}`, userId);
          }
          for (const [containerKey, userId] of users) {
            const row = await db.prepare("SELECT token FROM cqu_bind_addresses WHERE user_id=? AND status IN ('pending','active')").bind(userId).first();
            if (!row) continue;
            sensitive.add(row.token);
            for (const message of await control(containerKey, 'mail')) {
              sensitive.add(message.code);
              const response = await caller.fetch('http://mail/', { method: 'POST', body: JSON.stringify({ ...message, to: `${row.token}@example.test` }) });
              const result = await response.json(); outcomes.deliveries++;
              if (!result.accepted) throw new Error('Current school verification delivery rejected');
              outcomes.acceptedDeliveries++;
            }
          }
        } catch (error) { errors.push(error.message); }
        finally { pumping = false; }
      }, 200);
    },
    addUser(userId) { users.set(userId, userId); },
    async beforeClose() {
      clearInterval(timer);
      if (!mf) return;
      while (pumping) await new Promise(done => setTimeout(done, 50));
      const evidence = await mf.getD1Database('EVIDENCE', 'quicklogin-consumer-auth');
      outcomes.browser = (await evidence.prepare('SELECT ok,code,phase FROM browser_outcomes ORDER BY id').all()).results;
      outcomes.school = [];
      for (const userId of users.keys()) {
        const value = await control(userId, 'control', { hold: false, holdLogin: false, holdMail: false });
        outcomes.school.push({ profiles: value.profiles, chromeProcesses: value.chromeProcesses });
      }
    },
    async close() {
      Object.assign(outcomes, containerCleanup.close());
      docker(['image', 'rm', image]); outcomes.imageRemoved = true;
      if (errors.length) throw new Error(`School transport errors (${[...new Set(errors)].join('; ')})`);
    },
  };
}
