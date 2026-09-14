import crypto from 'crypto';
import { normalizePhone } from '../pmo/workflow.mjs';

const first = (...v) => v.find(x => x !== undefined && x !== null && String(x).trim() !== '') ?? null;
function equal(a,b){ const x=Buffer.from(String(a||'')), y=Buffer.from(String(b||'')); return x.length===y.length && crypto.timingSafeEqual(x,y); }
function base(v){ try { const u=new URL(String(v||'').trim().replace(/\/+$/,'')); return ['http:','https:'].includes(u.protocol)?u.toString().replace(/\/+$/,''):''; } catch { return ''; } }

function sender(payload={}) {
  const m=payload.message||payload.data?.message||payload.messages?.[0]||{};
  const raw=first(payload.from,payload.sender,payload.phone,payload.phoneNumber,payload.number,payload.remoteJid,payload.data?.from,payload.data?.sender,payload.data?.phone,payload.data?.remoteJid,m.from,m.sender,m.phone,m.remoteJid,m.key?.remoteJid);
  if(!raw || String(raw).endsWith('@g.us')) return '';
  return normalizePhone(String(raw).replace(/@s\.whatsapp\.net$/i,'').replace(/@c\.us$/i,''));
}
function body(payload={}) {
  const m=payload.message||payload.data?.message||payload.messages?.[0]||{};
  return first(payload.text,payload.body,payload.messageText,payload.data?.text,payload.data?.body,m.text,m.body,m.conversation,m.extendedTextMessage?.text,m.message?.conversation,m.message?.extendedTextMessage?.text);
}

export class WhatsAppGatewayClient {
  constructor({
    baseUrl=process.env.WA_GATEWAY_BASE_URL,
    tenantKey=process.env.WA_GATEWAY_TENANT_KEY,
    apiToken=process.env.WA_GATEWAY_API_TOKEN,
    webhookSecret=process.env.WA_GATEWAY_WEBHOOK_SECRET,
    sendPath=process.env.WA_GATEWAY_SEND_PATH||'/api/v1/gateway/send-message',
    conversationPath=process.env.WA_GATEWAY_CONVERSATION_PATH||'/api/v1/gateway/conversation',
    recipientField=process.env.WA_GATEWAY_RECIPIENT_FIELD||'to',
    messageField=process.env.WA_GATEWAY_MESSAGE_FIELD||'message',
    timeoutMs=Number(process.env.WA_GATEWAY_TIMEOUT_MS||12000),
    fetchImpl=globalThis.fetch
  }={}) {
    this.baseUrl=base(baseUrl); this.tenantKey=String(tenantKey||'').trim(); this.apiToken=String(apiToken||'').trim();
    this.webhookSecret=String(webhookSecret||'').trim(); this.sendPath=sendPath; this.conversationPath=conversationPath;
    this.recipientField=recipientField; this.messageField=messageField; this.timeoutMs=timeoutMs; this.fetchImpl=fetchImpl;
  }
  getStatus(){ let host=null; try{host=this.baseUrl?new URL(this.baseUrl).host:null;}catch{} return {configured:Boolean(this.baseUrl&&this.tenantKey),webhookConfigured:Boolean(this.webhookSecret),host,sendPath:this.sendPath,conversationPath:this.conversationPath}; }
  verifyWebhookSecret(value){ return Boolean(this.webhookSecret) && equal(value,this.webhookSecret); }
  extractInboundMessage(payload={}) {
    const m=payload.message||payload.data?.message||payload.messages?.[0]||{};
    return {
      phone:sender(payload), text:String(body(payload)||'').trim(),
      externalId:first(payload.id,payload.messageId,payload.data?.id,payload.data?.messageId,m.id,m.key?.id),
      contactName:first(payload.pushName,payload.name,payload.contactName,payload.data?.pushName,payload.data?.name,m.pushName),
      raw:payload
    };
  }
  async request(pathname,{method='GET',body=null,query=null}={}) {
    if(!this.baseUrl||!this.tenantKey){ const e=new Error('WhatsApp gateway is not configured.'); e.code='WA_GATEWAY_NOT_CONFIGURED'; throw e; }
    const url=new URL(pathname,this.baseUrl+'/'); for(const [k,v] of Object.entries(query||{})) if(v!==null&&v!==undefined&&v!=='') url.searchParams.set(k,String(v));
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),this.timeoutMs); timer.unref?.();
    try{
      const headers={Accept:'application/json','X-Tenant-Key':this.tenantKey}; if(body!==null) headers['Content-Type']='application/json'; if(this.apiToken) headers.Authorization='Bearer '+this.apiToken;
      const res=await this.fetchImpl(url,{method,headers,body:body===null?undefined:JSON.stringify(body),signal:controller.signal});
      const text=await res.text(); let data={}; try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
      if(!res.ok){ const e=new Error('WhatsApp gateway HTTP '+res.status); e.code='WA_GATEWAY_HTTP_ERROR'; e.httpStatus=res.status; e.response=data; throw e; }
      return data;
    }catch(e){ if(e?.name==='AbortError'){ const x=new Error('WhatsApp gateway timeout.'); x.code='WA_GATEWAY_TIMEOUT'; throw x; } throw e; }
    finally{ clearTimeout(timer); }
  }
  async sendMessage({to,message,projectId=null,metadata=null}={}) {
    const phone=normalizePhone(to), text=String(message||'').trim(); if(!phone||!text) throw new Error('WhatsApp recipient and message are required.');
    const payload={[this.recipientField]:phone,[this.messageField]:text}; if(projectId||metadata) payload.metadata={...(metadata||{}),...(projectId?{projectId}:{})};
    const data=await this.request(this.sendPath,{method:'POST',body:payload});
    return {sent:true,to:phone,externalId:first(data?.id,data?.messageId,data?.data?.id,data?.data?.messageId),gateway:data};
  }
  async getConversation(contact,{limit=50}={}) { const phone=normalizePhone(contact); if(!phone) throw new Error('Conversation contact is required.'); return this.request(this.conversationPath,{query:{contact:phone,phone,limit}}); }
}
