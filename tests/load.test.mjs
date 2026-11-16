// Load test (prototype capacity): N simulated users at the same time, each one signs in, loads
// their data and submits an evaluation. Measures response times and errors.
// Run:  npm run test:load            (35 users, as in the manuscript)
//       npm run test:load -- 100     (any other number)
// Writes docs/load-test-report.md. Uses a temporary database with the sample data.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const USERS = Number(process.argv[2]) || 35;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evalu-load-'));
process.env.EVALU_DATA_DIR = dir;
const { handleApi } = await import('../server/api.js');
const { sql } = await import('../server/db.js');
const L = await import('../src/lib/logic.js');

const server = http.createServer(async (req, res) => { if (!(await handleApi(req, res))) { res.writeHead(404); res.end(); } });
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const timings = { login: [], data: [], submit: [] };
let errors = 0;
async function call(kind, p, { body, cookie } = {}) {
  const t0 = performance.now();
  const res = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { ...(body && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }) }, body: body && JSON.stringify(body) });
  const data = await res.json();
  timings[kind].push(performance.now() - t0);
  if (res.status >= 500) errors++;
  return { status: res.status, data, setCookie: res.headers.get('set-cookie') };
}

// warm up (first request creates the sample database)
await fetch(base + '/api/auth/me');

// the simulated users: students first (they are most of the load), then staff
const students = sql.prepare("SELECT username FROM users WHERE role='ST' ORDER BY username").all().map((u) => u.username);
const staff = sql.prepare("SELECT username FROM users WHERE role<>'ST' ORDER BY username").all().map((u) => u.username);
const people = [...students, ...staff].slice(0, USERS);
while (people.length < USERS) people.push(students[people.length % students.length]); // more users than accounts: some sign in twice

let submitted = 0;
const started = performance.now();
await Promise.all(people.map(async (username) => {
  const lg = await call('login', '/api/auth/login', { body: { username, password: 'demo1234' } });
  if (lg.status !== 200) { errors++; return; }
  const cookie = lg.setCookie.split(';')[0];
  const d = (await call('data', '/api/data', { cookie })).data;
  const open = d.periods.find((p) => p.status === 'open');
  const mine = open && d.tasks.find((t) => t.periodId === open.id && !t.response); // students only receive their own tasks
  if (!mine) return;
  const ins = L.formForTask(d, mine);
  if (!ins) return;
  const r = await call('submit', '/api/actions/submitEvaluation', { body: { taskId: mine.id, answers: Object.fromEntries(ins.items.map((it) => [it.criterionId, 3])) }, cookie });
  if (r.status === 200) submitted++;
}));
const wall = performance.now() - started;
server.close();

const stat = (a) => {
  if (!a.length) return { n: 0, avg: '—', p95: '—', max: '—' };
  const s = [...a].sort((x, y) => x - y);
  return { n: a.length, avg: (a.reduce((x, y) => x + y, 0) / a.length).toFixed(0), p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))].toFixed(0), max: s.at(-1).toFixed(0) };
};
const rows = Object.entries({ 'Sign in': timings.login, 'Load own data': timings.data, 'Submit an evaluation': timings.submit }).map(([k, a]) => ({ k, ...stat(a) }));
const md = [
  '# evalU load test report',
  '',
  `Run: ${new Date().toISOString()} · Node ${process.version} · ${(os.cpus()[0]?.model || 'CPU').trim()} · ${Math.round(os.totalmem() / 2 ** 30)} GB RAM`,
  '',
  `**${USERS} simulated users at the same time.** Each signs in, loads their data and submits one evaluation (when they have one open).`,
  `All requests finished in **${(wall / 1000).toFixed(2)} s**, with **${errors} server error(s)**; ${submitted} evaluations were submitted.`,
  '',
  '| Request | Count | Average (ms) | 95th percentile (ms) | Slowest (ms) |',
  '|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.k} | ${r.n} | ${r.avg} | ${r.p95} | ${r.max} |`),
  '',
  'Notes: the server runs on the same computer as the test, with the sample data. Sign-in is deliberately slow (scrypt password hashing protects stored passwords). This measures prototype capacity only; it is not an institution-wide load test.',
  '',
].join('\n');
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync(`docs/load-test-report${USERS === 35 ? '' : `-${USERS}`}.md`, md);
console.log(md);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* database file still open on Windows */ }
process.exit(errors ? 1 : 0);
