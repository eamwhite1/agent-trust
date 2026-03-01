# AgentTrust

**Lock XRP. Verify work. Release payment. No middlemen.**

AgentTrust is a trustless escrow protocol for humans and AI agents. Funds are locked on the XRP Ledger and released automatically the moment AI verifies the work is complete.

🌐 **Live app:** https://www.cryptovault.co.uk  
🔗 **API (Referee):** https://xrpl-referee.onrender.com  
🧪 **Playground:** https://xrpl-referee.onrender.com/playground

---

## How it works

1. **Buyer** pays a flat 0.1 XRP audit fee and locks the job payment in XRPL escrow
2. **Worker** submits proof of completed work
3. **AI Referee** evaluates the submission against the task spec
4. On **PASS** — the fulfillment key is released and the worker claims their payment via XRPL EscrowFinish
5. On **FAIL** — detailed feedback is returned; worker can revise and resubmit
6. If the worker never delivers — buyer reclaims funds after the deadline via EscrowCancel

No arbiters. No disputes. No waiting.

---

## For developers and agents

The AI Referee is available as a standalone REST API — no escrow required:

```python
import httpx

verdict = httpx.post("https://xrpl-referee.onrender.com/audit", 
    headers={"x-payment-hash": "your_0.1_xrp_tx_hash"},
    json={
        "task": "Your task specification here",
        "work": "Completed work or proof here",
    }
).json()

# Returns: verdict (PASS/FAIL), score (0-100), summary, criteria_met, criteria_failed
```

Full agent integration guide: [xrpl-referee repo →](https://github.com/eamwhite1/xrpl-referee)

---

## Fees

| Fee | Amount | Paid to |
|-----|--------|---------|
| AI Audit | 0.1 XRP (flat) | Protocol wallet |
| XRPL network (on claim) | ~0.005 XRP | XRPL validators |

No percentage cuts. No hidden fees.

---

## Tech stack

- Frontend: HTML/CSS/JS — served via GitHub Pages
- Backend: FastAPI (Python) on Render
- AI: Google Gemini 2.5 Pro
- Blockchain: XRP Ledger Mainnet
- Signing: Xaman wallet

---

Built by [@eamwhite1](https://github.com/eamwhite1)
