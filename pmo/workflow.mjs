export const PROJECT_STAGES = Object.freeze({
  INQUIRY: 'INQUIRY',
  DISCOVERY: 'DISCOVERY',
  SITE_SURVEY: 'SITE_SURVEY',
  DESIGN_SCOPE: 'DESIGN_SCOPE',
  ESTIMATION: 'ESTIMATION',
  QUOTATION: 'QUOTATION',
  CUSTOMER_APPROVAL: 'CUSTOMER_APPROVAL',
  DP_PAYMENT: 'DP_PAYMENT',
  PROCUREMENT: 'PROCUREMENT',
  FABRICATION: 'FABRICATION',
  FINISHING_QC: 'FINISHING_QC',
  INSTALLATION: 'INSTALLATION',
  HANDOVER: 'HANDOVER',
  COMPLETED: 'COMPLETED',
  ON_HOLD: 'ON_HOLD',
  CANCELLED: 'CANCELLED'
});

export const STAGE_LABELS = Object.freeze({
  [PROJECT_STAGES.INQUIRY]: 'Inquiry / Lead',
  [PROJECT_STAGES.DISCOVERY]: 'Kualifikasi Kebutuhan',
  [PROJECT_STAGES.SITE_SURVEY]: 'Survey Lokasi',
  [PROJECT_STAGES.DESIGN_SCOPE]: 'Design & Scope Lock',
  [PROJECT_STAGES.ESTIMATION]: 'BOQ / RAB',
  [PROJECT_STAGES.QUOTATION]: 'Quotation',
  [PROJECT_STAGES.CUSTOMER_APPROVAL]: 'Approval Customer',
  [PROJECT_STAGES.DP_PAYMENT]: 'DP Terverifikasi',
  [PROJECT_STAGES.PROCUREMENT]: 'Procurement Bahan',
  [PROJECT_STAGES.FABRICATION]: 'Produksi / Fabrikasi',
  [PROJECT_STAGES.FINISHING_QC]: 'Finishing & QC',
  [PROJECT_STAGES.INSTALLATION]: 'Delivery & Instalasi',
  [PROJECT_STAGES.HANDOVER]: 'Punch List & BAST',
  [PROJECT_STAGES.COMPLETED]: 'Selesai',
  [PROJECT_STAGES.ON_HOLD]: 'On Hold',
  [PROJECT_STAGES.CANCELLED]: 'Batal'
});

export const PROJECT_TYPES = Object.freeze([
  'KITCHEN_SET',
  'WARDROBE',
  'CUSTOM_FURNITURE',
  'INTERIOR_FITOUT',
  'WOOD_PANEL',
  'DOOR_WINDOW',
  'RETAIL_FIXTURE',
  'OTHER'
]);

export const APPROVAL_TYPES = Object.freeze({
  CUSTOMER_SCOPE_APPROVED: 'CUSTOMER_SCOPE_APPROVED',
  DP_VERIFIED: 'DP_VERIFIED',
  MATERIAL_RELEASED: 'MATERIAL_RELEASED',
  QC_RELEASE: 'QC_RELEASE',
  HANDOVER_SIGNED: 'HANDOVER_SIGNED',
  FINAL_PAYMENT_VERIFIED: 'FINAL_PAYMENT_VERIFIED'
});

export const ACTIVE_STAGES = Object.freeze([
  PROJECT_STAGES.INQUIRY,
  PROJECT_STAGES.DISCOVERY,
  PROJECT_STAGES.SITE_SURVEY,
  PROJECT_STAGES.DESIGN_SCOPE,
  PROJECT_STAGES.ESTIMATION,
  PROJECT_STAGES.QUOTATION,
  PROJECT_STAGES.CUSTOMER_APPROVAL,
  PROJECT_STAGES.DP_PAYMENT,
  PROJECT_STAGES.PROCUREMENT,
  PROJECT_STAGES.FABRICATION,
  PROJECT_STAGES.FINISHING_QC,
  PROJECT_STAGES.INSTALLATION,
  PROJECT_STAGES.HANDOVER
]);

const NORMAL_FLOW = [
  PROJECT_STAGES.INQUIRY,
  PROJECT_STAGES.DISCOVERY,
  PROJECT_STAGES.SITE_SURVEY,
  PROJECT_STAGES.DESIGN_SCOPE,
  PROJECT_STAGES.ESTIMATION,
  PROJECT_STAGES.QUOTATION,
  PROJECT_STAGES.CUSTOMER_APPROVAL,
  PROJECT_STAGES.DP_PAYMENT,
  PROJECT_STAGES.PROCUREMENT,
  PROJECT_STAGES.FABRICATION,
  PROJECT_STAGES.FINISHING_QC,
  PROJECT_STAGES.INSTALLATION,
  PROJECT_STAGES.HANDOVER,
  PROJECT_STAGES.COMPLETED
];

const flowTransitions = {};
for (let i = 0; i < NORMAL_FLOW.length - 1; i += 1) {
  flowTransitions[NORMAL_FLOW[i]] = [NORMAL_FLOW[i + 1], PROJECT_STAGES.ON_HOLD, PROJECT_STAGES.CANCELLED];
}
flowTransitions[PROJECT_STAGES.COMPLETED] = [];
flowTransitions[PROJECT_STAGES.CANCELLED] = [];
flowTransitions[PROJECT_STAGES.ON_HOLD] = ACTIVE_STAGES;

export const ALLOWED_TRANSITIONS = Object.freeze(flowTransitions);

export const TRANSITION_GATES = Object.freeze({
  [`${PROJECT_STAGES.CUSTOMER_APPROVAL}->${PROJECT_STAGES.DP_PAYMENT}`]: [APPROVAL_TYPES.CUSTOMER_SCOPE_APPROVED],
  [`${PROJECT_STAGES.DP_PAYMENT}->${PROJECT_STAGES.PROCUREMENT}`]: [APPROVAL_TYPES.DP_VERIFIED],
  [`${PROJECT_STAGES.PROCUREMENT}->${PROJECT_STAGES.FABRICATION}`]: [APPROVAL_TYPES.MATERIAL_RELEASED],
  [`${PROJECT_STAGES.FINISHING_QC}->${PROJECT_STAGES.INSTALLATION}`]: [APPROVAL_TYPES.QC_RELEASE],
  [`${PROJECT_STAGES.HANDOVER}->${PROJECT_STAGES.COMPLETED}`]: [APPROVAL_TYPES.HANDOVER_SIGNED, APPROVAL_TYPES.FINAL_PAYMENT_VERIFIED]
});

export const STAGE_AUTO_APPROVAL_REQUESTS = Object.freeze({
  [PROJECT_STAGES.CUSTOMER_APPROVAL]: [APPROVAL_TYPES.CUSTOMER_SCOPE_APPROVED],
  [PROJECT_STAGES.DP_PAYMENT]: [APPROVAL_TYPES.DP_VERIFIED],
  [PROJECT_STAGES.PROCUREMENT]: [APPROVAL_TYPES.MATERIAL_RELEASED],
  [PROJECT_STAGES.FINISHING_QC]: [APPROVAL_TYPES.QC_RELEASE],
  [PROJECT_STAGES.HANDOVER]: [APPROVAL_TYPES.HANDOVER_SIGNED, APPROVAL_TYPES.FINAL_PAYMENT_VERIFIED]
});

export const DEFAULT_PROJECT_CHECKLIST = Object.freeze([
  { stage: PROJECT_STAGES.DISCOVERY, category: 'COMMERCIAL', title: 'Kualifikasi kebutuhan, budget range, timeline, dan decision maker' },
  { stage: PROJECT_STAGES.SITE_SURVEY, category: 'SURVEY', title: 'Jadwalkan survey lokasi dan PIC lapangan' },
  { stage: PROJECT_STAGES.SITE_SURVEY, category: 'SURVEY', title: 'Ukur dimensi existing, level, akses loading, listrik, dan hambatan instalasi' },
  { stage: PROJECT_STAGES.DESIGN_SCOPE, category: 'DESIGN', title: 'Finalisasi shop drawing, material, hardware, finishing, dan scope exclusion' },
  { stage: PROJECT_STAGES.ESTIMATION, category: 'COSTING', title: 'Susun BOQ/RAB: panel kayu, hardware, finishing, consumable, tenaga, delivery, instalasi' },
  { stage: PROJECT_STAGES.QUOTATION, category: 'COMMERCIAL', title: 'Kirim quotation, scope, timeline, payment term, dan masa berlaku penawaran' },
  { stage: PROJECT_STAGES.CUSTOMER_APPROVAL, category: 'APPROVAL', title: 'Kunci approval customer atas desain, scope, harga, dan timeline' },
  { stage: PROJECT_STAGES.DP_PAYMENT, category: 'FINANCE', title: 'Verifikasi DP sebelum purchase order material' },
  { stage: PROJECT_STAGES.PROCUREMENT, category: 'PROCUREMENT', title: 'Lock species/grade, plywood/MDF, veneer/HPL, hardware, finishing, dan supplier' },
  { stage: PROJECT_STAGES.PROCUREMENT, category: 'PROCUREMENT', title: 'Pastikan material datang lengkap dan lolos incoming QC' },
  { stage: PROJECT_STAGES.FABRICATION, category: 'PRODUCTION', title: 'Cutting/CNC/joinery/assembly sesuai shop drawing' },
  { stage: PROJECT_STAGES.FINISHING_QC, category: 'QC', title: 'QC dimensi, alignment, surface, warna, hardware, dan fungsi' },
  { stage: PROJECT_STAGES.INSTALLATION, category: 'SITE', title: 'Konfirmasi site readiness, delivery plan, manpower, dan jadwal instalasi' },
  { stage: PROJECT_STAGES.INSTALLATION, category: 'SITE', title: 'Instalasi, protection, housekeeping, dan dokumentasi progress' },
  { stage: PROJECT_STAGES.HANDOVER, category: 'CLOSEOUT', title: 'Punch list, BAST, garansi, final documentation, dan pelunasan' }
]);

export function getNextStage(stage) {
  const index = NORMAL_FLOW.indexOf(stage);
  if (index < 0 || index >= NORMAL_FLOW.length - 1) return null;
  return NORMAL_FLOW[index + 1];
}

export function requiredApprovalsForTransition(fromStage, toStage) {
  return TRANSITION_GATES[`${fromStage}->${toStage}`] || [];
}

export function canTransition(fromStage, toStage) {
  const allowed = ALLOWED_TRANSITIONS[fromStage] || [];
  return allowed.includes(toStage);
}

export function normalizePhone(value = '') {
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}
