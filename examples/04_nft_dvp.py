"""
AgentTrust — NFT Delivery-vs-Payment (DvP) Example
====================================================
End-to-end walkthrough: buy an official NFT with atomic payment release.

Flow:
  1. Buyer looks up the issuer in the registry — confirm it's "verified"
  2. Buyer creates a DvP escrow (payment held until NFT delivered)
  3. Buyer signs & submits the EscrowCreate transaction on XRPL
  4. Buyer confirms the escrow is active with AgentTrust
  5. Seller (NFT issuer) creates an NFT sell offer directed at the buyer
  6. Buyer accepts the offer — NFT enters their wallet
  7. AgentTrust detects the NFT delivery and releases escrow payment automatically

The key insight: disabling AI audit (require_ai_audit=False) means payment
releases on proof alone — the registry check and NFT ownership verification
are the only oracles. No LLM is involved.

Oracle model:
  - Trustless:  XRPL escrow custody, crypto-condition fulfillment key
  - Oracle-minimized: AgentTrust verifies registry status + NFT ownership,
    then submits the on-chain fulfillment. The ledger releases funds.
  - NOT yet oracle-free: XLS-30 atomicity (full on-chain DvP) is the
    long-term goal.

Requirements:
    pip install requests xrpl-py

Testnet wallets:
    https://xrpl.org/xrp-testnet-faucet.html

API endpoint:
    https://mcp.cryptovault.co.uk
"""

import os
import json
import requests
from xrpl.wallet import Wallet
from xrpl.clients import JsonRpcClient
from xrpl.models.transactions import EscrowCreate
from xrpl.transaction import submit_and_wait
from xrpl.utils import xrp_to_drops

# ── Config ──────────────────────────────────────────────────────────────────

API_BASE = "https://mcp.cryptovault.co.uk"

# Testnet JSON-RPC endpoint
XRPL_CLIENT = JsonRpcClient("https://s.altnet.rippletest.net:51234/")

# Load wallets from env (never hardcode seeds)
BUYER_SEED  = os.environ["BUYER_SEED"]   # wallet buying the NFT
SELLER_SEED = os.environ["SELLER_SEED"]  # wallet selling (issuing) the NFT

buyer_wallet  = Wallet.from_seed(BUYER_SEED)
seller_wallet = Wallet.from_seed(SELLER_SEED)

# NFT token ID you want to buy (from the issuer)
TARGET_NFT_TOKEN_ID = os.environ.get("TARGET_NFT_TOKEN_ID", "")

# Amount to pay (XRP)
AMOUNT_XRP = 5.0

# ── Step 1: Look up the issuer in the registry ───────────────────────────────

print("Step 1 — Looking up NFT issuer in the registry...")
resp = requests.get(f"{API_BASE}/nft/issuers/by-wallet/{seller_wallet.classic_address}")
resp.raise_for_status()
issuer = resp.json()

if not issuer:
    raise SystemExit(
        f"Seller wallet {seller_wallet.classic_address} is not in the AgentTrust registry. "
        "Abort — do not pay an unverified issuer."
    )

verified_status = issuer.get("verified", "unknown")
if verified_status == "disputed":
    raise SystemExit("Issuer status is 'disputed' — verification challenged. Abort.")
if verified_status == "revoked":
    raise SystemExit("Issuer status is 'revoked' — no longer verified. Abort.")
if verified_status not in ("verified", "public"):
    print(f"  ⚠ Issuer status is '{verified_status}' — proceeding with caution.")
else:
    print(f"  ✓ Issuer '{issuer['name']}' status: {verified_status}")
    if issuer.get("toml_url"):
        print(f"    Proof: {issuer['toml_url']}")
    if issuer.get("accountset_tx_hash"):
        print(f"    On-chain tx: {issuer['accountset_tx_hash']}")

# ── Step 2: Pre-flight counterparty check ───────────────────────────────────

print("\nStep 2 — Pre-flight counterparty check...")
resp = requests.post(f"{API_BASE}/escrow/assess-counterparty", json={
    "worker_address": seller_wallet.classic_address,
    "job_type": "nft_dvp",
    "amount_xrp": AMOUNT_XRP,
})
resp.raise_for_status()
assessment = resp.json()

if not assessment.get("proceed"):
    blockers = assessment.get("do_not_proceed_if", [])
    raise SystemExit(f"Pre-flight failed: {blockers}")

print(f"  ✓ Proceed: true  |  Trust score: {assessment['trust']['score']}")

# ── Step 3: Create DvP escrow via AgentTrust ─────────────────────────────────

print("\nStep 3 — Creating DvP escrow...")
resp = requests.post(f"{API_BASE}/escrow/generate", json={
    "buyer_address":    buyer_wallet.classic_address,
    "seller_address":   seller_wallet.classic_address,
    "amount_xrp":       AMOUNT_XRP,
    "task_spec":        f"Deliver NFT token {TARGET_NFT_TOKEN_ID} to buyer wallet",
    # DvP: payment held until the specified NFT token is in the buyer's wallet
    "nft_dvp":          True,
    "nft_dvp_token_id": TARGET_NFT_TOKEN_ID,
    # No AI audit — proof gate only, oracle-minimized
    "require_ai_audit": False,
})
resp.raise_for_status()
escrow_data = resp.json()

escrow_id  = escrow_data["escrow_id"]
tx_dict    = escrow_data["escrow_tx"]
finish_after = escrow_data.get("finish_after")

print(f"  ✓ Escrow ID: {escrow_id}")
print(f"    Finish-after: {finish_after}")

# ── Step 4: Sign and submit EscrowCreate on XRPL ────────────────────────────

print("\nStep 4 — Signing and submitting EscrowCreate to XRPL...")
escrow_tx = EscrowCreate(
    account=buyer_wallet.classic_address,
    amount=xrp_to_drops(AMOUNT_XRP),
    destination=seller_wallet.classic_address,
    condition=tx_dict["condition"],
    finish_after=tx_dict.get("finish_after"),
    cancel_after=tx_dict.get("cancel_after"),
)

result = submit_and_wait(escrow_tx, XRPL_CLIENT, buyer_wallet)
tx_hash = result.result["hash"]
print(f"  ✓ EscrowCreate submitted: {tx_hash}")

# Confirm with AgentTrust so it monitors for NFT delivery
resp = requests.post(f"{API_BASE}/escrow/{escrow_id}/confirm", json={"tx_hash": tx_hash})
resp.raise_for_status()
print(f"  ✓ Escrow confirmed with AgentTrust")

# ── Step 5: Seller creates NFT sell offer for the buyer ──────────────────────

print("\nStep 5 — Seller: create NFT sell offer directed at buyer...")
print("  (In a real integration, the seller's agent does this step autonomously)")
print(f"  Seller ({seller_wallet.classic_address}) should call NFTokenCreateOffer:")
print(f"    NFTokenID: {TARGET_NFT_TOKEN_ID}")
print(f"    Amount: 0  (payment is already in escrow)")
print(f"    Destination: {buyer_wallet.classic_address}")
print()
print("  Then submit the offer ID to AgentTrust:")
print(f"    POST {API_BASE}/escrow/{escrow_id}/nft-offer")
print(f"    {{ \"nft_offer_id\": \"<offer_id_from_xrpl>\" }}")

# ── Step 6: Buyer accepts the NFT offer ─────────────────────────────────────

print("\nStep 6 — After seller creates the offer, buyer accepts it.")
print("  This transfers the NFT into the buyer's wallet on-chain.")
print("  AgentTrust detects the delivery and releases the escrow automatically.")
print()

# ── Step 7: Verify NFT ownership (optional poll) ────────────────────────────

print("Step 7 — Verify NFT ownership (optional — AgentTrust does this automatically)...")
if TARGET_NFT_TOKEN_ID:
    resp = requests.post(f"{API_BASE}/nft/verify", json={
        "wallet_address": buyer_wallet.classic_address,
        "nft_token_id":   TARGET_NFT_TOKEN_ID,
    })
    if resp.ok:
        ownership = resp.json()
        print(f"  NFT in buyer wallet: {ownership.get('owns_nft', False)}")
        print(f"  Escrow status:       {ownership.get('escrow_status', 'unknown')}")

print()
print("Done. Payment releases automatically once AgentTrust confirms NFT delivery.")
print(f"Monitor escrow status: GET {API_BASE}/escrow/{escrow_id}")
