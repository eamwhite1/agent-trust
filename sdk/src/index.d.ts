export interface AuditOptions {
  jobSpec: string;
  deliverable: string;
  feeHash?: string;
}

export interface AuditResult {
  verdict: 'PASS' | 'FAIL';
  score: number;
  summary: string;
  criteria_met?: string[];
  criteria_failed?: string[];
}

export interface AssessOptions {
  workerAddress: string;
  jobType?: string;
  amountXrp: number;
}

export interface AssessResult {
  proceed: boolean;
  reason: string;
  trust_score: number;
  sanctions_clear: boolean;
  kyc_verified: boolean;
  escrow_cap_usd: number;
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

export interface HireAndPayOptions {
  task: string;
  buyerAddress: string;
  amountXrp: number;
  workerAddress: string;
  escrowId?: string;
  feeHash?: string;
  /** "testnet" skips escrowId/feeHash requirements and uses XRPL testnet */
  network?: 'testnet';
  delegateAddress?: string;
  cancelAfterHrs?: number;
  callbackUrl?: string;
  metadata?: object | string;
}

export interface TestnetWalletResult {
  address: string;
  seed: string;
  balance_xrp: number;
  next_step: string;
}

export interface TestnetDemoOptions {
  task?: string;
  work?: string;
}

export interface TestnetDemoResult {
  escrow_id: string;
  evaluate_token: string;
  verdict: 'PASS' | 'FAIL' | 'UNKNOWN';
  score: number | null;
  summary: string;
  release_tx: string | null;
  next_call: string;
  escrow_tx: string;
  network: 'testnet';
}

export interface HireAndPayResult {
  tx_dict: Record<string, unknown>;
  escrow_id: string;
  evaluate_token: string;
}

/** @deprecated Use HireAndPayOptions */
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

export interface ConfirmEscrowOptions {
  escrowId: string;
  txHash: string;
}

export interface SubmitWorkOptions {
  escrowId: string;
  work: string;
  evaluateToken: string;
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

  getFees(): Promise<Record<string, unknown>>;
  assessCounterparty(options: AssessOptions): Promise<AssessResult>;

  audit(options: AuditOptions): Promise<AuditResult>;

  postJob(options: PostJobOptions): Promise<{ job_id: string; award_token: string }>;
  getJobs(filters?: GetJobsOptions): Promise<{ jobs: unknown[] }>;
  getJob(jobId: string): Promise<unknown>;
  submitBid(options: SubmitBidOptions): Promise<{ bid_id: string; chat_token: string }>;
  awardBid(options: AwardBidOptions): Promise<unknown>;
  claimJob(options: ClaimJobOptions): Promise<unknown>;

  hireAndPay(options: HireAndPayOptions): Promise<HireAndPayResult>;
  confirmEscrow(options: ConfirmEscrowOptions): Promise<{ status: string }>;
  submitWork(options: SubmitWorkOptions): Promise<AuditResult>;
  getEscrow(escrowId: string): Promise<unknown>;
  getBatchDvpPayload(escrowId: string): Promise<{ batch_tx: Record<string, unknown> }>;

  createTestnetWallet(): Promise<TestnetWalletResult>;
  tryTestnetDemo(options?: TestnetDemoOptions): Promise<TestnetDemoResult>;

  getTrustScore(address: string): Promise<TrustScore>;
  checkSanctions(address: string): Promise<{ sanctioned: boolean }>;
  checkKyc(address: string): Promise<{ kyc_verified: boolean; escrow_cap_usd: number }>;

  /** @deprecated Use hireAndPay() */
  generateEscrow(options: GenerateEscrowOptions): Promise<unknown>;
  /** @deprecated Use confirmEscrow() */
  submitEscrowTx(options: { escrowId: string; txBlob: string }): Promise<unknown>;
}

export interface PrivyWalletOptions {
  appId: string;
  appSecret: string;
}

export interface PrivyWalletResult {
  id: string;
  address: string;
  publicKey: string;
}

export declare class PrivyWallet {
  constructor(options: PrivyWalletOptions);
  createWallet(): Promise<PrivyWalletResult>;
  signTransaction(walletId: string, address: string, publicKey: string, tx: Record<string, unknown>): Promise<string>;
}

export declare const PAYMENT_DESTINATION: string;
export declare const BASE_URL: string;
