import crypto from 'crypto';
import { TASK_PERMISSIONS, TASK_ROLES } from '../director/constants.mjs';
import { PROJECT_STAGES, STAGE_LABELS } from './workflow.mjs';

const h=(v)=>crypto.createHash('sha256').update(String(v)).digest('hex').slice(0,16);
export class ContractorPmoService {
  constructor({store,director=null,whatsapp=null}={}){ if(!store) throw new Error('PMO store is required.'); this.store=store; this.director=director; this.whatsapp=whatsapp; }
  getStatus(){ return {mode:'WOOD_CONTRACTOR_PMO',whatsapp:this.whatsapp?.getStatus?.()||{configured:false,webhookConfigured:false}}; }
  getOverview(){ return {...this.store.getOverview(),integration:{whatsapp:this.whatsapp?.getStatus?.()||{configured:false,webhookConfigured:false}}}; }
  createProject(input,options={}){ return this.store.createProject(input,options); }
  transitionProject(id,to,options={}){ return this.store.transitionProject(id,to,options); }

  receiveWhatsApp(payload,{actor='wa-gateway'}={}) {
    if(!this.whatsapp) throw new Error('WhatsApp integration unavailable.');
    const m=this.whatsapp.extractInboundMessage(payload);
    if(!m.phone){ const e=new Error('Inbound WhatsApp sender missing.'); e.code='WA_INBOUND_PHONE_MISSING'; throw e; }
    if(!m.text){ const e=new Error('Inbound WhatsApp text missing.'); e.code='WA_INBOUND_TEXT_MISSING'; throw e; }
    let project=this.store.findProjectByPhone(m.phone), created=false;
    if(!project){
      const name=String(m.contactName||m.phone).trim().slice(0,160);
      project=this.store.createProject({title:'WhatsApp Lead — '+name,customerName:name,customerPhone:m.phone,projectType:'OTHER',source:'WHATSAPP',stage:PROJECT_STAGES.INQUIRY,notes:'Lead otomatis dari WhatsApp. Pesan awal: '+m.text.slice(0,500)},{actor});
      created=true;
    }
    const communication=this.store.addCommunication(project.id,{channel:'WHATSAPP',direction:'INBOUND',externalId:m.externalId,contact:m.phone,body:m.text,metadata:{contactName:m.contactName,source:'wa-gateway'}},{actor});
    return {accepted:true,projectCreated:created,project:this.store.getProject(project.id),communication};
  }

  async sendProjectWhatsApp(projectId,{message,metadata=null}={}, {actor='operator'}={}) {
    const p=this.store.getProject(projectId); if(!p){const e=new Error('Project not found.');e.code='PROJECT_NOT_FOUND';throw e;}
    if(!p.customerPhone){const e=new Error('Project customer phone missing.');e.code='PROJECT_PHONE_MISSING';throw e;}
    const result=await this.whatsapp.sendMessage({to:p.customerPhone,message,projectId,metadata:{projectCode:p.code,stage:p.stage,...(metadata||{})}});
    const communication=this.store.addCommunication(projectId,{channel:'WHATSAPP',direction:'OUTBOUND',externalId:result.externalId,contact:p.customerPhone,body:message,metadata:{gateway:'customerservicecrm',actor}},{actor});
    return {result,communication};
  }

  async generateAiPlan(projectId,{objective=null}={}) {
    const p=this.store.getProject(projectId); if(!p){const e=new Error('Project not found.');e.code='PROJECT_NOT_FOUND';throw e;}
    if(!this.director?.dispatch){const e=new Error('Iron Director unavailable.');e.code='DIRECTOR_UNAVAILABLE';throw e;}
    const context={project:{id:p.id,code:p.code,title:p.title,customerName:p.customerName,projectType:p.projectType,stage:p.stage,stageLabel:STAGE_LABELS[p.stage],nextStage:p.nextStage,estimatedValue:p.estimatedValue,budgetCap:p.budgetCap,targetStartDate:p.targetStartDate,targetFinishDate:p.targetFinishDate,notes:p.notes},tasks:p.tasks.map(t=>({stage:t.stage,category:t.category,title:t.title,status:t.status,blockedReason:t.blocked_reason})),openRisks:p.risks.filter(r=>r.status==='OPEN'),pendingApprovals:p.approvals.filter(a=>a.status==='PENDING').map(a=>a.approval_type),recentCommunications:p.communications.slice(0,8).map(c=>({direction:c.direction,body:c.body,createdAt:c.created_at})),objective:objective||'Tentukan langkah terbaik agar proyek tepat waktu, margin terjaga, dan risiko instalasi rendah.'};
    const systemPrompt='Anda adalah AI PMO kontraktor kayu, custom furniture, cabinetry, dan interior fit-out. Prioritaskan scope control, survey measurement, shop drawing, BOQ/RAB, procurement, produksi, QC finishing, site readiness, instalasi, punch list, BAST, dan cashflow. Jangan mengarang fakta. Jangan menganggap approval/payment selesai tanpa evidence. Output JSON valid.';
    const userPrompt='PROJECT CONTEXT:\\n'+JSON.stringify(context)+'\\n\\nOutput fields: executiveSummary, nextActions (3-8 objects priority/ownerType/action/evidenceRequired), risks (0-5), missingInfo (0-8), recommendedStage, customerUpdate.';
    return this.director.dispatch({
      title:'PMO Plan '+p.code+' — '+p.title, role:TASK_ROLES.REASONER, owner:'pmo-planner',
      permissions:[TASK_PERMISSIONS.READ], input:{actionType:'PMO_PROJECT_PLAN',projectId:p.id,projectCode:p.code,stage:p.stage},
      idempotencyKey:'pmo-plan:'+p.id+':'+h(JSON.stringify(context)), systemPrompt,userPrompt,artifactType:'json',
      verificationRules:{requiredFields:['executiveSummary','nextActions','risks','missingInfo','recommendedStage','customerUpdate'],arrayBounds:{nextActions:{min:3,max:8},risks:{min:0,max:5},missingInfo:{min:0,max:8}}}
    });
  }
}
