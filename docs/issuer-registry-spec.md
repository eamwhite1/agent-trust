# XRPL NFT Issuer Registry — Open Standard Specification

**Version:** 1.0.0  
**Status:** Draft  
**Authors:** AgentTrust / cryptovault.co.uk  
**Published:** 2026-06-06  
**Canonical URL:** https://www.cryptovault.co.uk/docs/issuer-registry-spec.md  
**Discovery:** https://www.cryptovault.co.uk/.well-known/xrpl-issuer-registry  
**Live Registry:** https://xrpl-referee.onrender.com/nft/issuers  

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
  "nft_types": "event-ticket"
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

| Status | Meaning |
|---|---|
| `verified` | Organisation has claimed listing; domain ↔ wallet link confirmed via xrp-ledger.toml |
| `public` | Seeded from public XRPL data (explorers, Foundation assessments); not yet claimed |
| `pending` | Registration submitted; awaiting verification |
| `revoked` | Previously verified; verification subsequently failed or withdrawn |

---

## 6. REST API

**Base URL:** `https://xrpl-referee.onrender.com`

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
  "register_api": "https://xrpl-referee.onrender.com/nft/issuers"
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

### 6.3 XRPL Wallet Lookup

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

**MCP endpoint:** `https://xrpl-referee.onrender.com/mcp`

### Available tools

| Tool name | Description |
|---|---|
| `list_trusted_issuers` | Query registry by name or category |
| `register_as_issuer` | Submit a new issuer registration |
| `company_xrpl_lookup` | Find an organisation's XRPL wallet by name |
| `verify_domain` | Verify wallet ↔ domain ownership via xrp-ledger.toml |

Any MCP-compatible AI agent can install this server and use the registry to resolve organisation names to verified XRPL wallets — enabling trustless, human-readable issuer requirements in escrow contracts.

---

## 8. Discovery

The registry can be discovered from any domain by fetching:

```
GET https://www.cryptovault.co.uk/.well-known/xrpl-issuer-registry
```

This returns a JSON document pointing to the live API and this specification:

```json
{
  "registry_api": "https://xrpl-referee.onrender.com/nft/issuers",
  "spec": "https://www.cryptovault.co.uk/docs/issuer-registry-spec.md",
  "version": "1.0.0",
  "mcp_endpoint": "https://xrpl-referee.onrender.com/mcp"
}
```

The same discovery document is served from the API:

```
GET https://xrpl-referee.onrender.com/.well-known/xrpl-issuer-registry
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
