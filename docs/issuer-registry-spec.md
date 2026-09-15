# XRPL NFT Issuer Registry — Open Standard Specification

**Version:** 1.1.0  
**Status:** Draft  
**Authors:** AgentTrust / cryptovault.co.uk  
**Published:** 2026-06-06  
**Updated:** 2026-09-15  
**Canonical URL:** https://www.cryptovault.co.uk/docs/issuer-registry-spec.md  
**Discovery:** https://www.cryptovault.co.uk/.well-known/xrpl-issuer-registry  
**Live Registry:** https://mcp.cryptovault.co.uk/nft/issuers  

---

## Abstract

There is no authoritative, open, machine-readable database mapping real-world organisation names to their NFT-issuing XRPL wallet addresses. This document defines a standard for such a registry: the schema for issuer records, the cryptographic method for verifying wallet ownership, and the REST API and MCP interface for querying and maintaining it.

The goal is a shared public good — a single registry that any wallet, DEX, explorer, AI agent, or smart contract can reference to answer the question: *"Does this XRPL wallet belong to the organisation it claims to represent?"*

---

## 1. Motivation

XRPL NFTs are increasingly used as real-world credentials — event tickets, bills of lading, certification badges, asset ownership proofs. For an NFT to function as a trustworthy credential, the buyer must be able to verify that it was issued by the legitimate wallet of the organisation that claims to have issued it.

Today this verification is manual and ad hoc. This spec defines a standard that makes it automatic and auditable.

---

## 2. Issuer Record Schema

Each issuer record contains the following fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `wallet_address` | string | ✓ | Primary XRPL wallet address (`r...`) |
| `wallet_addresses` | string[] | | All known wallet addresses for this issuer |
| `name` | string | ✓ | Legal or trading name of the organisation |
| `category` | string | | Category of NFTs issued (see §4) |
| `description` | string | | Short description of the organisation |
| `website` | string | | Organisation's primary domain (without protocol) |
| `verified` | string | ✓ | Verification status (see §5) |
| `lei` | string | | Legal Entity Identifier (ISO 17442) if available |
| `nft_types` | string | | Comma-separated NFT types issued |
| `created_at` | ISO 8601 | | When the record was first created |
| `verified_at` | ISO 8601 | | When the verification status last changed |
| `verified_by` | string | | Operator or automated system that performed the check |
| `toml_url` | string | | Exact `xrp-ledger.toml` URL that was fetched and checked |
| `accountset_tx_hash` | string | | On-chain AccountSet tx hash proving the wallet's Domain field |

The `verified_at`, `verified_by`, `toml_url`, and `accountset_tx_hash` fields form an **audit trail** that third-party mirrors can independently verify. A record with `verified_at=null` was verified before v1.1.0 of this spec.

### 2.1 Example Record

```json
{
  "wallet_address": "rDBMvpjV6DoWvr3LqMUG8JBgd4QbBoU1E2",
  "wallet_addresses": ["rDBMvpjV6DoWvr3LqMUG8JBgd4QbBoU1E2"],
  "name": "BPM Wallet (Twotixx)",
  "category": "NFT ticketing",
  "description": "XRPL-native NFT ticketing platform issuing event tickets to KYC'd wallets.",
  "website": "missionbpm.com",
  "verified": "verified",
  "lei": null,
  "nft_types": "event-ticket",
  "created_at": "2026-04-01T10:00:00Z",
  "verified_at": "2026-09-15T12:34:56Z",
  "verified_by": "agentrust-auto-v1",
  "toml_url": "https://missionbpm.com/.well-known/xrp-ledger.toml",
  "accountset_tx_hash": "A1B2C3D4E5F6..."
}
```

---

## 3. Verification Method

Verification proves that the organisation controlling the domain `website` also controls the XRPL wallet `wallet_address`. It uses the XRPL native domain verification standard (XLS-26 compatible):

### Step 1 — Set wallet domain field

The organisation sets the `Domain` field on their XRPL account to their domain name, hex-encoded. This is an on-chain, cryptographically signed assertion.

```
Domain field value: <hex-encoded domain string>
e.g. "cryptovault.co.uk" → "63727970746f7661756c742e636f2e756b"
```

### Step 2 — Publish xrp-ledger.toml

The organisation publishes `https://<domain>/.well-known/xrp-ledger.toml` listing their wallet:

```toml
[[ACCOUNTS]]
address = "rXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
desc = "Primary NFT issuer wallet"

[[ISSUERS]]
address = "rXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
name = "Organisation Name"
```

### Step 3 — Registry verification

The registry operator:
1. Fetches the XRPL account and reads the `Domain` field
2. Decodes the hex domain and fetches the `xrp-ledger.toml` at that domain
3. Confirms the wallet address appears in the toml
4. Sets `verified = "verified"` on the record

Both assertions must hold: the wallet must claim the domain on-chain, and the domain must list the wallet off-chain. Neither alone is sufficient.

### Step 4 — Claiming a public record

Organisations already seeded as `verified = "public"` (sourced from public XRPL data) can claim their listing by:
1. Ensuring their `xrp-ledger.toml` lists their wallet
2. Clicking **"Update my listing"** on the registry UI, or calling `PATCH /nft/issuers/{id}/claim`
3. The registry re-verifies and upgrades status to `"verified"`

---

## 4. Category Taxonomy

| Category | Description |
|---|---|
| `nft-ticketing` | Event tickets and access passes |
| `logistics` | Bills of lading, shipping proofs, cargo NFTs |
| `certification` | Professional qualifications, compliance badges |
| `real-world-asset` | Tokenised physical assets (property, commodities) |
| `regulated-gaming` | Licensed gaming platform tokens |
| `defi` | DeFi protocol tokens and governance NFTs |
| `exchange-gateway` | Exchange IOU issuers and liquidity gateways |
| `stablecoin` | Fiat-backed stablecoin issuers |
| `identity` | Decentralised identity credentials |
| `other` | Anything not covered above |

---

## 5. Verification Status Values

| Status | Meaning | Agent guidance |
|---|---|---|
| `verified` | Organisation has claimed listing; domain ↔ wallet link confirmed via xrp-ledger.toml | Safe to accept as issuer proof |
| `public` | Seeded from public XRPL data (explorers, Foundation assessments); not yet claimed | Treat with caution — unilaterally attested |
| `pending` | Registration submitted; awaiting verification | Do not accept as proof; check back later |
| `disputed` | Verification challenged by a third party; under review | Do not accept as proof; treat as unverified |
| `revoked` | Previously verified; verification subsequently failed or withdrawn | Do not accept; issuer has lost verified status |

**Missing is not verified.** If `lookup_nft_issuer` returns `registered: false`, the organisation is not in this registry. That tells you nothing about whether the wallet is legitimate — it only means it has not been independently verified here. Do not infer trust from absence.

---

## 6. REST API

**Base URL:** `https://mcp.cryptovault.co.uk`

### 6.1 List Issuers

```
GET /nft/issuers
```

**Query parameters:**

| Parameter | Type | Description |
|---|---|---|
| `category` | string | Filter by category |
| `include_pending` | boolean | Include pending registrations (default: false) |

**Response:**

```json
{
  "issuers": [ /* array of issuer records */ ],
  "register_url": "https://www.cryptovault.co.uk/marketplace#issuers",
  "register_api": "https://mcp.cryptovault.co.uk/nft/issuers"
}
```

### 6.2 Register as Issuer

```
POST /nft/issuers
Content-Type: application/json
```

```json
{
  "wallet_address": "rXXX...",
  "name": "Organisation Name",
  "category": "nft-ticketing",
  "description": "Short description",
  "website": "example.com",
  "contact_email": "admin@example.com"
}
```

### 6.3 Registry Feed (for explorers, wallets, DEXs)

```
GET /nft/issuers/feed
```

A paginated, versioned feed designed for external systems to consume and cache. Returns a stable envelope with pagination metadata, generation timestamp, and spec version so consumers can detect schema changes.

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | integer | 1 | Page number |
| `per_page` | integer | 100 | Results per page (max 200) |
| `since` | ISO 8601 string | — | Return only records created after this timestamp (for incremental sync) |
| `category` | string | — | Filter by category slug |
| `verified` | string | — | Filter by status: `verified`, `public`, `pending`, `disputed`, `revoked`, or omit for verified+public |

The feed includes `Cache-Control: public, max-age=300` and `ETag` headers for mirror caching.

**Response envelope:**

```json
{
  "spec_version": "1.1.0",
  "spec": "https://www.cryptovault.co.uk/docs/issuer-registry-spec.md",
  "generated_at": "2026-06-06T12:00:00Z",
  "pagination": {
    "page": 1,
    "per_page": 100,
    "total": 8,
    "total_pages": 1,
    "next": null
  },
  "filters": { "category": null, "verified": null, "since": null },
  "issuers": [ /* array of issuer records including verified_at, verified_by, toml_url, accountset_tx_hash */ ]
}
```

**Incremental sync example** — fetch only records added since your last poll:

```
GET /nft/issuers/feed?since=2026-06-01T00:00:00Z
```

**Verified-only feed:**

```
GET /nft/issuers/feed?verified=verified
```

### 6.4 XRPL Wallet Lookup

```
GET /gleif/xrpl-lookup?q=<organisation name>
```

Returns registry records matching the query name, including wallet addresses.

### 6.4 Domain Verification

```
POST /domain/verify
Content-Type: application/json

{ "wallet_address": "rXXX...", "expected_domain": "example.com" }
```

---

## 7. MCP Interface

The registry is available as an MCP (Model Context Protocol) server for AI agents:

**MCP endpoint:** `https://mcp.cryptovault.co.uk/mcp`

### Available tools

| Tool name | Description |
|---|---|
| `lookup_nft_issuer` | Search registry by name; returns `registered: false` with explanation if not found |
| `get_nft_issuer_by_wallet` | Exact-match lookup by XRPL wallet address |
| `verify_nft_ownership` | Verify that a wallet holds a specific NFT token |

Any MCP-compatible AI agent can install this server and use the registry to resolve organisation names to verified XRPL wallets — enabling trust-minimized, human-readable issuer requirements in escrow contracts.

**Honest empty results:** `lookup_nft_issuer` never returns partial matches as if they were verified. If the organisation is not in the registry, you receive `registered: false` — not a guess.

---

## 8. Discovery

The registry can be discovered from any domain by fetching:

```
GET https://www.cryptovault.co.uk/.well-known/xrpl-issuer-registry
```

This returns a JSON document pointing to the live API and this specification:

```json
{
  "registry_api": "https://mcp.cryptovault.co.uk/nft/issuers",
  "spec": "https://www.cryptovault.co.uk/docs/issuer-registry-spec.md",
  "version": "1.0.0",
  "mcp_endpoint": "https://mcp.cryptovault.co.uk/mcp"
}
```

The same discovery document is served from the API:

```
GET https://mcp.cryptovault.co.uk/.well-known/xrpl-issuer-registry
```

---

## 9. Relationship to Existing Standards

| Standard | Relationship |
|---|---|
| **XLS-26 (xrp-ledger.toml)** | This spec uses xrp-ledger.toml as its verification mechanism — fully compatible |
| **XLS-30 (XRPL Hooks)** | Future versions will support hook-triggered automatic re-verification |
| **W3C DID** | Registry entries are intended to be resolvable as DID documents when XLS-26 matures |
| **LEI (ISO 17442)** | Optional LEI field links registry records to the Global LEI System for legal entity verification |
| **XRPL Foundation Token Self-Assessment** | Public records seeded from Foundation self-assessments; registry extends these with wallet verification |

---

## 10. Contributing

- **Register your organisation:** https://www.cryptovault.co.uk/marketplace#issuers
- **API source:** https://github.com/eamwhite1/xrpl-referee
- **Frontend source:** https://github.com/eamwhite1/agent-trust
- **Standards discussion:** Open an issue on either repository

We are seeking feedback from the XRPL Foundation, Xaman, XRPScan, Bithomp, and XPMarket on adopting this as a shared community standard.
