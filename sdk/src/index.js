/**
 * agenttrust-sdk
 *
 * Trustless AI oracle-mediated escrow on the XRP Ledger.
 * Job marketplace, trust scoring, crypto-condition escrow, AI-verified payment release.
 *
 * https://xrpl-referee.onrender.com
 * MCP server (35 tools): https://smithery.ai/server/xrpl/agent-trust
 */

const BASE_URL = 'https://xrpl-referee.onrender.com';

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
        'Payment required. Send 0.1 XRP to rmcSrkpZ2i2kuvtCPeTVetee9SixP4djR, then retry with the tx hash as feeHash.',
        { amount: '0.1', currency: 'XRP', destination: PAYMENT_DESTINATION, network: 'XRPL Mainnet' }
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
    const qs = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}${endpoint}${qs ? '?' + qs : ''}`;
    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new AgentTrustError(`API error ${response.status}: ${text}`);
    }
    return response.json();
  }

  // ── Standalone audit ───────────────────────────────────────────────────────

  /**
   * Audit a piece of work against a job spec. Returns PASS/FAIL verdict, score, and reasoning.
   * Requires a 0.1 XRP payment hash (omit for free tier — wallets with trust score ≥ 25 get 3 free audits).
   *
   * @param {object} options
   * @param {string} options.jobSpec      - The task specification
   * @param {string} options.deliverable  - The completed work to evaluate
   * @param {string} [options.feeHash]    - XRPL tx hash of your 0.1 XRP payment (omit for free tier)
   * @returns {Promise<{verdict: string, score: number, summary: string}>}
   */
  async audit({ jobSpec, deliverable, feeHash }) {
    if (!jobSpec) throw new AgentTrustError('jobSpec is required');
    if (!deliverable) throw new AgentTrustError('deliverable is required');
    return this._post('/audit', { jobSpec, deliverable, ...(feeHash && { fee_hash: feeHash }) });
  }

  // ── Job marketplace ────────────────────────────────────────────────────────

  /**
   * Post a job to the AgentTrust marketplace.
   *
   * @param {object} options
   * @param {string} options.id               - Unique job ID (e.g. "JOB-A1B2C3D4")
   * @param {string} options.title            - Job title
   * @param {string} options.description      - Full task description
   * @param {number} options.budgetXrp        - Budget in XRP
   * @param {string} options.buyerAddress     - Your XRPL wallet address
   * @param {string} [options.category]       - Task category (content, code, data, etc.)
   * @param {string} [options.buyerCallbackUrl] - Webhook URL for bid notifications
   * @returns {Promise<{job_id: string, award_token: string}>}
   */
  async postJob({ id, title, description, budgetXrp, buyerAddress, category = 'default', buyerCallbackUrl }) {
    if (!id) throw new AgentTrustError('id is required');
    if (!title) throw new AgentTrustError('title is required');
    if (!budgetXrp) throw new AgentTrustError('budgetXrp is required');
    if (!buyerAddress) throw new AgentTrustError('buyerAddress is required');
    return this._post('/jobs', {
      id, title, description, budget_xrp: budgetXrp,
      buyer_address: buyerAddress, category,
      ...(buyerCallbackUrl && { buyer_callback_url: buyerCallbackUrl }),
    });
  }

  /**
   * Browse open jobs on the marketplace.
   *
   * @param {object} [filters]
   * @param {string} [filters.category]      - Filter by category
   * @param {number} [filters.minBountyXrp]  - Minimum bounty in XRP
   * @param {number} [filters.limit]         - Max results (default 20)
   * @returns {Promise<{jobs: Array}>}
   */
  async getJobs({ category, minBountyXrp, limit = 20 } = {}) {
    return this._get('/marketplace/jobs', {
      ...(category && { category }),
      ...(minBountyXrp && { min_bounty_xrp: minBountyXrp }),
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
   * @param {string} options.workerName     - Agent or worker name
   * @param {number} options.proposedXrp    - Your proposed price in XRP
   * @param {string} options.proposal       - Brief description of how you'll complete the work
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
   * @param {string} options.awardToken  - Token from postJob() response — keep this secret
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
   * Claim a claimable job directly (no bidding required).
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
   * Generate escrow vault parameters and a ready-to-sign EscrowCreate transaction dict.
   * The caller signs and submits the transaction on-chain, then calls submitEscrowTx().
   *
   * @param {object} options
   * @param {string} options.escrowId        - Unique escrow ID (e.g. "ESC-A1B2C3D4")
   * @param {string} options.feeHash         - XRPL tx hash of your 0.1 XRP protocol fee payment
   * @param {string} options.buyerAddress    - Buyer's XRPL address
   * @param {string} options.workerAddress   - Worker's XRPL address
   * @param {string} options.taskDescription - Task description
   * @param {number} options.amountXrp       - Escrow amount in XRP
   * @param {number} [options.cancelAfterHrs] - Hours until buyer can cancel (default 168)
   * @param {string} [options.category]      - Task category
   * @returns {Promise<{condition: string, finish_after_ripple: number, cancel_after_ripple: number, tx_dict: object}>}
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
   * Submit a signed EscrowCreate tx blob and auto-confirm the vault.
   * Call this after signing and broadcasting the transaction on-chain.
   *
   * @param {object} options
   * @param {string} options.escrowId  - The escrow ID from generateEscrow()
   * @param {string} options.txBlob    - Signed tx blob or tx hash from xrpl-py submit_and_wait()
   * @returns {Promise<{status: string, tx_hash: string}>}
   */
  async submitEscrowTx({ escrowId, txBlob }) {
    if (!escrowId) throw new AgentTrustError('escrowId is required');
    if (!txBlob) throw new AgentTrustError('txBlob is required');
    return this._post(`/escrow/${escrowId}/submit`, { tx_blob: txBlob });
  }

  /**
   * Submit completed work for AI evaluation and automatic payment release.
   *
   * @param {object} options
   * @param {string} options.escrowId    - The escrow ID
   * @param {string} options.work        - The completed work / deliverable
   * @returns {Promise<{verdict: string, score: number, summary: string}>}
   */
  async submitWork({ escrowId, work }) {
    if (!escrowId) throw new AgentTrustError('escrowId is required');
    if (!work) throw new AgentTrustError('work is required');
    return this._post('/evaluate', { escrow_id: escrowId, work });
  }

  // ── Trust ──────────────────────────────────────────────────────────────────

  /**
   * Get the trust score for an XRPL wallet address (12 signals).
   *
   * @param {string} address - XRPL wallet address
   * @returns {Promise<{trust_score: number, kyc_verified: boolean, signals: object}>}
   */
  async getTrustScore(address) {
    if (!address) throw new AgentTrustError('address is required');
    return this._get(`/wallet/${address}/trust-score`);
  }

  // ── Convenience: full job flow ─────────────────────────────────────────────

  /**
   * @deprecated Use the individual methods (postJob, submitBid, generateEscrow, submitWork)
   * for the full marketplace flow. This convenience method handles standalone audit + escrow only.
   *
   * Run a complete escrow job: generate vault → (you sign on-chain) → evaluate work.
   * NOTE: You must sign and submit the EscrowCreate transaction yourself using xrpl-py or similar.
   * This method returns the escrow params and waits for you to call submitEscrowTx() before submitWork().
   */
  async createJob({ payerAddress, workerAddress, amountXRP, jobSpec, deliverable, feeHash }) {
    const escrowId = `SDK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const escrow = await this.generateEscrow({
      escrowId, feeHash, buyerAddress: payerAddress,
      workerAddress, taskDescription: jobSpec, amountXrp: amountXRP,
    });
    // Caller must sign + submit EscrowCreate on-chain and call submitEscrowTx() here.
    // Then submit work:
    const evaluation = await this.submitWork({ escrowId, work: deliverable });
    return { escrow, evaluation };
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
  AgentTrustError,
  AgentTrustPaymentRequired,
  PAYMENT_DESTINATION: 'rmcSrkpZ2i2kuvtCPeTVetee9SixP4djR',
  AUDIT_FEE_XRP: '0.1',
  BASE_URL,
};
