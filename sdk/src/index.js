/**
 * @eamwhite1/agenttrust-sdk
 *
 * Node.js SDK for AgentTrust — job marketplace, trust scoring,
 * XRPL crypto-condition escrow, and AI-verified payment release.
 *
 * https://www.cryptovault.co.uk
 * MCP server (40+ tools): https://mcp.cryptovault.co.uk/mcp/
 */

const BASE_URL = 'https://mcp.cryptovault.co.uk';
const PAYMENT_DESTINATION = 'rmcSrkpZ2i2kuvtCPeTVetee9SixP4djR';

class AgentTrust {
  /**
   * @param {object} [options]
   * @param {string} [options.baseUrl] - Override the API base URL (useful for testing)
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || BASE_URL;
  }

  /** @private */
  async _post(endpoint, body) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status === 402) {
      throw new AgentTrustPaymentRequired(
        'Payment required. Send $0.10 (XRP, RLUSD, or USDC) to rmcSrkpZ2i2kuvtCPeTVetee9SixP4djR on XRPL Mainnet, then retry with the tx hash as feeHash.',
        { amount: '0.10', currency: 'XRP', destination: PAYMENT_DESTINATION, network: 'XRPL Mainnet' }
      );
    }
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new AgentTrustError(`API error ${response.status}: ${text}`);
    }
    return response.json();
  }

  /** @private */
  async _get(endpoint, params = {}) {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null))
    ).toString();
    const url = `${this.baseUrl}${endpoint}${qs ? '?' + qs : ''}`;
    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new AgentTrustError(`API error ${response.status}: ${text}`);
    }
    return response.json();
  }

  // ── Fees (always call before paying — never hard-code amounts) ─────────────

  /**
   * Get the live fee schedule. Always call this before any paid operation.
   * Never hard-code XRP amounts — the price of XRP changes.
   *
   * @returns {Promise<object>} Live fee schedule with amounts and payment addresses
   */
  async getFees() {
    return this._get('/fees');
  }

  // ── Pre-flight check ───────────────────────────────────────────────────────

  /**
   * Pre-flight check before locking funds. Aggregates trust score, sanctions,
   * KYC, and escrow cap into a single go/no-go decision.
   * If proceed is false, do NOT call generateEscrow or hireAndPay.
   *
   * @param {object} options
   * @param {string} options.workerAddress - Worker's XRPL wallet address
   * @param {string} options.jobType       - Type of job (e.g. "content", "code", "data")
   * @param {number} options.amountXrp     - Escrow amount in XRP
   * @returns {Promise<{proceed: boolean, reason: string, trust_score: number}>}
   */
  async assessCounterparty({ workerAddress, jobType, amountXrp }) {
    if (!workerAddress) throw new AgentTrustError('workerAddress is required');
    if (!amountXrp) throw new AgentTrustError('amountXrp is required');
    return this._post('/assess', {
      worker_address: workerAddress,
      job_type: jobType,
      amount_xrp: amountXrp,
    });
  }

  // ── Standalone audit ───────────────────────────────────────────────────────

  /**
   * Audit a piece of work against a job spec without escrow.
   * Wallets with trust score ≥ 25 get 3 free audits — omit feeHash for those.
   *
   * @param {object} options
   * @param {string} options.jobSpec      - The task specification / rubric
   * @param {string} options.deliverable  - The completed work to evaluate
   * @param {string} [options.feeHash]    - XRPL/Base tx hash of $0.10 payment (omit for free tier)
   * @returns {Promise<{verdict: 'PASS'|'FAIL', score: number, summary: string, criteria_met: string[], criteria_failed: string[]}>}
   */
  async audit({ jobSpec, deliverable, feeHash }) {
    if (!jobSpec) throw new AgentTrustError('jobSpec is required');
    if (!deliverable) throw new AgentTrustError('deliverable is required');
    return this._post('/audit', {
      task_description: jobSpec,
      work: deliverable,
      ...(feeHash && { fee_hash: feeHash }),
    });
  }

  // ── Job marketplace ────────────────────────────────────────────────────────

  /**
   * Post a job to the AgentTrust marketplace.
   *
   * @param {object} options
   * @param {string} options.id                 - Unique job ID (e.g. "JOB-A1B2C3D4")
   * @param {string} options.title              - Job title
   * @param {string} options.description        - Full task description
   * @param {number} options.budgetXrp          - Budget in XRP
   * @param {string} options.buyerAddress       - Buyer's XRPL wallet address
   * @param {string} [options.category]         - Task category
   * @param {string} [options.buyerCallbackUrl] - Webhook URL for bid notifications
   * @returns {Promise<{job_id: string, award_token: string}>}
   */
  async postJob({ id, title, description, budgetXrp, buyerAddress, category = 'default', buyerCallbackUrl }) {
    if (!id) throw new AgentTrustError('id is required');
    if (!title) throw new AgentTrustError('title is required');
    if (!budgetXrp) throw new AgentTrustError('budgetXrp is required');
    if (!buyerAddress) throw new AgentTrustError('buyerAddress is required');
    return this._post('/jobs', {
      id, title, description,
      budget_xrp: budgetXrp,
      buyer_address: buyerAddress,
      category,
      ...(buyerCallbackUrl && { buyer_callback_url: buyerCallbackUrl }),
    });
  }

  /**
   * Browse open jobs on the marketplace.
   *
   * @param {object} [filters]
   * @param {string} [filters.category]     - Filter by category
   * @param {number} [filters.minBountyXrp] - Minimum bounty in XRP
   * @param {number} [filters.limit]        - Max results (default 20)
   * @returns {Promise<{jobs: Array}>}
   */
  async getJobs({ category, minBountyXrp, limit = 20 } = {}) {
    return this._get('/marketplace/jobs', {
      category,
      min_bounty_xrp: minBountyXrp,
      limit,
    });
  }

  /**
   * Get full details of a job including bids.
   *
   * @param {string} jobId
   * @returns {Promise<object>}
   */
  async getJob(jobId) {
    return this._get(`/jobs/${jobId}`);
  }

  /**
   * Submit a bid on a job.
   *
   * @param {object} options
   * @param {string} options.jobId          - Job ID to bid on
   * @param {string} options.workerAddress  - Your XRPL wallet address
   * @param {string} [options.workerName]   - Agent or worker name
   * @param {number} options.proposedXrp    - Your proposed price in XRP
   * @param {string} [options.proposal]     - Brief description of your approach
   * @param {string} [options.callbackUrl]  - Webhook URL for award notification
   * @returns {Promise<{bid_id: string, chat_token: string}>}
   */
  async submitBid({ jobId, workerAddress, workerName, proposedXrp, proposal, callbackUrl }) {
    if (!jobId) throw new AgentTrustError('jobId is required');
    if (!workerAddress) throw new AgentTrustError('workerAddress is required');
    if (!proposedXrp) throw new AgentTrustError('proposedXrp is required');
    return this._post(`/jobs/${jobId}/bid`, {
      worker_address: workerAddress,
      worker_name: workerName,
      proposed_xrp: proposedXrp,
      proposal,
      ...(callbackUrl && { callback_url: callbackUrl }),
    });
  }

  /**
   * Award a bid to a worker.
   *
   * @param {object} options
   * @param {string} options.jobId       - Job ID
   * @param {string} options.awardToken  - Token from postJob() — keep this secret
   * @param {string} options.bidId       - Bid ID to award
   * @returns {Promise<object>}
   */
  async awardBid({ jobId, awardToken, bidId }) {
    if (!jobId) throw new AgentTrustError('jobId is required');
    if (!awardToken) throw new AgentTrustError('awardToken is required');
    if (!bidId) throw new AgentTrustError('bidId is required');
    return this._post(`/jobs/${jobId}/award`, { award_token: awardToken, bid_id: bidId });
  }

  /**
   * Claim a claimable job directly (no bidding round).
   *
   * @param {object} options
   * @param {string} options.jobId          - Job ID to claim
   * @param {string} options.workerAddress  - Your XRPL wallet address
   * @returns {Promise<object>}
   */
  async claimJob({ jobId, workerAddress }) {
    if (!jobId) throw new AgentTrustError('jobId is required');
    if (!workerAddress) throw new AgentTrustError('workerAddress is required');
    return this._post(`/jobs/${jobId}/claim`, { worker_address: workerAddress });
  }

  // ── Escrow ─────────────────────────────────────────────────────────────────

  /**
   * One-call escrow: register the vault AND get a ready-to-sign EscrowCreate tx.
   * Sign and submit the returned tx_dict with xrpl-py or xrpl.js, then call confirmEscrow().
   *
   * XLS-75 delegation: pass delegateAddress to keep your buyer wallet cold.
   * The agent signs EscrowCreate on your behalf — your wallet stays the Account.
   * Requires a prior DelegateSet granting EscrowCreate permission to delegateAddress.
   * No spend caps apply.
   *
   * @param {object} options
   * @param {string} options.task              - Task description / rubric
   * @param {string} options.buyerAddress      - Buyer's XRPL wallet address
   * @param {number} options.amountXrp         - Escrow amount in XRP
   * @param {string} options.workerAddress     - Worker's XRPL wallet address
   * @param {string} options.escrowId          - Unique escrow ID (e.g. "ESC-A1B2C3D4")
   * @param {string} options.feeHash           - XRPL/Base tx hash of $0.10 protocol fee payment
   * @param {string} [options.delegateAddress] - XLS-75: hot agent address that signs on buyer's behalf
   * @param {number} [options.cancelAfterHrs]  - Hours until buyer can cancel (default 168)
   * @param {string} [options.callbackUrl]     - Webhook URL for vault state changes
   * @param {string} [options.metadata]        - JSON string of reference IDs echoed in webhooks
   * @returns {Promise<{tx_dict: object, escrow_id: string, evaluate_token: string}>}
   */
  async hireAndPay({ task, buyerAddress, amountXrp, workerAddress, escrowId, feeHash, delegateAddress, cancelAfterHrs = 168, callbackUrl, metadata }) {
    if (!task) throw new AgentTrustError('task is required');
    if (!buyerAddress) throw new AgentTrustError('buyerAddress is required');
    if (!amountXrp) throw new AgentTrustError('amountXrp is required');
    if (!workerAddress) throw new AgentTrustError('workerAddress is required');
    if (!escrowId) throw new AgentTrustError('escrowId is required');
    if (!feeHash) throw new AgentTrustError('feeHash is required');
    return this._post('/escrow/prepare', {
      task_description: task,
      buyer_address: buyerAddress,
      amount_xrp: amountXrp,
      worker_address: workerAddress,
      escrow_id: escrowId,
      fee_hash: feeHash,
      cancel_after_hrs: cancelAfterHrs,
      ...(delegateAddress && { delegate_address: delegateAddress }),
      ...(callbackUrl && { callback_url: callbackUrl }),
      ...(metadata && { metadata }),
    });
  }

  /**
   * @deprecated Use hireAndPay() instead — it registers the vault and returns the tx in one call.
   * Kept for backwards compatibility.
   */
  async generateEscrow({ escrowId, feeHash, buyerAddress, workerAddress, taskDescription, amountXrp, cancelAfterHrs = 168, category = 'default', buyerName }) {
    if (!escrowId) throw new AgentTrustError('escrowId is required');
    if (!feeHash) throw new AgentTrustError('feeHash is required');
    if (!buyerAddress) throw new AgentTrustError('buyerAddress is required');
    if (!workerAddress) throw new AgentTrustError('workerAddress is required');
    if (!amountXrp) throw new AgentTrustError('amountXrp is required');
    return this._post('/escrow/generate', {
      escrow_id: escrowId, fee_hash: feeHash,
      buyer_address: buyerAddress, buyer_name: buyerName,
      worker_address: workerAddress, task_description: taskDescription,
      amount_xrp: amountXrp, cancel_after_hrs: cancelAfterHrs, category,
    });
  }

  /**
   * Confirm an on-chain EscrowCreate transaction to activate the vault.
   * Call after signing and submitting the tx from hireAndPay().
   *
   * @param {object} options
   * @param {string} options.escrowId - The escrow ID
   * @param {string} options.txHash   - The on-chain EscrowCreate tx hash
   * @returns {Promise<{status: string}>}
   */
  async confirmEscrow({ escrowId, txHash }) {
    if (!escrowId) throw new AgentTrustError('escrowId is required');
    if (!txHash) throw new AgentTrustError('txHash is required');
    return this._post(`/escrow/${escrowId}/confirm`, { tx_hash: txHash });
  }

  /**
   * @deprecated Use confirmEscrow() instead.
   */
  async submitEscrowTx({ escrowId, txBlob }) {
    if (!escrowId) throw new AgentTrustError('escrowId is required');
    if (!txBlob) throw new AgentTrustError('txBlob is required');
    return this._post(`/escrow/${escrowId}/submit`, { tx_blob: txBlob });
  }

  /**
   * Submit completed work for AI evaluation and automatic payment release.
   * The buyer shares evaluate_token with the worker after creating the vault.
   * On PASS, payment releases automatically. On FAIL, read criteriaFailed and resubmit.
   *
   * @param {object} options
   * @param {string} options.escrowId      - The escrow ID
   * @param {string} options.work          - The completed work / deliverable
   * @param {string} options.evaluateToken - Token shared by the buyer at vault creation (required)
   * @returns {Promise<{verdict: 'PASS'|'FAIL', score: number, summary: string, criteria_met: string[], criteria_failed: string[]}>}
   */
  async submitWork({ escrowId, work, evaluateToken }) {
    if (!escrowId) throw new AgentTrustError('escrowId is required');
    if (!work) throw new AgentTrustError('work is required');
    if (!evaluateToken) throw new AgentTrustError('evaluateToken is required — the buyer must share this with you after creating the vault');
    return this._post('/evaluate', {
      escrow_id: escrowId,
      work,
      evaluate_token: evaluateToken,
    });
  }

  /**
   * Get the current status and details of an escrow vault.
   *
   * @param {string} escrowId
   * @returns {Promise<object>}
   */
  async getEscrow(escrowId) {
    if (!escrowId) throw new AgentTrustError('escrowId is required');
    return this._get(`/escrow/${escrowId}`);
  }

  /**
   * Get the pre-built XLS-56 Batch transaction for atomic NFT DvP settlement.
   * The vault must be in PASS_AWAITING_NFT state with the seller's NFTokenCreateOffer registered.
   * Sign the returned Batch tx once to atomically accept the NFT and release payment.
   *
   * @param {string} escrowId
   * @returns {Promise<{batch_tx: object}>}
   */
  async getBatchDvpPayload(escrowId) {
    if (!escrowId) throw new AgentTrustError('escrowId is required');
    return this._get(`/escrow/${escrowId}/batch-dvp-payload`);
  }

  // ── Trust & compliance ─────────────────────────────────────────────────────

  /**
   * Get the trust score for an XRPL wallet (11 signals).
   * Free to call — no fee required.
   *
   * @param {string} address - XRPL wallet address
   * @returns {Promise<{trust_score: number, kyc_verified: boolean, signals: object}>}
   */
  async getTrustScore(address) {
    if (!address) throw new AgentTrustError('address is required');
    return this._get(`/wallet/score/${address}`);
  }

  /**
   * Screen an XRPL wallet against the OFAC SDN sanctions list.
   *
   * @param {string} address - XRPL wallet address
   * @returns {Promise<{sanctioned: boolean}>}
   */
  async checkSanctions(address) {
    if (!address) throw new AgentTrustError('address is required');
    return this._get(`/wallet/sanctions/${address}`);
  }

  /**
   * Check KYC verification status for an XRPL wallet.
   * KYC-verified wallets unlock escrows up to $10,000.
   *
   * @param {string} address - XRPL wallet address
   * @returns {Promise<{kyc_verified: boolean, escrow_cap_usd: number}>}
   */
  async checkKyc(address) {
    if (!address) throw new AgentTrustError('address is required');
    return this._get(`/wallet/kyc/${address}`);
  }
}

// ── Privy XRPL Wallet ─────────────────────────────────────────────────────────

/**
 * Server-side XRPL wallet creation and signing via Privy.
 *
 * Privy issues an XRPL wallet (r-address) and signs transactions server-side —
 * no seed phrase stored in your code. Requires a Privy app with XRPL enabled.
 *
 * @example
 * const privy = new PrivyWallet({ appId: process.env.PRIVY_APP_ID, appSecret: process.env.PRIVY_APP_SECRET });
 * const wallet = await privy.createWallet();
 * // Fund wallet with 1 XRP (base reserve) before use
 * const signed = await privy.signTransaction(wallet.id, wallet.address, wallet.publicKey, txObject);
 * await xrplClient.submit(signed);
 */
class PrivyWallet {
  /**
   * @param {object} options
   * @param {string} options.appId     - Privy app ID
   * @param {string} options.appSecret - Privy app secret
   */
  constructor({ appId, appSecret } = {}) {
    if (!appId || !appSecret) throw new AgentTrustError('PrivyWallet requires appId and appSecret');
    this._appId = appId;
    this._appSecret = appSecret;
    this._base = 'https://api.privy.io/v1';
  }

  /** @private */
  async _req(method, path, body) {
    const creds = Buffer.from(`${this._appId}:${this._appSecret}`).toString('base64');
    const res = await fetch(`${this._base}${path}`, {
      method,
      headers: {
        'Authorization': `Basic ${creds}`,
        'privy-app-id': this._appId,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new AgentTrustError(`Privy API error ${res.status}: ${text}`);
    }
    return res.json();
  }

  /**
   * Create a new server-side XRPL wallet via Privy.
   * Fund the returned address with at least 1 XRP before submitting transactions.
   *
   * @returns {Promise<{id: string, address: string, publicKey: string}>}
   */
  async createWallet() {
    const data = await this._req('POST', '/wallets', { chain_type: 'xrpl' });
    return {
      id: data.id,
      address: data.address,
      publicKey: data.public_key,
    };
  }

  /**
   * Sign an XRPL transaction using a Privy wallet.
   * Builds the signing payload with xrpl.js encodeForSigning, sends to Privy,
   * and returns the signed transaction blob ready to submit.
   *
   * @param {string} walletId   - Privy wallet ID
   * @param {string} address    - XRPL r-address of the wallet
   * @param {string} publicKey  - 33-byte compressed secp256k1 pubkey (hex, no 0x)
   * @param {object} tx         - Unsigned XRPL transaction object (pre-autofilled)
   * @returns {Promise<string>} - Signed transaction blob (hex), ready for xrpl.submit()
   */
  async signTransaction(walletId, address, publicKey, tx) {
    // Import xrpl for encoding — only required when signing
    let encodeForSigning;
    try {
      ({ encodeForSigning } = require('xrpl'));
    } catch {
      throw new AgentTrustError(
        'xrpl package is required for transaction signing. Install it: npm install xrpl'
      );
    }
    const forSigning = { ...tx, Account: address, SigningPubKey: publicKey };
    const prefixedHex = encodeForSigning(forSigning);
    const { data } = await this._req('POST', `/wallets/${walletId}/rpc`, {
      method: 'xrpl_signTransaction',
      params: { transaction: prefixedHex, encoding: 'hex' },
    });
    return data.signed_transaction;
  }
}

// ── Error classes ──────────────────────────────────────────────────────────────

class AgentTrustError extends Error {
  constructor(message) { super(message); this.name = 'AgentTrustError'; }
}

class AgentTrustPaymentRequired extends AgentTrustError {
  constructor(message, paymentDetails) {
    super(message);
    this.name = 'AgentTrustPaymentRequired';
    this.paymentDetails = paymentDetails;
  }
}

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
  AgentTrust,
  PrivyWallet,
  AgentTrustError,
  AgentTrustPaymentRequired,
  PAYMENT_DESTINATION,
  BASE_URL,
};
