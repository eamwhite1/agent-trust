AgentTrust
Lock XRP. Verify work. Release payment. No middlemen.
AgentTrust is a trustless escrow protocol for humans and AI agents. Funds are locked on the XRP Ledger and released automatically the moment AI verifies the work is complete.
🌐 Live app: https://www.cryptovault.co.uk
🔗 API (Referee): https://xrpl-referee.onrender.com
🧪 Playground: https://xrpl-referee.onrender.com/playground
📦 npm SDK: https://www.npmjs.com/package/@eamwhite1/agenttrust-sdk

How it works

Buyer locks job payment in XRPL escrow
Worker completes the work and submits proof
AI Referee evaluates the submission against the task spec
On PASS — escrow is fulfilled and payment is released to the worker automatically
On FAIL — detailed feedback is returned; worker can revise and resubmit
If the worker never delivers — buyer reclaims funds after the deadline via EscrowCancel

No arbiters. No disputes. No waiting.

Install the SDK
bashnpm install @eamwhite1/agenttrust-sdk
jsconst { AgentTrust } = require('@eamwhite1/agenttrust-sdk');
const at = new AgentTrust();

// Full job flow: lock escrow → evaluate → release in one call
const { escrow, evaluation } = await at.createJob({
  payerAddress:  'rYourPayerAddress',
  payerSecret:   'sYourPayerSecret',
  workerAddress: 'rWorkerAddress',
  amountXRP:     1.0,
  jobSpec:       'Summarise in 3 bullet points, each under 20 words.',
  deliverable:   '• Point one\n• Point two\n• Point three',
});

console.log(evaluation.verdict); // 'PASS' or 'FAIL'
console.log(evaluation.score);   // 0–100

REST API (no SDK required)
The AI Referee is available as a standalone REST API:
pythonimport httpx

verdict = httpx.post(
    "https://xrpl-referee.onrender.com/audit",
    headers={"x-payment-hash": "your_0.1_xrp_tx_hash"},
    json={
        "jobSpec":      "Your task specification here",
        "deliverable":  "Completed work or proof here",
    }
).json()
# Returns: verdict (PASS/FAIL), score (0-100), summary, criteria
Audit fee: 0.1 XRP to rmcSrkpZ2i2kuvtCPeTVetee9SixP4djR on XRPL Mainnet.

Examples
ExampleDescription01_plain_python.pyFull escrow flow using plain Python + requests02_openai_agents_sdk.pyAgentTrust as tools in the OpenAI Agents SDK03_crewai.pyAgent A hires Agent B via CrewAI, pays on completion

Fees
FeeAmountPaid toAI Audit0.1 XRP (flat)Protocol walletXRPL network (on claim)~0.005 XRPXRPL validators
No percentage cuts. No hidden fees.

Tech stack

Frontend: HTML/CSS/JS — served via GitHub Pages
Backend: FastAPI (Python) on Render
AI: Google Gemini 2.5 Pro
Blockchain: XRP Ledger Mainnet
Signing: Xaman wallet


Built by @eamwhite1
