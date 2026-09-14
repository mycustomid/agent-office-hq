import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  ACTIVE_STAGES,
  APPROVAL_TYPES,
  DEFAULT_PROJECT_CHECKLIST,
  PROJECT_STAGES,
  PROJECT_TYPES,
  STAGE_AUTO_APPROVAL_REQUESTS,
  STAGE_LABELS,
  canTransition,
  getNextStage,
  normalizePhone,
  requiredApprovalsForTransition
} from './workflow.mjs';

const now = () => new Date().toISOString();
const id = (prefix) => prefix + '-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
const clean = (v, n = 2000) => v == null ? null : (String(v).trim().slice(0, n) || null);
const money = (v) => v == null || v === '' ? null : (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);

function projectCode() {
  const d = new Date();
  const stamp = String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  return 'PRJ-' + stamp + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
}

export class ContractorPmoStore {
  constructor({ dbPath = path.resolve('data/pmo/pmo.db') } = {}) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec([
      'PRAGMA journal_mode=WAL;',
      'PRAGMA synchronous=FULL;',
      'PRAGMA busy_timeout=5000;',
      'PRAGMA foreign_keys=ON;',
      "CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, title TEXT NOT NULL, customer_name TEXT NOT NULL, customer_phone TEXT, customer_email TEXT, project_type TEXT NOT NULL, site_address TEXT, site_city TEXT, stage TEXT NOT NULL, previous_stage TEXT, priority TEXT NOT NULL DEFAULT 'NORMAL', owner TEXT, source TEXT NOT NULL DEFAULT 'MANUAL', estimated_value REAL, budget_cap REAL, target_start_date TEXT, target_finish_date TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT);",
      'CREATE INDEX IF NOT EXISTS idx_projects_stage ON projects(stage,updated_at DESC);',
      'CREATE INDEX IF NOT EXISTS idx_projects_phone ON projects(customer_phone);',
      "CREATE TABLE IF NOT EXISTS project_tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, stage TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'NOT_STARTED', assignee_type TEXT NOT NULL DEFAULT 'HUMAN', assignee TEXT, due_at TEXT, blocked_reason TEXT, director_task_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);",
      "CREATE TABLE IF NOT EXISTS project_risks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, category TEXT NOT NULL, probability INTEGER NOT NULL, impact INTEGER NOT NULL, score INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN', description TEXT NOT NULL, mitigation TEXT, owner TEXT, due_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);",
      "CREATE TABLE IF NOT EXISTS project_approvals (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, approval_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', requested_by TEXT, decided_by TEXT, amount REAL, note TEXT, requested_at TEXT NOT NULL, decided_at TEXT, FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);",
      'CREATE TABLE IF NOT EXISTS project_communications (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, channel TEXT NOT NULL, direction TEXT NOT NULL, external_id TEXT, contact TEXT, body TEXT NOT NULL, metadata TEXT, created_at TEXT NOT NULL, FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);',
      'CREATE TABLE IF NOT EXISTS project_activities (event_id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, event_type TEXT NOT NULL, actor TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL, FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);'
    ].join('\n'));
  }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const out = fn(); this.db.exec('COMMIT'); return out; }
    catch (e) { try { this.db.exec('ROLLBACK'); } catch {} throw e; }
  }

  activity(projectId, type, actor = 'system', payload = null) {
    this.db.prepare('INSERT INTO project_activities(project_id,event_type,actor,payload,created_at) VALUES(?,?,?,?,?)')
      .run(projectId, type, actor, payload ? JSON.stringify(payload) : null, now());
  }

  hydrate(row) {
    if (!row) return null;
    const nextStage = getNextStage(row.stage);
    return {
      id: row.id, code: row.code, title: row.title,
      customerName: row.customer_name, customerPhone: row.customer_phone, customerEmail: row.customer_email,
      projectType: row.project_type, siteAddress: row.site_address, siteCity: row.site_city,
      stage: row.stage, stageLabel: STAGE_LABELS[row.stage] || row.stage,
      nextStage, nextStageLabel: nextStage ? STAGE_LABELS[nextStage] : null,
      previousStage: row.previous_stage, priority: row.priority, owner: row.owner, source: row.source,
      estimatedValue: row.estimated_value == null ? null : Number(row.estimated_value),
      budgetCap: row.budget_cap == null ? null : Number(row.budget_cap),
      targetStartDate: row.target_start_date, targetFinishDate: row.target_finish_date,
      notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at, closedAt: row.closed_at
    };
  }

  createProject(input = {}, { actor = 'operator' } = {}) {
    const title = clean(input.title, 220);
    const customerName = clean(input.customerName || input.customer_name, 160);
    if (!title || !customerName) throw new Error('Project title and customer name are required.');
    const projectType = String(input.projectType || 'OTHER').toUpperCase();
    if (!PROJECT_TYPES.includes(projectType)) throw new Error('Unsupported project type.');
    const stage = String(input.stage || PROJECT_STAGES.INQUIRY).toUpperCase();
    if (!Object.values(PROJECT_STAGES).includes(stage)) throw new Error('Invalid project stage.');

    return this.tx(() => {
      const projectId = input.id || id('project');
      const t = now();
      this.db.prepare('INSERT INTO projects(id,code,title,customer_name,customer_phone,customer_email,project_type,site_address,site_city,stage,priority,owner,source,estimated_value,budget_cap,target_start_date,target_finish_date,notes,created_at,updated_at,closed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(projectId, input.code || projectCode(), title, customerName, normalizePhone(input.customerPhone || '') || null,
          clean(input.customerEmail,220), projectType, clean(input.siteAddress,1200), clean(input.siteCity,120), stage,
          String(input.priority || 'NORMAL').toUpperCase(), clean(input.owner,120), String(input.source || 'MANUAL').toUpperCase(),
          money(input.estimatedValue), money(input.budgetCap), clean(input.targetStartDate,40), clean(input.targetFinishDate,40),
          clean(input.notes,4000), t, t, stage === PROJECT_STAGES.COMPLETED ? t : null);

      const addTask = this.db.prepare("INSERT INTO project_tasks(id,project_id,stage,category,title,status,assignee_type,created_at,updated_at) VALUES(?,?,?,?,?,'NOT_STARTED','HUMAN',?,?)");
      for (const item of DEFAULT_PROJECT_CHECKLIST) addTask.run(id('ptask'), projectId, item.stage, item.category, item.title, t, t);
      this.activity(projectId, 'PROJECT_CREATED', actor, { stage, source: input.source || 'MANUAL' });
      for (const type of STAGE_AUTO_APPROVAL_REQUESTS[stage] || []) this.ensureApproval(projectId, type, actor);
      return this.getProject(projectId);
    });
  }

  listProjects({ stage = null, limit = 200 } = {}) {
    const max = Math.max(1, Math.min(500, Number(limit) || 200));
    const rows = stage
      ? this.db.prepare('SELECT * FROM projects WHERE stage=? ORDER BY updated_at DESC LIMIT ?').all(stage, max)
      : this.db.prepare("SELECT * FROM projects ORDER BY CASE WHEN stage IN ('COMPLETED','CANCELLED') THEN 1 ELSE 0 END, updated_at DESC LIMIT ?").all(max);
    return rows.map(r => {
      const p = this.hydrate(r);
      p.pendingApprovals = Number(this.db.prepare("SELECT COUNT(*) c FROM project_approvals WHERE project_id=? AND status='PENDING'").get(p.id)?.c || 0);
      p.highRisks = Number(this.db.prepare("SELECT COUNT(*) c FROM project_risks WHERE project_id=? AND status='OPEN' AND score>=12").get(p.id)?.c || 0);
      p.blockedTasks = Number(this.db.prepare("SELECT COUNT(*) c FROM project_tasks WHERE project_id=? AND status='BLOCKED'").get(p.id)?.c || 0);
      p.health = this.health(p);
      p.gate = this.getTransitionGate(p.id, p.nextStage);
      return p;
    });
  }

  getProject(projectId) {
    const p = this.hydrate(this.db.prepare('SELECT * FROM projects WHERE id=?').get(projectId));
    if (!p) return null;
    p.tasks = this.db.prepare('SELECT * FROM project_tasks WHERE project_id=? ORDER BY created_at').all(projectId);
    p.risks = this.db.prepare('SELECT * FROM project_risks WHERE project_id=? ORDER BY score DESC,created_at DESC').all(projectId);
    p.approvals = this.listApprovals({ projectId });
    p.communications = this.db.prepare('SELECT * FROM project_communications WHERE project_id=? ORDER BY created_at DESC LIMIT 50').all(projectId).map(r => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : {} }));
    p.activities = this.db.prepare('SELECT * FROM project_activities WHERE project_id=? ORDER BY event_id DESC LIMIT 100').all(projectId);
    p.health = this.health(p);
    p.gate = this.getTransitionGate(projectId, p.nextStage);
    return p;
  }

  findProjectByPhone(phone) {
    const normalized = normalizePhone(phone);
    if (!normalized) return null;
    const row = this.db.prepare("SELECT id FROM projects WHERE customer_phone=? AND stage NOT IN ('COMPLETED','CANCELLED') ORDER BY updated_at DESC LIMIT 1").get(normalized);
    return row ? this.getProject(row.id) : null;
  }

  ensureApproval(projectId, approvalType, requestedBy = 'system', amount = null, note = null) {
    if (!Object.values(APPROVAL_TYPES).includes(approvalType)) throw new Error('Unsupported approval type.');
    const existing = this.db.prepare("SELECT * FROM project_approvals WHERE project_id=? AND approval_type=? AND status IN ('PENDING','APPROVED') ORDER BY requested_at DESC LIMIT 1").get(projectId, approvalType);
    if (existing) return existing;
    const approvalId = id('approval');
    this.db.prepare("INSERT INTO project_approvals(id,project_id,approval_type,status,requested_by,amount,note,requested_at) VALUES(?,?,?,'PENDING',?,?,?,?)")
      .run(approvalId, projectId, approvalType, requestedBy, money(amount), clean(note,1200), now());
    return this.db.prepare('SELECT * FROM project_approvals WHERE id=?').get(approvalId);
  }

  requestApproval(projectId, input = {}, { actor = 'operator' } = {}) {
    const a = this.ensureApproval(projectId, String(input.approvalType || '').toUpperCase(), actor, input.amount, input.note);
    this.activity(projectId, 'APPROVAL_REQUESTED', actor, { approvalId: a.id, approvalType: a.approval_type });
    return a;
  }

  decideApproval(approvalId, decision, { actor = 'operator', note = null } = {}) {
    const a = this.db.prepare('SELECT * FROM project_approvals WHERE id=?').get(approvalId);
    if (!a) throw new Error('Approval not found.');
    const status = String(decision || '').toUpperCase();
    if (!['APPROVED','REJECTED'].includes(status)) throw new Error('Decision must be APPROVED or REJECTED.');
    const t = now();
    this.db.prepare('UPDATE project_approvals SET status=?,decided_by=?,note=COALESCE(?,note),decided_at=? WHERE id=?').run(status,actor,clean(note,1200),t,approvalId);
    this.db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(t,a.project_id);
    this.activity(a.project_id, 'APPROVAL_DECIDED', actor, { approvalId, approvalType: a.approval_type, status });
    return this.db.prepare('SELECT * FROM project_approvals WHERE id=?').get(approvalId);
  }

  listApprovals({ projectId = null, status = null, limit = 200 } = {}) {
    let sql = 'SELECT a.*,p.code project_code,p.title project_title,p.customer_name customer_name FROM project_approvals a JOIN projects p ON p.id=a.project_id';
    const where = [], args = [];
    if (projectId) { where.push('a.project_id=?'); args.push(projectId); }
    if (status) { where.push('a.status=?'); args.push(String(status).toUpperCase()); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += " ORDER BY CASE WHEN a.status='PENDING' THEN 0 ELSE 1 END,a.requested_at DESC LIMIT ?";
    args.push(Math.max(1, Math.min(500, Number(limit) || 200)));
    return this.db.prepare(sql).all(...args);
  }

  getTransitionGate(projectId, toStage, fromStage = null) {
    if (!toStage) return { passed: true, required: [], approved: [], missing: [] };
    const from = fromStage || this.db.prepare('SELECT stage FROM projects WHERE id=?').get(projectId)?.stage;
    if (!from) return { passed: false, required: [], approved: [], missing: ['PROJECT_NOT_FOUND'] };
    const required = requiredApprovalsForTransition(from, toStage);
    const approved = this.db.prepare("SELECT DISTINCT approval_type FROM project_approvals WHERE project_id=? AND status='APPROVED'").all(projectId).map(x => x.approval_type);
    const missing = required.filter(x => !approved.includes(x));
    return { passed: missing.length === 0, required, approved, missing };
  }

  transitionProject(projectId, toStage, { actor = 'operator', reason = null } = {}) {
    const current = this.hydrate(this.db.prepare('SELECT * FROM projects WHERE id=?').get(projectId));
    if (!current) { const e = new Error('Project not found.'); e.code = 'PROJECT_NOT_FOUND'; throw e; }
    if (!canTransition(current.stage, toStage)) { const e = new Error('Invalid stage transition.'); e.code = 'INVALID_STAGE_TRANSITION'; throw e; }
    const gate = this.getTransitionGate(projectId, toStage, current.stage);
    if (!gate.passed) { const e = new Error('Transition blocked by approval gate.'); e.code = 'APPROVAL_GATE_BLOCKED'; e.gate = gate; throw e; }
    return this.tx(() => {
      const t = now(), closed = ['COMPLETED','CANCELLED'].includes(toStage) ? t : null;
      this.db.prepare('UPDATE projects SET previous_stage=stage,stage=?,updated_at=?,closed_at=? WHERE id=?').run(toStage,t,closed,projectId);
      this.activity(projectId,'STAGE_TRANSITION',actor,{ fromStage: current.stage, toStage, reason: clean(reason,800) });
      for (const type of STAGE_AUTO_APPROVAL_REQUESTS[toStage] || []) this.ensureApproval(projectId,type,actor);
      return this.getProject(projectId);
    });
  }

  updateTask(projectId, taskId, patch = {}, { actor = 'operator' } = {}) {
    const task = this.db.prepare('SELECT * FROM project_tasks WHERE id=? AND project_id=?').get(taskId,projectId);
    if (!task) throw new Error('Task not found.');
    const status = String(patch.status || task.status).toUpperCase();
    if (!['NOT_STARTED','IN_PROGRESS','BLOCKED','DONE','SKIPPED'].includes(status)) throw new Error('Invalid task status.');
    const t = now();
    this.db.prepare('UPDATE project_tasks SET status=?,assignee_type=?,assignee=?,due_at=?,blocked_reason=?,director_task_id=?,updated_at=? WHERE id=?')
      .run(status,String(patch.assigneeType || task.assignee_type).toUpperCase(),clean(patch.assignee ?? task.assignee,120),clean(patch.dueAt ?? task.due_at,40),clean(patch.blockedReason ?? task.blocked_reason,800),clean(patch.directorTaskId ?? task.director_task_id,160),t,taskId);
    this.db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(t,projectId);
    this.activity(projectId,'TASK_UPDATED',actor,{ taskId,status });
    return this.db.prepare('SELECT * FROM project_tasks WHERE id=?').get(taskId);
  }

  addRisk(projectId, input = {}, { actor = 'operator' } = {}) {
    if (!this.db.prepare('SELECT id FROM projects WHERE id=?').get(projectId)) throw new Error('Project not found.');
    const description = clean(input.description,1200);
    if (!description) throw new Error('Risk description is required.');
    const probability = Math.max(1,Math.min(5,Number(input.probability)||3));
    const impact = Math.max(1,Math.min(5,Number(input.impact)||3));
    const riskId = id('risk'), t = now();
    this.db.prepare("INSERT INTO project_risks(id,project_id,category,probability,impact,score,status,description,mitigation,owner,due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,'OPEN',?,?,?,?,?,?)")
      .run(riskId,projectId,String(input.category||'GENERAL').toUpperCase(),probability,impact,probability*impact,description,clean(input.mitigation,2000),clean(input.owner,120),clean(input.dueAt,40),t,t);
    this.activity(projectId,'RISK_CREATED',actor,{ riskId,score:probability*impact });
    return this.db.prepare('SELECT * FROM project_risks WHERE id=?').get(riskId);
  }

  addCommunication(projectId, input = {}, { actor = 'system' } = {}) {
    if (!this.db.prepare('SELECT id FROM projects WHERE id=?').get(projectId)) throw new Error('Project not found.');
    const body = clean(input.body,10000);
    if (!body) throw new Error('Communication body is required.');
    const communicationId = id('comm'), t = now();
    this.db.prepare('INSERT INTO project_communications(id,project_id,channel,direction,external_id,contact,body,metadata,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(communicationId,projectId,String(input.channel||'WHATSAPP').toUpperCase(),String(input.direction||'INBOUND').toUpperCase(),clean(input.externalId,220),normalizePhone(input.contact||'')||clean(input.contact,220),body,input.metadata?JSON.stringify(input.metadata):null,t);
    this.db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(t,projectId);
    this.activity(projectId,'COMMUNICATION_LOGGED',actor,{ communicationId,channel:input.channel||'WHATSAPP',direction:input.direction||'INBOUND' });
    return this.db.prepare('SELECT * FROM project_communications WHERE id=?').get(communicationId);
  }

  health(p) {
    const overdue = p.targetFinishDate && ACTIVE_STAGES.includes(p.stage) && new Date(p.targetFinishDate + 'T23:59:59').getTime() < Date.now();
    if (overdue || Number(p.highRisks||0) > 0 || Number(p.blockedTasks||0) > 0) return 'RED';
    if (Number(p.pendingApprovals||0) > 0) return 'AMBER';
    return 'GREEN';
  }

  getOverview() {
    const projects = this.listProjects({ limit: 200 });
    const active = projects.filter(p => ACTIVE_STAGES.includes(p.stage));
    const stageCounts = Object.fromEntries(Object.values(PROJECT_STAGES).map(s => [s,0]));
    for (const p of projects) stageCounts[p.stage] = (stageCounts[p.stage]||0)+1;
    const pendingApprovals = this.listApprovals({ status:'PENDING', limit:100 });
    return {
      generatedAt: now(),
      metrics: {
        activeProjects: active.length,
        totalProjects: projects.length,
        totalActiveValue: active.reduce((s,p)=>s+(Number(p.estimatedValue)||0),0),
        pendingApprovals: pendingApprovals.length,
        highRisks: Number(this.db.prepare("SELECT COUNT(*) c FROM project_risks WHERE status='OPEN' AND score>=12").get()?.c||0),
        blockedTasks: Number(this.db.prepare("SELECT COUNT(*) c FROM project_tasks WHERE status='BLOCKED'").get()?.c||0),
        overdueProjects: active.filter(p=>p.targetFinishDate&&new Date(p.targetFinishDate+'T23:59:59').getTime()<Date.now()).length
      },
      stageCounts, projects, pendingApprovals: pendingApprovals.slice(0,20)
    };
  }

  close() { try { this.db.close(); } catch {} }
}
