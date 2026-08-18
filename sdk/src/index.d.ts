export interface AuditOptions {
  jobSpec: string;
  deliverable: string;
  feeHash?: string;
}

export interface AuditResult {
  verdict: 'PASS' | 'FAIL';
  score: number;
  summary: string;
  criteria?: Record<string, string>;
}

export interface PostJobOptions {
  id: string;
  title: string;
  description?: string;
  budgetXrp: number;
  buyerAddress: string;
  category?: string;
  buyerCallbackUrl?: string;
}

export interface GetJobsOptions {
  category?: string;
  minBountyXrp?: number;
  limit?: number;
}

export interface SubmitBidOptions {
  jobId: string;
  workerAddress: string;
  workerName?: string;
  proposedXrp: number;
  proposal?: string;
  callbackUrl?: string;
}

export interface AwardBidOptions {
  jobId: string;
  awardToken: string;
  bidId: string;
}

export interface ClaimJobOptions {
  jobId: string;
  workerAddress: string;
}

export interface GenerateEscrowOptions {
  escrowId: string;
  feeHash: string;
  buyerAddress: string;
  workerAddress: string;
  taskDescription?: string;
  amountXrp: number;
  cancelAfterHrs?: number;
  category?: string;
  buyerName?: string;
}

export interface EscrowResult {
  condition: string;
  finish_after_ripple: number;
  cancel_after_ripple: number;
  tx_dict?: Record<string, unknown>;
}

export interface SubmitEscrowTxOptions {
  escrowId: string;
  txBlob: string;
}

export interface SubmitWorkOptions {
  escrowId: string;
  work: string;
}

export interface TrustScore {
  trust_score: number;
  kyc_verified: boolean;
  signals: Record<string, unknown>;
}

export interface PaymentDetails {
  amount: string;
  currency: string;
  destination: string;
  network: string;
}

export declare class AgentTrustError extends Error {
  name: 'AgentTrustError';
}

export declare class AgentTrustPaymentRequired extends AgentTrustError {
  name: 'AgentTrustPaymentRequired';
  paymentDetails: PaymentDetails;
}

export declare class AgentTrust {
  constructor(options?: { baseUrl?: string });

  audit(options: AuditOptions): Promise<AuditResult>;
  postJob(options: PostJobOptions): Promise<{ job_id: string; award_token: string }>;
  getJobs(filters?: GetJobsOptions): Promise<{ jobs: unknown[] }>;
  getJob(jobId: string): Promise<unknown>;
  submitBid(options: SubmitBidOptions): Promise<{ bid_id: string; chat_token: string }>;
  awardBid(options: AwardBidOptions): Promise<unknown>;
  claimJob(options: ClaimJobOptions): Promise<unknown>;
  generateEscrow(options: GenerateEscrowOptions): Promise<EscrowResult>;
  submitEscrowTx(options: SubmitEscrowTxOptions): Promise<{ status: string; tx_hash: string }>;
  submitWork(options: SubmitWorkOptions): Promise<AuditResult>;
  getTrustScore(address: string): Promise<TrustScore>;
}

export declare const PAYMENT_DESTINATION: string;
export declare const AUDIT_FEE_XRP: string;
export declare const BASE_URL: string;
