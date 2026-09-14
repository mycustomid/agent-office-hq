import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { ContractorPmoStore } from '../pmo/project_store.mjs';
import { ContractorPmoService } from '../pmo/service.mjs';
import { WhatsAppGatewayClient } from '../integrations/whatsapp_gateway.mjs';

function tempStore(){ const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pmo-')); return new ContractorPmoStore({dbPath:path.join(dir,'pmo.db')}); }

test('contractor lifecycle seeds operational checklist and enforces DP gate',()=>{
  const store=tempStore();
  const p=store.createProject({title:'Kitchen Set BSD',customerName:'Ibu A',customerPhone:'08123456789',projectType:'KITCHEN_SET'});
  assert.ok(p.tasks.length>=10);
  let current=p;
  for(const stage of ['DISCOVERY','SITE_SURVEY','DESIGN_SCOPE','ESTIMATION','QUOTATION','CUSTOMER_APPROVAL']) current=store.transitionProject(current.id,stage);
  const approval=current.approvals.find(a=>a.approval_type==='CUSTOMER_SCOPE_APPROVED');
  assert.ok(approval);
  assert.throws(()=>store.transitionProject(current.id,'DP_PAYMENT'),e=>e.code==='APPROVAL_GATE_BLOCKED');
  store.decideApproval(approval.id,'APPROVED');
  current=store.transitionProject(current.id,'DP_PAYMENT');
  assert.equal(current.stage,'DP_PAYMENT');
  store.close();
});

test('WhatsApp parser normalizes Indonesian sender and ignores groups',()=>{
  const wa=new WhatsAppGatewayClient({baseUrl:'https://example.test',tenantKey:'tenant',webhookSecret:'secret',fetchImpl:async()=>{throw new Error('unused');}});
  assert.equal(wa.extractInboundMessage({from:'08123456789@s.whatsapp.net',text:'Mau kitchen set',pushName:'Budi'}).phone,'628123456789');
  assert.equal(wa.extractInboundMessage({from:'120363@g.us',text:'group'}).phone,'');
  assert.equal(wa.verifyWebhookSecret('secret'),true);
});

test('new WhatsApp sender becomes INQUIRY project',()=>{
  const store=tempStore();
  const wa=new WhatsAppGatewayClient({baseUrl:'https://example.test',tenantKey:'tenant',webhookSecret:'secret'});
  const service=new ContractorPmoService({store,whatsapp:wa});
  const result=service.receiveWhatsApp({from:'081111111111@s.whatsapp.net',text:'Mau bikin lemari custom',pushName:'Pak B'});
  assert.equal(result.projectCreated,true);
  assert.equal(result.project.stage,'INQUIRY');
  assert.equal(result.project.source,'WHATSAPP');
  assert.equal(result.project.communications.length,1);
  store.close();
});
