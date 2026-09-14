import http from 'http';
import { IronDirector } from '../director/iron_director.mjs';
import { ContractorPmoStore } from './project_store.mjs';
import { ContractorPmoService } from './service.mjs';
import { WhatsAppGatewayClient } from '../integrations/whatsapp_gateway.mjs';

const PORT = Number(process.env.PMO_PORT || 3334);
const API_TOKEN = String(process.env.PMO_API_TOKEN || '').trim();
const store = new ContractorPmoStore();
const whatsapp = new WhatsAppGatewayClient();
const director = new IronDirector();
const pmo = new ContractorPmoService({ store, whatsapp, director });

function json(res,status,payload){
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'Access-Control-Allow-Origin':process.env.PMO_CORS_ORIGIN || '*',
    'Access-Control-Allow-Headers':'Authorization, Content-Type, X-Webhook-Secret, X-Tenant-Key',
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS'
  });
  res.end(JSON.stringify(payload));
}
function bearer(req){ const h=String(req.headers.authorization||''); return h.startsWith('Bearer ')?h.slice(7).trim():''; }
function authorized(req){ return API_TOKEN && bearer(req)===API_TOKEN; }
async function body(req){
  let raw='';
  for await (const chunk of req){ raw+=chunk; if(raw.length>1_000_000) throw new Error('Payload too large.'); }
  if(!raw) return {};
  try{return JSON.parse(raw);}catch{ const e=new Error('Invalid JSON.'); e.code='INVALID_JSON'; throw e; }
}
function idFrom(pathname,re){ const m=pathname.match(re); return m?decodeURIComponent(m[1]):null; }
function errorStatus(e){
  if(e?.code==='PROJECT_NOT_FOUND') return 404;
  if(e?.code==='APPROVAL_GATE_BLOCKED'||e?.code==='INVALID_STAGE_TRANSITION') return 409;
  if(String(e?.code||'').startsWith('WA_GATEWAY')) return 502;
  if(e?.code==='INVALID_JSON') return 400;
  return 400;
}

const server=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS') return json(res,204,{});
  const url=new URL(req.url||'/', 'http://localhost');
  try{
    if(req.method==='GET' && url.pathname==='/healthz'){
      return json(res,200,{ok:true,service:'contractor-ai-pmo',mode:pmo.getStatus().mode,whatsapp:pmo.getStatus().whatsapp});
    }

    if(req.method==='POST' && ['/webhook/incoming','/webhook/whatsapp'].includes(url.pathname)){
      if(!whatsapp.verifyWebhookSecret(req.headers['x-webhook-secret'])) return json(res,401,{ok:false,error:'invalid_webhook_secret'});
      const result=pmo.receiveWhatsApp(await body(req));
      return json(res,202,{ok:true,...result});
    }

    if(!url.pathname.startsWith('/api/pmo/')) return json(res,404,{ok:false,error:'not_found'});
    if(!authorized(req)) return json(res,401,{ok:false,error:'unauthorized',hint:API_TOKEN?'Bearer token required':'Set PMO_API_TOKEN before exposing this API.'});

    if(req.method==='GET' && url.pathname==='/api/pmo/overview') return json(res,200,pmo.getOverview());
    if(req.method==='GET' && url.pathname==='/api/pmo/projects') return json(res,200,{projects:store.listProjects({stage:url.searchParams.get('stage')||null})});
    if(req.method==='POST' && url.pathname==='/api/pmo/projects') return json(res,201,{project:pmo.createProject(await body(req),{actor:'api'})});
    if(req.method==='GET' && url.pathname==='/api/pmo/approvals') return json(res,200,{approvals:store.listApprovals({status:url.searchParams.get('status')||null})});

    let match=url.pathname.match(/^\/api\/pmo\/approvals\/([^/]+)\/decision$/);
    if(req.method==='POST' && match){
      const input=await body(req);
      return json(res,200,{approval:store.decideApproval(decodeURIComponent(match[1]),input.decision,{actor:input.actor||'api',note:input.note})});
    }

    match=url.pathname.match(/^\/api\/pmo\/projects\/([^/]+)$/);
    if(req.method==='GET' && match){
      const project=store.getProject(decodeURIComponent(match[1]));
      return project?json(res,200,{project}):json(res,404,{ok:false,error:'project_not_found'});
    }

    match=url.pathname.match(/^\/api\/pmo\/projects\/([^/]+)\/transition$/);
    if(req.method==='POST' && match){
      const input=await body(req);
      return json(res,200,{project:pmo.transitionProject(decodeURIComponent(match[1]),String(input.toStage||'').toUpperCase(),{actor:input.actor||'api',reason:input.reason})});
    }

    match=url.pathname.match(/^\/api\/pmo\/projects\/([^/]+)\/risks$/);
    if(req.method==='POST' && match) return json(res,201,{risk:store.addRisk(decodeURIComponent(match[1]),await body(req),{actor:'api'})});

    match=url.pathname.match(/^\/api\/pmo\/projects\/([^/]+)\/approvals$/);
    if(req.method==='POST' && match) return json(res,201,{approval:store.requestApproval(decodeURIComponent(match[1]),await body(req),{actor:'api'})});

    match=url.pathname.match(/^\/api\/pmo\/projects\/([^/]+)\/tasks\/([^/]+)$/);
    if(req.method==='POST' && match) return json(res,200,{task:store.updateTask(decodeURIComponent(match[1]),decodeURIComponent(match[2]),await body(req),{actor:'api'})});

    match=url.pathname.match(/^\/api\/pmo\/projects\/([^/]+)\/whatsapp$/);
    if(req.method==='POST' && match) return json(res,200,await pmo.sendProjectWhatsApp(decodeURIComponent(match[1]),await body(req),{actor:'api'}));

    match=url.pathname.match(/^\/api\/pmo\/projects\/([^/]+)\/ai-plan$/);
    if(req.method==='POST' && match) return json(res,200,{plan:await pmo.generateAiPlan(decodeURIComponent(match[1]),await body(req))});

    return json(res,404,{ok:false,error:'not_found'});
  }catch(e){
    console.error('[PMO]',e);
    return json(res,errorStatus(e),{ok:false,error:e?.code||'PMO_ERROR',message:e?.message||'Unexpected error',gate:e?.gate||undefined});
  }
});

server.listen(PORT,'0.0.0.0',()=>console.log('[PMO] Contractor AI PMO listening on :'+PORT));
process.on('SIGTERM',()=>{store.close();server.close(()=>process.exit(0));});
process.on('SIGINT',()=>{store.close();server.close(()=>process.exit(0));});
