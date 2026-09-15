"""
Example 05 — MCP tool flow with verdict response handling
=========================================================

Shows how to call AgentTrust MCP tools directly from Python using the
MCP client library, with proper handling of criteria_met / criteria_failed.

MCP endpoint: https://mcp.cryptovault.co.uk/mcp  (HTTP transport)
Smithery:     https://smithery.ai/server/@eamwhite1/xrpl-referee

Install:
    pip install mcp httpx

Testnet XRPL node (used by all examples):
    https://s.altnet.rippletest.net:51234
Mainnet alternative (when ready for production):
    https://xrplcluster.com
"""

import asyncio
import json
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

MCP_URL = "https://mcp.cryptovault.co.uk/mcp"

# ── Scenario ─────────────────────────────────────────────────────────────────
# A hiring agent wants to pay a worker agent for writing a README.
# Steps:
#   1. get_fees()                     — discover current fee amount
#   2. assess_counterparty_and_job()  — pre-flight risk check
#   3. audit_task()                   — AI verdict on submitted work
#   4. Read criteria_met / criteria_failed to decide next action

BUYER_WALLET  = "rBuyerWalletXXXXXXXXXXXXXXXXXXXXXX"
SELLER_WALLET = "rSellerWalletXXXXXXXXXXXXXXXXXXXXXX"
FEE_HASH      = ""  # populate from an on-chain payment, or omit if free-tier eligible

JOB_SPEC = (
    "Write a README.md for an open-source Python library. "
    "Must include: installation instructions, a quick-start code snippet, "
    "API reference table, and a contributing guide."
)

SUBMITTED_WORK = (
    "# mylib\n\n"
    "Install: `pip install mylib`\n\n"
    "## Quick start\n```python\nimport mylib\nmylib.run()\n```\n\n"
    "## Contributing\nOpen a PR."
    # NOTE: missing the API reference table — criteria_failed should catch this
)


async def call_tool(session: ClientSession, name: str, args: dict) -> dict:
    result = await session.call_tool(name, arguments=args)
    raw = result.content[0].text if result.content else "{}"
    return json.loads(raw)


async def main() -> None:
    async with streamablehttp_client(MCP_URL) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # ── Step 1: Discover fees ─────────────────────────────────────
            print("Step 1 — Get current fee schedule...")
            fees = await call_tool(session, "get_fees", {})
            audit_usd = fees["audit_fee"]["usd"]
            print(f"  Audit fee: ${audit_usd:.2f} USD")
            for asset in fees["audit_fee"]["assets_accepted"]:
                amount = (
                    f"{asset.get('amount_xrp', asset.get('amount_rlusd', asset.get('amount_usdc')))} "
                    f"{asset['asset']} on {asset['network']}"
                )
                print(f"  Accepted: {amount}")
            print(f"  Free tier: {fees['free_tier']['rule']}")

            # ── Step 2: Pre-flight counterparty check ─────────────────────
            print("\nStep 2 — Assess counterparty and job risk...")
            pre = await call_tool(session, "assess_counterparty_and_job", {
                "buyer_wallet":  BUYER_WALLET,
                "seller_wallet": SELLER_WALLET,
                "job_spec":      JOB_SPEC,
                "escrow_amount_usd": 50.0,
            })
            print(f"  Risk level:  {pre.get('risk_level', 'unknown')}")
            print(f"  Recommended: {pre.get('recommendation', '')}")
            if pre.get("warnings"):
                for w in pre["warnings"]:
                    print(f"  Warning: {w}")
            if pre.get("risk_level") == "high":
                print("  Aborting — risk too high.")
                return

            # ── Step 3: Submit work for AI audit ──────────────────────────
            print("\nStep 3 — Submit work for AI audit...")
            audit_args = {
                "task_spec":       JOB_SPEC,
                "work_submission": SUBMITTED_WORK,
                "wallet_address":  BUYER_WALLET,
            }
            if FEE_HASH:
                audit_args["fee_hash"] = FEE_HASH

            verdict = await call_tool(session, "audit_task", audit_args)

            # ── Step 4: Handle verdict ────────────────────────────────────
            print(f"\nStep 4 — Verdict: {verdict['verdict']} (score: {verdict['score']}/100)")
            print(f"  Summary: {verdict['summary']}")

            if verdict.get("criteria_met"):
                print("\n  Criteria met:")
                for c in verdict["criteria_met"]:
                    print(f"    ✓ {c}")

            if verdict.get("criteria_failed"):
                print("\n  Criteria failed:")
                for c in verdict["criteria_failed"]:
                    print(f"    ✗ {c}")

            if verdict["verdict"] == "PASS":
                print("\n  → Work accepted. Release payment or fulfill escrow.")
            else:
                print("\n  → Work rejected. Share criteria_failed with the worker:")
                if verdict.get("criteria_failed"):
                    feedback = "\n".join(f"- {c}" for c in verdict["criteria_failed"])
                    print(f"\n    Feedback to send:\n{feedback}")
                print("\n  Worker should address each point and resubmit.")


if __name__ == "__main__":
    asyncio.run(main())
