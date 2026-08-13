# Using AgentTrust with the XRPL AI Starter Kit

The [XRPL AI Starter Kit](https://github.com/ripple/xrpl-ai-starter-kit) gives you an XRPL wallet, an MCP server for ledger queries, and Claude-ready skills for payments. It gets an agent onto the ledger in minutes — but it doesn't answer the question that comes next: *how does one agent trust another, and how does payment release only when work is actually done?*

AgentTrust is the missing layer. It holds payment in XRPL crypto-condition escrow and releases it the moment an independent AI referee verifies the deliverable. No private keys leave your agent's hands; no human has to adjudicate disputes.

---

## What each project does

| | XRPL AI Starter Kit | AgentTrust |
|---|---|---|
| **Wallet setup** | ✅ Generates keypair, funds on testnet | — |
| **Send XRP** | ✅ Claude skill, MCP tool | — |
| **Look up ledger data** | ✅ XRPL Docs MCP server | — |
| **Lock payment until work is done** | — | ✅ EscrowCreate with crypto-condition |
| **Verify a deliverable with AI** | — | ✅ POST /audit (Gemini 2.5 Pro referee) |
| **Trust score for a counterparty** | — | ✅ GET /wallet/score (11 signals) |
| **Release or reclaim escrow** | — | ✅ EscrowFinish / EscrowCancel |
| **MCP tools for all of the above** | — | ✅ 19 tools, 2 prompts |

They compose: the starter kit gets your agent onto XRPL; AgentTrust adds the trust and payment-release logic on top.

---

## Quickstart

### 1. Check a counterparty before you hire them

Before locking any funds, score the worker wallet:

```python
import httpx

score = httpx.get(
    "https://xrpl-referee.onrender.com/wallet/score/rWorkerWalletAddress"
).json()

print(score["score"])          # 0–100
print(score["score_breakdown"]) # per-signal breakdown
print(score["signals"]["sanctions_clean"])  # False = stop immediately
```

11 signals: account age, balance, activity, XRPL domain verification, NFT history, payment completion rate, peer reputation, XRPL Attestation, OFAC sanctions screening, XRPScan entity reputation, and Xaman KYC (human-only).

### 2. Lock payment in escrow

```python
import httpx

escrow = httpx.post(
    "https://xrpl-referee.onrender.com/escrow/create",
    json={
        "payer_address":   "rPayerAddress",
        "payer_secret":    "sPayerSecret",   # stays local; signs tx client-side
        "worker_address":  "rWorkerAddress",
        "amount_xrp":      5.0,
        "deadline_hours":  48,
        "job_spec":        "Write a 200-word product description for...",
    }
).json()

escrow_id = escrow["escrow_id"]   # keep this; needed to release or reclaim
sequence   = escrow["sequence"]
```

Funds are now locked on XRPL Mainnet. Neither party can touch them until work is verified or the deadline passes.

### 3. Audit the deliverable

```python
# Pay the 0.1 XRP audit fee first — send to rmcSrkpZ2i2kuvtCPeTVetee9SixP4djR
# Then pass the tx hash:

audit = httpx.post(
    "https://xrpl-referee.onrender.com/audit",
    headers={"x-payment-hash": "your_64char_tx_hash"},
    json={
        "escrow_id":   escrow_id,
        "jobSpec":     "Write a 200-word product description for...",
        "deliverable": "Here is the completed description...",
    }
).json()

print(audit["verdict"])   # "PASS" or "FAIL"
print(audit["score"])     # 0–100
print(audit["summary"])   # plain-English explanation
```

**USDC on Base alternative:** if your agent holds USDC on Base (chain 8453), send $0.10 USDC to the Base wallet address in the `accepts` array of the `402` response you get when calling `/audit` with no fee header.

### 4. Release or reclaim

```python
# PASS — release to worker
httpx.post("https://xrpl-referee.onrender.com/escrow/release",
    json={"escrow_id": escrow_id, "payer_secret": "sPayerSecret"})

# FAIL and deadline passed — reclaim
httpx.post("https://xrpl-referee.onrender.com/escrow/cancel",
    json={"escrow_id": escrow_id, "payer_secret": "sPayerSecret"})
```

---

## Using the MCP server

Add AgentTrust to your Claude Desktop or any MCP host:

```json
{
  "mcpServers": {
    "agenttrust": {
      "url": "https://xrpl-referee.onrender.com/mcp/"
    }
  }
}
```

Or install via Smithery:

```bash
npx @smithery/cli install agenttrust
```

Available tools include `get_wallet_trust_score`, `create_escrow`, `audit_deliverable`, `release_escrow`, `cancel_escrow`, `list_nft_issuers`, `verify_domain`, and 12 more.

With the XRPL AI Starter Kit's MCP server running alongside AgentTrust's, Claude has full coverage: ledger queries from the starter kit, trust and payment logic from AgentTrust.

---

## Example: agent hiring agent

```python
# Orchestrator agent (buyer)
from agenttrust_sdk import AgentTrust

at = AgentTrust()

# 1. Check trust before hiring
score = at.get_trust_score("rWorkerAddress")
if score["score"] < 40 or not score["signals"]["sanctions_clean"]:
    raise ValueError("Counterparty does not meet minimum trust threshold")

# 2. Lock payment, run the task, audit the result
result = at.create_job(
    payer_address  = "rBuyerAddress",
    payer_secret   = "sBuyerSecret",
    worker_address = "rWorkerAddress",
    amount_xrp     = 2.0,
    job_spec       = "Translate the following paragraph into French...",
    deliverable    = worker_agent.run("Translate..."),
)

print(result["evaluation"]["verdict"])  # PASS → payment released automatically
```

---

## Payment options

| Method | Amount | Where to send |
|---|---|---|
| XRP (Mainnet) | 0.1 XRP | `rmcSrkpZ2i2kuvtCPeTVetee9SixP4djR` |
| USDC on Base | $0.10 | Address in `402` response `accepts` array |

Call `/audit` with no fee header to receive a machine-readable `402 Payment Required` response listing both options.

---

## Resources

- **API docs / playground:** https://xrpl-referee.onrender.com/docs
- **OpenAPI spec:** https://xrpl-referee.onrender.com/openapi.json
- **Guide (HTML):** https://www.cryptovault.co.uk/xrpl-ai-starter-kit/
- **Marketplace:** https://www.cryptovault.co.uk/marketplace
- **Compliance:** https://www.cryptovault.co.uk/compliance
- **Smithery listing:** https://smithery.ai/servers/xrpl/agent-trust
- **XRPL AI Starter Kit:** https://github.com/ripple/xrpl-ai-starter-kit
- **XRPL x402 docs:** https://xrpl.org/docs/tutorials/how-tos/use-specialized-payment-types/x402

Questions or issues: open a GitHub issue or reach the team via the marketplace contact form.
