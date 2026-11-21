import { useEffect, useRef, useState } from 'react';
import { useApp } from '../lib/store';
import { ROLES, POSITIONS, needsDept, deptName, missingUbDepartments, isNursingDept, nursingDepts, evaluatorGroups, defaultEvaluatorGroups, groupName, evaluateeRoles, evaluateeRoleName, accessRoleName, targetType, targetTypesOf } from '../lib/logic';
import { Card, Select, Badge, Avatar, Empty, SaveInput, newestFirst, usePages, ask } from '../ui';

/* ---------------- change your own password ---------------- */
export function PasswordForm({ onDone, submitLabel = 'Change password', askCurrent = true }) {
  const { changePassword } = useApp();
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [show, setShow] = useState(false);
  const go = async (e) => {
    e.preventDefault();
    setErr('');
    if ((askCurrent && !cur) || !pw) return setErr('Fill in every field.');
    if (pw !== pw2) return setErr('The two new passwords do not match.');
    setBusy(true);
    const r = await changePassword(cur, pw);
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setCur(''); setPw(''); setPw2('');
    onDone?.();
  };
  const type = show ? 'text' : 'password';
  return (
    <form onSubmit={go} noValidate className="pw-form">
      {askCurrent && <label className="field"><span>Current password</span><input type={type} value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></label>}
      <label className="field"><span>New password</span><input type={type} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus={!askCurrent} /></label>
      <label className="field"><span>Repeat new password</span><input type={type} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></label>
      <label className="inline muted"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show passwords</label>
      <p className="muted">At least 8 characters, with a letter and a number. Don't include your username.</p>
      {err && <div className="login-err" role="alert">{err}</div>}
      <button type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
    </form>
  );
}

/** Shown after signing in with a temporary password: nothing else is available until it is changed. */
export function ForcedPasswordChange() {
  const { user, logout } = useApp();
  return (
    <div className="login-wrap">
      <div className="login-bg" aria-hidden="true" />
      <main className="login-center">
        <header className="login-head"><div className="login-logo">eval<span>U</span></div></header>
        <div className="login-card">
          <h1>Choose a new password</h1>
          <p className="muted">Hi {user.name}. You signed in with a temporary password from HR. Choose your own password to continue.</p>
          <PasswordForm submitLabel="Save and continue" askCurrent={false} />
          <p className="lc-foot"><button type="button" className="ghost" onClick={logout}>Log out</button></p>
        </div>
      </main>
    </div>
  );
}

/* ---------------- My account (everyone) ---------------- */
export function MyAccount() {
  const { db, user } = useApp();
  const [done, setDone] = useState(false);
  return (
    <>
      <Card title="My account">
        <table className="kv">
          <tbody>
            <tr><th>Name</th><td>{user.name}</td></tr>
            <tr><th>Username</th><td>{user.username}</td></tr>
            <tr><th>UB email</th><td>{user.email || '—'}</td></tr>
            <tr><th>Role</th><td>{accessRoleName(db, user.accessRoleId || user.role)}{Object.keys(POSITIONS[user.role] || {}).length > 1 && ` — ${POSITIONS[user.role][user.position] || user.position}`}</td></tr>
            {user.dept && <tr><th>Department</th><td>{deptName(db, user.dept)}</td></tr>}
          </tbody>
        </table>
        <p className="muted">To correct your name, role or department, contact the HRMC office.</p>
      </Card>
      <Card title="Change password">
        {done && <div className="note ok">Your password was changed. You were signed out on other devices.</div>}
        <PasswordForm onDone={() => setDone(true)} />
      </Card>
    </>
  );
}

/* ---------------- HR: accounts ---------------- */
const EMPTY = { name: '', username: '', email: '', role: 'ST', accessRoleId: 'ST', position: 'student', dept: '', sectionIds: [], evaluatorGroupIds: [], evaluateeTypeIds: [] };

function AccountForm({ initial, onSave, onCancel, saveLabel }) {
  const { db } = useApp();
  const [f, setF] = useState(initial);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setRole = (accessRoleId) => {
    const profile = db.accessRoles.find((r) => r.id === accessRoleId);
    if (!profile) return;
    const role = profile.template;
    const position = Object.keys(POSITIONS[role])[0];
    setF((x) => {
      const dept = needsDept(role) ? x.dept : '';
      return { ...x, role, accessRoleId, position, dept, sectionIds: role === 'ST' ? x.sectionIds : [], evaluatorGroupIds: defaultEvaluatorGroups(role, position), evaluateeTypeIds: role === 'ST' ? [] : [targetType(db, { role, position, dept })].filter(Boolean) };
    });
  };
  const classes = db.sections.filter((s) => s.dept === f.dept);
  // Clinical Instructors are only in the School of Nursing
  const chosenDept = db.departments.find((d) => d.id === f.dept);
  const positions = Object.entries(POSITIONS[f.role]).filter(([k]) => k !== 'ci' || !chosenDept || isNursingDept(chosenDept) || f.position === 'ci');
  const deptChoices = f.position === 'ci' ? nursingDepts(db) : db.departments;
  const setPosition = (v) => setF((x) => {
    const keep = v !== 'ci' || isNursingDept(db.departments.find((d) => d.id === x.dept));
    const currentDefaults = defaultEvaluatorGroups(x.role, x.position);
    const additional = (x.evaluatorGroupIds || []).filter((id) => !currentDefaults.includes(id));
    const evaluatorGroupIds = [...new Set([...defaultEvaluatorGroups(x.role, v), ...additional])];
    const dept = keep ? x.dept : (nursingDepts(db)[0]?.id || '');
    const oldType = targetType(db, { role: x.role, position: x.position, dept: x.dept });
    const newType = targetType(db, { role: x.role, position: v, dept });
    const evaluateeTypeIds = [...new Set([...(x.evaluateeTypeIds || []).filter((id) => id !== oldType), newType].filter(Boolean))];
    return { ...x, position: v, dept, sectionIds: keep ? x.sectionIds : [], evaluatorGroupIds, evaluateeTypeIds };
  });
  const setDepartment = (dept) => setF((x) => {
    const oldType = targetType(db, { role: x.role, position: x.position, dept: x.dept });
    const newType = targetType(db, { role: x.role, position: x.position, dept });
    return { ...x, dept, sectionIds: [], evaluateeTypeIds: [...new Set([...(x.evaluateeTypeIds || []).filter((id) => id !== oldType), newType].filter(Boolean))] };
  });
  const toggle = (id) => set('sectionIds', f.sectionIds.includes(id) ? f.sectionIds.filter((x) => x !== id) : [...f.sectionIds, id]);
  const toggleEvaluatorGroup = (id) => set('evaluatorGroupIds', (f.evaluatorGroupIds || []).includes(id) ? f.evaluatorGroupIds.filter((x) => x !== id) : [...(f.evaluatorGroupIds || []), id]);
  const groups = (db.evaluatorGroups || []).filter((g) => g.active !== false && g.id !== 'ST');
  const evaluatees = evaluateeRoles(db).filter((r) => r.active !== false || (f.evaluateeTypeIds || []).includes(r.id));
  const toggleEvaluateeRole = (id) => set('evaluateeTypeIds', (f.evaluateeTypeIds || []).includes(id) ? f.evaluateeTypeIds.filter((x) => x !== id) : [...(f.evaluateeTypeIds || []), id]);
  return (
    <div className="acc-form">
      <div className="row">
        <label>Full name<br /><input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Juan Dela Cruz" /></label>
        <label>Username<br /><input value={f.username} onChange={(e) => set('username', e.target.value.toLowerCase())} placeholder="e.g. 20226699" /></label>
        <label>Official UB email<br /><input type="email" value={f.email} onChange={(e) => set('email', e.target.value.toLowerCase())} placeholder={f.role === 'ST' ? 'e.g. 20226699@s.ubaguio.edu' : 'e.g. jdelacruz@ubaguio.edu'} /></label>
      </div>
      <p className="muted">People sign in with this email. Only official UB addresses (ending in ubaguio.edu) are accepted.</p>
      <div className="row">
        <label>Access role<br /><Select value={f.accessRoleId || f.role} onChange={setRole}>{db.accessRoles.filter((r) => r.active !== false || r.id === f.accessRoleId).map((r) => <option key={r.id} value={r.id}>{r.name} — {ROLES[r.template]}</option>)}</Select></label>
        <label>Position<br /><Select value={f.position} onChange={setPosition}>{positions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></label>
        {needsDept(f.role) && (
          <label>Department<br />
            <Select value={f.dept} onChange={setDepartment}>
              <option value="">Choose…</option>
              {deptChoices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </label>
        )}
      </div>
      {f.position === 'ci' && <p className="muted">Clinical Instructors are only in the School of Nursing, so only Nursing students evaluate them.</p>}
      {f.position === 'ci' && !nursingDepts(db).length && <div className="note warn">Add the School of Nursing under Departments first.</div>}
      {f.role !== 'ST' && (
        <div className="row">
          <span className="muted">Can evaluate as:</span>
          {groups.map((g) => <label key={g.id} className="inline"><input type="checkbox" checked={(f.evaluatorGroupIds || []).includes(g.id)} onChange={() => toggleEvaluatorGroup(g.id)} /> {g.name}</label>)}
          {!groups.length && <span className="muted">No evaluator groups are configured yet.</span>}
        </div>
      )}
      {f.role !== 'ST' && (
        <div className="row">
          <span className="muted">Can be evaluated as:</span>
          {evaluatees.map((r) => <label key={r.id} className="inline"><input type="checkbox" checked={(f.evaluateeTypeIds || []).includes(r.id)} onChange={() => toggleEvaluateeRole(r.id)} /> {r.name}</label>)}
          {!evaluatees.length && <span className="muted">No evaluatee roles are configured yet.</span>}
        </div>
      )}
      {f.role === 'ST' && f.dept && (
        <div className="row">
          <span className="muted">Classes:</span>
          {classes.length ? classes.map((s) => (
            <label key={s.id} className="inline"><input type="checkbox" checked={f.sectionIds.includes(s.id)} onChange={() => toggle(s.id)} /> {s.code}</label>
          )) : <span className="muted">No class sections in this department.</span>}
        </div>
      )}
      <div className="row">
        <button onClick={() => onSave(f)}>{saveLabel}</button>
        {onCancel && <button className="ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

function TempPasswordNote({ info, onClose }) {
  const box = useRef(null);
  const [copied, setCopied] = useState(false);
  // bring the box into view (e.g. after "Reset password" far down the list)
  useEffect(() => { box.current?.scrollIntoView({ block: 'center' }); }, [info]);
  const copy = async () => { try { await navigator.clipboard.writeText(info.tempPassword); setCopied(true); } catch { setCopied(false); } };
  return (
    <div ref={box} className="note ok row" style={{ justifyContent: 'space-between' }}>
      <span>
        Temporary password for <b>{info.username}</b>: <code className="temp-pw">{info.tempPassword}</code><br />
        <span className="muted">Give it to them privately. They must choose their own password when they first sign in. Until then you can see it again with <b>Show temporary password</b> in the list below.</span>
      </span>
      <span className="row" style={{ margin: 0 }}>
        <button className="ghost" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        <button className="ghost" onClick={onClose}>Done</button>
      </span>
    </div>
  );
}

/** HR adds, renames and removes departments. The type decides which weights a teacher's result uses. */
function Departments() {
  const { db, act } = useApp();
  const [name, setName] = useState('');
  const [kind, setKind] = useState('college');
  const [msg, setMsg] = useState('');
  const people = (id) => db.users.filter((u) => u.dept === id).length;
  const inUse = (id) => people(id) > 0 || db.sections.some((s) => s.dept === id) || db.instruments.some((i) => i.dept === id);
  const add = async () => {
    setMsg('');
    if (!name.trim()) return setMsg('Type the department name first.');
    if (await act('addDepartment', { name, kind })) { setMsg(`${name.trim()} added.`); setName(''); }
  };
  return (
    <Card title={`Departments (${db.departments.length})`}>
      {db.departments.length === 0 && <div className="note warn"><b>Add your departments first.</b> Every student, teacher and staff member belongs to one.</div>}
      {missingUbDepartments(db).length > 0 && (
        <div className="row">
          <button className="ghost" onClick={async () => { setMsg(''); const r = await act('addUbDepartments'); if (r) setMsg(`${r.added} University of Baguio department(s) added.`); }}>
            Add the {missingUbDepartments(db).length} missing UB department(s)
          </button>
          <span className="muted">{missingUbDepartments(db).map((d) => d.id).join(', ')}</span>
        </div>
      )}
      <div className="row">
        <input className="wide" placeholder="Department name, e.g. School of Nursing" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <Select value={kind} onChange={setKind}><option value="college">College</option><option value="basic">Basic Education</option></Select>
        <button onClick={add}>Add department</button>
      </div>
      {msg && <div className="note">{msg}</div>}
      {db.departments.length > 0 && (
        <table>
          <thead><tr><th>Department</th><th>Type</th><th>People</th><th /></tr></thead>
          <tbody>{newestFirst(db.departments).map((d) => (
            <tr key={d.id}>
              <td><SaveInput className="wide" value={d.name} onSave={(v) => act('updateDepartment', { deptId: d.id, name: v })} /></td>
              <td><Select value={d.kind} onChange={(v) => act('updateDepartment', { deptId: d.id, kind: v })}><option value="college">College</option><option value="basic">Basic Education</option></Select></td>
              <td>{people(d.id)}</td>
              <td><button className="ghost" disabled={inUse(d.id)} title={inUse(d.id) ? 'People, classes or forms still belong to this department' : ''}
                onClick={async () => { if (await ask(`Delete ${d.name}?`, 'This department is removed from the list.', { ok: 'Delete department', danger: true })) act('deleteDepartment', { deptId: d.id }); }}>Delete</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <p className="muted">Click a name to rename it. Department type supplies the starting evaluator groups and weights; HR can configure the approved scoring under Scoring &amp; calculation.</p>
    </Card>
  );
}

function EvaluatorGroups() {
  const { db, act } = useApp();
  const [name, setName] = useState('');
  const [targetTypes, setTargetTypes] = useState([]);
  const [evaluateeName, setEvaluateeName] = useState('');
  const [evaluatorGroupIds, setEvaluatorGroupIds] = useState([]);
  const [msg, setMsg] = useState('');
  const toggle = (id) => setTargetTypes((xs) => xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]);
  const toggleEvaluator = (id) => setEvaluatorGroupIds((xs) => xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]);
  const add = async () => {
    setMsg('');
    if (!name.trim()) return setMsg('Enter a name for the evaluator group.');
    if (!targetTypes.length) return setMsg('Choose at least one evaluated category.');
    const result = await act('addEvaluatorGroup', { name, targetTypes });
    if (result) { setMsg(`${result.name} added. Assign staff to this group under Accounts, then create its evaluation form under Forms.`); setName(''); setTargetTypes([]); }
  };
  const addEvaluatee = async () => {
    setMsg('');
    if (!evaluateeName.trim()) return setMsg('Enter a name for the evaluatee role.');
    if (!evaluatorGroupIds.length) return setMsg('Choose at least one evaluator role.');
    const result = await act('addEvaluateeRole', { name: evaluateeName, evaluatorGroupIds });
    if (result) { setMsg(`${result.name} added. Assign people under Accounts, then create its forms and scoring rule.`); setEvaluateeName(''); setEvaluatorGroupIds([]); }
  };
  const targetsFor = (id) => Object.keys(db.rules).filter((tt) => Object.hasOwn(db.rules[tt], id));
  const membersFor = (id) => db.users.filter((u) => evaluatorGroups(u).includes(id)).length;
  const peopleFor = (id) => db.users.filter((u) => targetTypesOf(db, u).includes(id)).length;
  const activeGroups = (db.evaluatorGroups || []).filter((g) => g.active !== false && g.id !== 'ST');
  const activeTypes = evaluateeRoles(db).filter((r) => r.active !== false);
  return (
    <Card title="Evaluation roles">
      <p className="muted">Create and manage who can evaluate and who can receive an evaluation. Assign people to either or both roles under Accounts. Roles used by forms or historical evaluations are archived rather than erased.</p>
      <table>
        <thead><tr><th>Evaluator role</th><th>Can evaluate</th><th>Assigned accounts</th><th>Status</th><th /></tr></thead>
        <tbody>{(db.evaluatorGroups || []).map((g) => (
          <tr key={g.id}>
            <td>{g.id === 'ST' ? <b>{groupName(db, g.id)}</b> : <SaveInput value={g.name} onSave={(v) => act('updateEvaluatorGroup', { groupId: g.id, name: v })} />}<div className="muted small">{g.id}</div></td>
            <td>{targetsFor(g.id).map((tt) => evaluateeRoleName(db, tt)).join(', ') || '—'}</td>
            <td>{membersFor(g.id)}</td>
            <td>{g.active === false ? 'Archived' : g.builtIn ? 'Built in' : 'Active'}</td>
            <td>{g.id !== 'ST' && g.active === false && <button className="ghost" onClick={() => act('updateEvaluatorGroup', { groupId: g.id, active: true })}>Restore</button>}
              {g.id !== 'ST' && g.active !== false && <button className="ghost" onClick={async () => {
              if (await ask(`Archive ${g.name}?`, 'The role will no longer be used for new evaluations. Past assignments and results are kept.', { ok: 'Archive role', danger: true })) {
                const result = await act('deleteEvaluatorGroup', { groupId: g.id });
                if (result) setMsg(result.archived ? `${g.name} archived; its historical references are preserved.` : `${g.name} deleted because it was unused.`);
              }
            }}>Archive / delete</button>}</td>
          </tr>
        ))}</tbody>
      </table>
      <div className="row">
        <input className="wide" placeholder="New evaluator role, e.g. Department Head" value={name} onChange={(e) => setName(e.target.value)} />
        <button onClick={add}>Add evaluator role</button>
      </div>
      <div className="row">
        <span className="muted">Can evaluate:</span>
        {activeTypes.map((r) => <label key={r.id} className="inline"><input type="checkbox" checked={targetTypes.includes(r.id)} onChange={() => toggle(r.id)} /> {r.name}</label>)}
      </div>
      <h3 className="section-h">Evaluatee roles</h3>
      <table>
        <thead><tr><th>Role</th><th>Evaluated by</th><th>Assigned people</th><th>Status</th><th /></tr></thead>
        <tbody>{evaluateeRoles(db).map((r) => (
          <tr key={r.id}>
            <td>{r.id === 'COLLEGE_FACULTY' ? <b>{r.name}</b> : <SaveInput value={r.name} onSave={(v) => act('updateEvaluateeRole', { roleId: r.id, name: v })} />}<div className="muted small">{r.id}</div></td>
            <td>{Object.keys(db.rules[r.id] || {}).map((g) => groupName(db, g)).join(', ') || '—'}</td>
            <td>{peopleFor(r.id)}</td>
            <td>{r.active === false ? 'Archived' : r.builtIn ? 'Built in' : 'Active'}</td>
            <td>{r.id !== 'COLLEGE_FACULTY' && r.active === false && <button className="ghost" onClick={() => act('updateEvaluateeRole', { roleId: r.id, active: true })}>Restore</button>}
              {r.id !== 'COLLEGE_FACULTY' && r.active !== false && <button className="ghost" onClick={async () => {
              if (await ask(`Archive ${r.name}?`, 'New tasks will stop using this role. Existing accounts, formulas, tasks, and results are preserved.', { ok: 'Archive role', danger: true })) {
                const result = await act('deleteEvaluateeRole', { roleId: r.id });
                if (result) setMsg(result.archived ? `${r.name} archived; historical references are preserved.` : `${r.name} deleted because it was unused.`);
              }
            }}>Archive / delete</button>}</td>
          </tr>
        ))}</tbody>
      </table>
      <div className="row">
        <input className="wide" placeholder="New evaluatee role, e.g. Department Head" value={evaluateeName} onChange={(e) => setEvaluateeName(e.target.value)} />
        <button onClick={addEvaluatee}>Add evaluatee role</button>
      </div>
      <div className="row">
        <span className="muted">Evaluated by:</span>
        {activeGroups.map((g) => <label key={g.id} className="inline"><input type="checkbox" checked={evaluatorGroupIds.includes(g.id)} onChange={() => toggleEvaluator(g.id)} /> {groupName(db, g.id)}</label>)}
      </div>
      {msg && <div className="note">{msg}</div>}
    </Card>
  );
}

function AccessRoles() {
  const { db, act } = useApp();
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('TP');
  const [msg, setMsg] = useState('');
  const add = async () => {
    setMsg('');
    if (!name.trim()) return setMsg('Enter a name for the access role.');
    const result = await act('addAccessRole', { name, template });
    if (result) { setMsg(`${result.name} added using the ${ROLES[result.template]} permission profile.`); setName(''); }
  };
  const assigned = (id) => db.users.filter((u) => u.accessRoleId === id).length;
  return (
    <Card title="Access roles">
      <p className="muted">Each access role uses a predefined server-enforced permission profile. HR can create a clear label for a team, but cannot create arbitrary permissions or change a profile’s permission template. Student and built-in system profiles remain protected.</p>
      <table><thead><tr><th>Access role</th><th>Permission profile</th><th>Assigned people</th><th>Status</th><th /></tr></thead>
        <tbody>{db.accessRoles.map((r) => <tr key={r.id}>
          <td>{r.builtIn ? <b>{accessRoleName(db, r.id)}</b> : <SaveInput value={r.name} onSave={(v) => act('updateAccessRole', { roleId: r.id, name: v })} />}</td>
          <td>{ROLES[r.template]}</td><td>{assigned(r.id)}</td><td>{r.active === false ? 'Archived' : r.builtIn ? 'Built in' : 'Active'}</td>
          <td>{!r.builtIn && r.active !== false && <button className="ghost" onClick={async () => {
            if (await ask(`Archive ${r.name}?`, 'Accounts keep their current access. The role can no longer be assigned to new or edited accounts.', { ok: 'Archive role', danger: true })) {
              const result = await act('deleteAccessRole', { roleId: r.id });
              if (result) setMsg(result.archived ? `${r.name} archived; assigned accounts keep their existing permissions.` : `${r.name} deleted because it was unused.`);
            }
          }}>Archive / delete</button>}</td>
        </tr>)}</tbody>
      </table>
      <div className="row">
        <input className="wide" placeholder="New access role label" value={name} onChange={(e) => setName(e.target.value)} />
        <Select value={template} onChange={setTemplate}>{Object.entries(ROLES).filter(([id]) => id !== 'ST').map(([id, label]) => <option key={id} value={id}>{label} permissions</option>)}</Select>
        <button onClick={add}>Add access role</button>
      </div>
      {msg && <div className="note">{msg}</div>}
    </Card>
  );
}

export function Accounts() {
  const { db, user, act } = useApp();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [temp, setTemp] = useState(null);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [dept, setDept] = useState('');
  const [showInactive, setShowInactive] = useState(true);

  const enrolled = (id) => db.sections.filter((s) => s.studentIds.includes(id)).map((s) => s.id);
  const create = async (f) => {
    setMsg('');
    const r = await act('createUser', f);
    if (r) { setTemp(r); setAdding(false); }
  };
  const update = async (f) => {
    setMsg('');
    if (await act('updateUser', { userId: editing, ...f })) { setEditing(null); setMsg('Account updated.'); }
  };
  const reset = async (u) => {
    if (!(await ask('Reset password?', `Give ${u.name} a new temporary password? Their current password stops working and they are signed out.`, { ok: 'Reset password' }))) return;
    setMsg('');
    const r = await act('resetPassword', { userId: u.id });
    if (r) setTemp(r);
  };
  const setActive = async (u, active) => {
    if (!active && !(await ask(`Deactivate ${u.name}?`, "They are signed out and can't sign in until reactivated. Their past evaluations are kept.", { ok: 'Deactivate', danger: true }))) return;
    setMsg('');
    if (await act('setUserActive', { userId: u.id, active })) setMsg(`${u.name} was ${active ? 'reactivated' : 'deactivated'}.`);
  };

  const s = q.trim().toLowerCase();
  const list = newestFirst(db.users).filter((u) => (!role || (u.accessRoleId || u.role) === role) && (!dept || u.dept === dept) && (showInactive || u.active)
    && (!s || u.name.toLowerCase().includes(s) || u.username.toLowerCase().includes(s) || (u.email || '').toLowerCase().includes(s)));
  const { rows, bar } = usePages(list, `${role}|${dept}|${showInactive}|${s}`);

  return (
    <>
      <div className="note">
        <b>Most student and teacher accounts are created when you import a class list.</b> Use this page for one person at a time, or to update a name, reset a password, or manage departments. New accounts get a temporary password that must be changed at first sign-in.
      </div>
      <Departments />
      <AccessRoles />
      <EvaluatorGroups />

      {temp && <TempPasswordNote info={temp} onClose={() => setTemp(null)} />}
      {msg && <div className="note">{msg}</div>}

      <Card title="Add an account" actions={!adding && <button onClick={() => { setAdding(true); setTemp(null); }}>New account</button>}>
        {adding
          ? <AccountForm initial={EMPTY} onSave={create} onCancel={() => setAdding(false)} saveLabel="Create account" />
          : <p className="muted">Create accounts for new students, faculty and staff.</p>}
      </Card>

      <Card title={`Accounts (${list.length})`} actions={
        <div className="row" style={{ margin: 0 }}>
          <input placeholder="Search name, username or email" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={role} onChange={setRole}><option value="">All roles</option>{db.accessRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
          <Select value={dept} onChange={setDept}><option value="">All departments</option>{db.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
          <label className="inline muted"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show deactivated</label>
        </div>
      }>
        <table>
          <thead><tr><th>Name</th><th>Username / email</th><th>Role</th><th>Department</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map((u) => editing === u.id ? (
              <tr key={u.id}><td colSpan={6}>
                <AccountForm initial={{ name: u.name, username: u.username, email: u.email || '', role: u.role, accessRoleId: u.accessRoleId || u.role, position: u.position, dept: u.dept || '', sectionIds: enrolled(u.id), evaluatorGroupIds: u.evaluatorGroupIds || evaluatorGroups(u), evaluateeTypeIds: targetTypesOf(db, u) }}
                  onSave={update} onCancel={() => setEditing(null)} saveLabel="Save changes" />
              </td></tr>
            ) : (
              <tr key={u.id} className={u.active ? '' : 'inactive'}>
                <td><span className="who-cell"><Avatar name={u.name} size={30} />{u.name}{u.id === user.id && <span className="muted"> (you)</span>}</span></td>
                <td><code>{u.username}</code><br /><span className="muted">{u.email}</span></td>
                <td>{POSITIONS[u.role]?.[u.position] || u.position}<br /><span className="muted">{accessRoleName(db, u.accessRoleId || u.role)}</span></td>
                <td>{u.dept ? deptName(db, u.dept) : '—'}</td>
                <td>
                  {!u.active ? <Badge kind="overdue">deactivated</Badge>
                    : u.mustChangePassword ? <Badge kind="pending">temporary password</Badge>
                      : <Badge kind="completed">active</Badge>}
                </td>
                <td className="row" style={{ margin: 0 }}>
                  <button className="ghost" onClick={() => { setEditing(u.id); setTemp(null); }}>Edit</button>
                  {u.hasTempPassword && <button className="ghost" onClick={async () => { setMsg(''); const r = await act('showTempPassword', { userId: u.id }); if (r) setTemp(r); }}>Show temporary password</button>}
                  {u.id !== user.id && u.active && <button className="ghost" onClick={() => reset(u)}>Reset password</button>}
                  {u.id !== user.id && (u.active
                    ? <button className="ghost" onClick={() => setActive(u, false)}>Deactivate</button>
                    : <button className="ghost" onClick={() => setActive(u, true)}>Reactivate</button>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <Empty icon="users" title="No accounts match">Change the filters above.</Empty>}
        {bar}
      </Card>
    </>
  );
}
