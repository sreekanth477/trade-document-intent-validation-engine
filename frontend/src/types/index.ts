export type DocumentType = 'lc' | 'invoice' | 'bl' | 'insurance' | 'other';
export type DocumentStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type PresentationStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type Severity = 'critical' | 'moderate' | 'informational';
export type FindingStatus = 'open' | 'accepted' | 'overridden' | 'escalated';
export type UserRole = 'checker' | 'supervisor' | 'compliance' | 'admin';

export interface VerbatimQuote {
  document: DocumentType;
  field: string;
  text: string;
}

export interface Finding {
  id: string;
  presentationId: string;
  findingType: string;
  severity: Severity;
  title: string;
  description: string;
  affectedDocuments: DocumentType[];
  affectedFields: string[];
  verbatimQuotes: VerbatimQuote[];
  reasoning: string;
  confidenceScore: number;
  ucpArticles: string[];
  recommendedAction: string;
  status: FindingStatus;
  createdAt: string;
}

export interface Document {
  id: string;
  presentationId: string;
  documentType: DocumentType;
  filename: string;
  originalName: string;
  ocrConfidence: number;
  extractionStatus: DocumentStatus;
  extractedData: Record<string, unknown>;
  createdAt: string;
}

export interface LCPresentation {
  id: string;
  lcNumber: string;
  clientName: string;
  applicant: string;
  beneficiary: string;
  status: PresentationStatus;
  overallRiskScore: number;
  stpCandidate: boolean;
  documents: Document[];
  findings: Finding[];
  createdAt: string;
  updatedAt: string;
}

export interface Override {
  id: string;
  findingId: string;
  userId: string;
  userName: string;
  action: 'accept' | 'override' | 'escalate';
  overrideReason: string;
  justification: string;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  presentationId: string;
  eventType: string;
  eventData: Record<string, unknown>;
  userId: string;
  userName: string;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
}

export interface RiskSummary {
  overallScore: number;
  stpCandidate: boolean;
  riskSummary: string;
  criticalCount: number;
  moderateCount: number;
  informationalCount: number;
}

export interface OverrideData {
  action: 'accept' | 'override' | 'escalate';
  overrideReason: string;
  justification: string;
}

export interface QueueStats {
  totalPresentations: number;
  criticalCount: number;
  stpCandidates: number;
  avgExaminationTimeMinutes: number;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface PresentationsResponse {
  presentations: LCPresentation[];
  total: number;
  page: number;
  pageSize: number;
}
