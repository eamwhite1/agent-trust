// ---------------------------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------------------------
const REFEREE_URL = "https://xrpl-referee.onrender.com";

// ---------------------------------------------------------------------------
// FILE ATTACHMENT STATE
// ---------------------------------------------------------------------------
let buyerFiles  = [];
let workerFiles = [];

const MAX_FILE_SIZE_MB    = 15;
const MAX_TOTAL_SIZE_MB   = 50;
const ACCEPTED_MIME_TYPES = {
    "application/pdf": "pdf",
    "image/jpeg":      "image",
    "image/png":       "image",
    "image/gif":       "image",
    "image/webp":      "image",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "text/plain":      "text",
    "text/markdown":   "text",
};

// ---------------------------------------------------------------------------
// FILE READING HELPERS
// ---------------------------------------------------------------------------
async function processFile(file, targetArray, targetTextareaId, labelPrefix) {
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        alert(`"${file.name}" is too large. Maximum file size is ${MAX_FILE_SIZE_MB} MB.`);
        return;
    }
    const mime = file.type || guessMime(file.name);
    if (!ACCEPTED_MIME_TYPES[mime]) {
        alert(`"${file.name}" is not a supported file type.`);
        return;
    }
    if (targetArray.find(f => f.filename === file.name)) {
        alert(`"${file.name}" has already been added.`);
        return;
    }
    const currentTotal = targetArray.reduce((sum, f) => sum + (f.size || 0), 0);
    if (currentTotal + file.size > MAX_TOTAL_SIZE_MB * 1024 * 1024) {
        alert(`Adding "${file.name}" would exceed the ${MAX_TOTAL_SIZE_MB} MB total limit.`);
        return;
    }
    return new Promise((resolve) => {
        const reader = new FileReader();
        if (mime === "application/pdf" || mime.startsWith("image/")) {
            reader.onload = (e) => {
                const base64 = e.target.result.split(",")[1];
                targetArray.push({ filename: file.name, mime_type: mime, data: base64, size: file.size });
                resolve();
            };
            reader.readAsDataURL(file);
        } else {
            reader.onload = (e) => {
                const text     = e.target.result;
                const textarea = document.getElementById(targetTextareaId);
                if (textarea) {
                    const existing = textarea.value.trim();
                    textarea.value = existing
                        ? `${existing}\n\n--- ${labelPrefix}: ${file.name} ---\n${text}`
                        : `--- ${labelPrefix}: ${file.name} ---\n${text}`;
                }
                targetArray.push({ filename: file.name, mime_type: mime, data: null, size: file.size, text_extracted: true });
                resolve();
            };
            reader.readAsText(file);
        }
    });
}

function guessMime(filename) {
    const ext = filename.split(".").pop().toLowerCase();
    const map = {
        pdf:  "application/pdf",
        jpg:  "image/jpeg", jpeg: "image/jpeg",
        png:  "image/png",  gif: "image/gif",
        webp: "image/webp",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        txt:  "text/plain", md: "text/markdown",
    };
    return map[ext] || "application/octet-stream";
}

function formatBytes(bytes) {
    if (bytes < 1024)         return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderFileList(files, listId) {
    const el = document.getElementById(listId);
    if (!el) return;
    if (files.length === 0) { el.innerHTML = ""; return; }
    el.innerHTML = files.map((f, i) => `
        <div class="file-chip">
            <i data-lucide="${f.mime_type?.startsWith("image/") ? "image" : f.mime_type === "application/pdf" ? "file-text" : "file"}"></i>
            <span class="file-name">${f.filename}</span>
            <span class="file-size">${formatBytes(f.size)}</span>
            ${f.text_extracted ? '<span class="file-extracted">text extracted</span>' : ""}
            <button class="file-remove" onclick="removeFile('${listId}', ${i})"><i data-lucide="x"></i></button>
        </div>
    `).join("");
    if (window.lucide) lucide.createIcons();
}

function removeFile(listId, index) {
    if (listId === "buyer-file-list")  { buyerFiles.splice(index, 1);  renderFileList(buyerFiles,  "buyer-file-list"); }
    if (listId === "worker-file-list") { workerFiles.splice(index, 1); renderFileList(workerFiles, "worker-file-list"); }
}

function initDropZone(zoneId, fileArray, fileListId, textareaId, labelPrefix) {
    const zone  = document.getElementById(zoneId);
    const input = zone?.querySelector("input[type=file]");
    if (!zone || !input) return;
    zone.addEventListener("dragover",  (e) => { e.preventDefault(); zone.classList.add("drag-over"); });
    zone.addEventListener("dragleave", ()  => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", async (e) => {
        e.preventDefault(); zone.classList.remove("drag-over");
        for (const f of Array.from(e.dataTransfer.files)) await processFile(f, fileArray, textareaId, labelPrefix);
        renderFileList(fileArray, fileListId);
    });
    zone.addEventListener("click", (e) => {
        if (e.target.classList.contains("file-remove")) return;
        input.click();
    });
    input.addEventListener("change", async () => {
        for (const f of Array.from(input.files)) await processFile(f, fileArray, textareaId, labelPrefix);
        renderFileList(fileArray, fileListId);
        input.value = "";
    });
}

// ---------------------------------------------------------------------------
// SHARED STATE
// ---------------------------------------------------------------------------
let feePayloadUUID     = null;
let feePollingTimer    = null;
let buyerWalletAddress = null;
let dexQuoteData       = null;
// Stores the full evaluate response for fallback manual claim
let lastEvaluateResult = null;

// ---------------------------------------------------------------------------
// UTILITY
// ---------------------------------------------------------------------------
function showStatus(elementId, message, type = "info") {
    const el = document.getElementById(elementId);
    if (!el) return;
    const colors = { info: "#007BFF", success: "#34c759", error: "#ff3b30", warning: "#ff9500" };
    el.style.color   = colors[type] || colors.info;
    el.style.display = "block";
    el.textContent   = message;
}

function hideStatus(elementId) {
    const el = document.getElementById(elementId);
    if (el) el.style.display = "none";
}

function updateFeeDisplay() {
    const val     = parseFloat(document.getElementById("amt")?.value) || 0;
    const totalEl = document.getElementById("totalX");
    if (totalEl) totalEl.textContent = val.toFixed(2);
}

function setPaymentMode(mode) {
    const manualSection = document.getElementById("manual-hash-section");
    const autoSection   = document.getElementById("auto-pay-section");
    const btnAuto       = document.getElementById("btn-auto");
    const btnManual     = document.getElementById("btn-manual");
    if (!manualSection) return;
    if (mode === "manual") {
        manualSection.style.display = "block";
        autoSection && (autoSection.style.display = "none");
        btnManual?.classList.add("active");
        btnAuto?.classList.remove("active");
    } else {
        manualSection.style.display = "none";
        autoSection && (autoSection.style.display = "block");
        btnAuto?.classList.add("active");
        btnManual?.classList.remove("active");
    }
}

function setSellerMode(mode) {
    const apiSection = document.getElementById("seller-api-section");
    const uiSection  = document.getElementById("seller-ui-section");
    const btnUi      = document.getElementById("btn-seller-ui");
    const btnApi     = document.getElementById("btn-seller-api");
    if (!apiSection) return;
    if (mode === "api") {
        apiSection.style.display = "block";
        uiSection && (uiSection.style.display = "none");
        btnApi?.classList.add("active");
        btnUi?.classList.remove("active");
    } else {
        apiSection.style.display = "none";
        uiSection && (uiSection.style.display = "block");
        btnUi?.classList.add("active");
        btnApi?.classList.remove("active");
    }
}

function generateReceiptCode() {
    const chars   = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const segment = (len) => Array.from(
        crypto.getRandomValues(new Uint8Array(len)),
        b => chars[b % chars.length]
    ).join("");
    return `AT-${segment(4)}-${segment(4)}`;
}

// ---------------------------------------------------------------------------
// SAFE FETCH
// ---------------------------------------------------------------------------
async function safeFetch(url, options = {}) {
    const res         = await fetch(url, { signal: AbortSignal.timeout(30000), ...options });
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
        const body = await res.text();
        throw new Error(`Server returned ${res.status} — expected JSON:\n${body.substring(0, 200)}`);
    }
    return res;
}

// Pre-warm Render on page load so the server is awake before the user acts
fetch(`${REFEREE_URL}/health`).catch(() => {});

// ---------------------------------------------------------------------------
// CURRENCY HELPERS
// ---------------------------------------------------------------------------
function getBuyerCurrency() {
    return document.getElementById("buyer-currency")?.value || "RLUSD";
}

function onBuyerCurrencyChange() {
    const currency = getBuyerCurrency();
    const amtLabel = document.getElementById("amt-currency-label");
    const amtInput = document.getElementById("amt");
    const equiv    = document.getElementById("usd-equiv");
    const trustNote = document.getElementById("amt-trustline-note");

    if (currency === "RLUSD") {
        if (amtLabel)   amtLabel.textContent    = "RLUSD";
        if (amtInput)   amtInput.placeholder    = "e.g. 500.00";
        if (equiv)      equiv.textContent        = "RLUSD is pegged 1:1 to USD — $1 per RLUSD";
        if (trustNote)  trustNote.style.display  = "inline";
    } else {
        if (amtLabel)   amtLabel.textContent    = "XRP";
        if (amtInput)   amtInput.placeholder    = "e.g. 10";
        if (trustNote)  trustNote.style.display  = "none";
        updateUsdEquiv();
    }
    updateFeeDisplay();
}

// ---------------------------------------------------------------------------
// DOM READY
// ---------------------------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
    initDropZone("buyer-drop-zone",  buyerFiles,  "buyer-file-list",  "job-description", "Buyer Spec");
    initDropZone("worker-drop-zone", workerFiles, "worker-file-list", "work-proof",       "Proof");

    const amtField = document.getElementById("amt");
    if (amtField) amtField.addEventListener("input", () => { updateFeeDisplay(); updateUsdEquiv(); });

    setPaymentMode("auto");
    setSellerMode("ui");
    onBuyerCurrencyChange(); // initialise label/placeholder for default RLUSD
});

// ---------------------------------------------------------------------------
// XRP/USD price
// ---------------------------------------------------------------------------
let xrpPriceUsd = null, xrpPriceGbp = null;

async function fetchXrpPrice() {
    try {
        const res  = await fetch(`${REFEREE_URL}/xrp/price`);
        const data = await res.json();
        xrpPriceUsd = data.usd;
        xrpPriceGbp = data.gbp;
        // Refresh any displayed XRP amounts once price is known
        updateUsdEquiv();
    } catch(e) { console.warn("XRP price fetch failed", e); }
}

function updateUsdEquiv() {
    const el  = document.getElementById("usd-equiv");
    const amt = parseFloat(document.getElementById("amt")?.value);

    // Amount field beneath escrow amount input
    if (el) {
        if (getBuyerCurrency() === "RLUSD") {
            el.textContent = "RLUSD is pegged 1:1 to USD — $1 per RLUSD";
        } else if (amt && !isNaN(amt) && xrpPriceUsd) {
            const usd = (amt * xrpPriceUsd).toFixed(2);
            const gbp = xrpPriceGbp ? ` · £${(amt * xrpPriceGbp).toFixed(2)} GBP` : "";
            el.textContent = `≈ $${usd} USD${gbp}`;
        } else if (amt && !isNaN(amt)) {
            el.textContent = "Fetching live XRP price…";
        } else {
            el.textContent = "";
        }
    }

    // Fee spans — update whenever this runs if price is available
    if (xrpPriceUsd) {
        const feeUsd     = (0.1 * xrpPriceUsd).toFixed(2);
        const feeEquiv   = document.getElementById("fee-usd-equiv");
        const feeBtn     = document.getElementById("fee-btn-usd");
        const compareFee = document.getElementById("compare-fee-usd");
        if (feeEquiv)   feeEquiv.textContent  = `(≈ $${feeUsd})`;
        if (feeBtn)     feeBtn.textContent     = `≈ $${feeUsd}`;
        if (compareFee) compareFee.textContent = `≈ $${feeUsd} USD at current XRP price`;
    }
}

fetchXrpPrice();

function getResolvedRecipient() {
    return document.getElementById("recipient")?.value.trim() || "";
}

// ---------------------------------------------------------------------------
// STEP 1A — PAY PROTOCOL FEE
// ---------------------------------------------------------------------------
async function payFee() {
    const btn = document.getElementById("pay-fee-btn");
    if (btn) btn.disabled = true;
    showStatus("fee-status", "⏳ Connecting to Xaman...", "info");
    try {
        const res  = await safeFetch(`${REFEREE_URL}/xumm/fee-payload`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    "{}",
        });
        const data = await res.json();
        if (data.detail) throw new Error(data.detail);
        if (!data.nextUrl) throw new Error("Xaman did not return a sign URL. Check XUMM API credentials are set on the server.");
        feePayloadUUID = data.uuid;
        window.open(data.nextUrl, "_blank");
        showStatus("fee-status", "Xaman opened — sign the 0.1 XRP payment, then return here.", "info");
        feePollingTimer = setInterval(pollFeePayment, 3000);
    } catch (err) {
        const msg = err.message === "Failed to fetch"
            ? "Could not reach the referee server. It may be starting up — please wait 30 seconds and try again."
            : err.message;
        showStatus("fee-status", `❌ Error: ${msg}`, "error");
        if (btn) btn.disabled = false;
    }
}

async function pollFeePayment() {
    if (!feePayloadUUID) return;
    try {
        const res  = await safeFetch(`${REFEREE_URL}/xumm/payload/${feePayloadUUID}`);
        const data = await res.json();
        if (data.signed && data.tx_hash) {
            clearInterval(feePollingTimer);
            if (data.signer) buyerWalletAddress = data.signer;
            const hashField = document.getElementById("audit-fee-hash");
            if (hashField) hashField.value = data.tx_hash;
            showStatus("fee-status", `✅ Fee paid! Hash: ${data.tx_hash.substring(0, 16)}...`, "success");
            const payBtn  = document.getElementById("pay-fee-btn");
            const initBtn = document.getElementById("init-btn");
            if (payBtn)  payBtn.disabled  = false;
            if (initBtn) initBtn.disabled = false;
        }
    } catch (err) {
        console.warn("Fee poll error:", err);
    }
}

// ---------------------------------------------------------------------------
// STEP 1B — INITIALIZE VAULT
// ---------------------------------------------------------------------------
async function initVault() {
    const btn = document.getElementById("init-btn");

    const buyerName    = document.getElementById("buyer-name")?.value.trim();
    const buyerEmail   = document.getElementById("buyer-email")?.value.trim() || null;
    const workerEmail  = document.getElementById("worker-email-field")?.value.trim() || null;
    const projectLabel = document.getElementById("project-label")?.value.trim() || null;
    const taskDesc     = document.getElementById("job-description")?.value.trim();
    const recipient    = getResolvedRecipient();   // handles PayString → r-address resolution
    const amountVal    = document.getElementById("amt")?.value;
    const feeHash      = document.getElementById("audit-fee-hash")?.value.trim();
    const cancelHrs    = parseInt(document.getElementById("cancel-hours")?.value || "168");
    const currency     = getBuyerCurrency();

    if (!buyerName || !projectLabel || !taskDesc || !recipient || !amountVal) {
        showStatus("init-status", "❌ Please fill in all required fields.", "error");
        return;
    }
    if (!feeHash) {
        showStatus("init-status", "❌ Please pay the 0.1 XRP fee first.", "error");
        return;
    }
    if (!workerEmail) {
        const proceed = confirm(
            "⚠️ No seller email entered.\n\n" +
            "Without an email, the seller won't receive their receipt code or submission link — " +
            "you'll need to send these manually.\n\n" +
            "Continue anyway?"
        );
        if (!proceed) return;
    }

    const receiptCode = generateReceiptCode();
    if (btn) btn.disabled = true;
    showStatus("init-status", "⏳ Verifying fee and creating vault...", "info");

    try {
        const nftIssuer   = document.getElementById("nft-issuer-field")?.value.trim() || null;
        const nftMetaRaw  = document.getElementById("nft-metadata-field")?.value.trim() || null;
        let nftMetadata = null;
        if (nftMetaRaw) {
            try { nftMetadata = JSON.parse(nftMetaRaw); } catch(e) { /* ignore invalid JSON */ }
        }

        const requiredDomain      = document.getElementById("required-domain-field")?.value.trim() || null;
        const requiredVcIssuer    = document.getElementById("required-vc-issuer-field")?.value.trim() || null;
        const requiredVcType      = document.getElementById("required-vc-type-field")?.value.trim() || null;
        const proofPolicy         = document.getElementById("proof-policy-value")?.value || "ALL";
        const nftDvp              = document.getElementById("nft-dvp-toggle")?.checked || false;

        const body = {
            escrow_id:         receiptCode,
            fee_hash:          feeHash,
            project_label:     projectLabel,
            buyer_name:        buyerName,
            buyer_address:     buyerWalletAddress || "",
            buyer_email:       buyerEmail,
            worker_email:      workerEmail,
            task_description:  taskDesc,
            worker_address:    recipient,
            currency:          currency,
            cancel_after_hrs:  cancelHrs,
            buyer_attachments: buyerFiles.filter(f => f.data).map(f => ({
                filename: f.filename, mime_type: f.mime_type, data: f.data,
            })),
            spec_links: Array.from(document.querySelectorAll("#spec-links-container .spec-link-input"))
                .map(el => el.value.trim()).filter(Boolean),
            required_nft_issuer:    nftIssuer,
            required_nft_metadata:  nftMetadata,
            required_domain:        requiredDomain    || undefined,
            required_vc_issuer_did: requiredVcIssuer  || undefined,
            required_vc_type:       requiredVcType     || undefined,
            proof_policy:           proofPolicy,
            nft_dvp:                nftDvp,
        };

        if (currency === "RLUSD") {
            body.amount_rlusd = parseFloat(amountVal);
        } else {
            body.amount_xrp = parseFloat(amountVal);
        }

        const setupRes  = await safeFetch(`${REFEREE_URL}/escrow/generate`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const setupData = await setupRes.json();

        if (!setupRes.ok) throw new Error(setupData.detail || "Backend rejected the request.");

        const condition         = setupData.condition;
        const escrowAmount      = setupData.escrow_amount;   // ready for EscrowCreate
        const cancelAfterRipple = setupData.cancel_after_ripple;

        let statusMsg = "✅ Vault created! Opening Xaman for EscrowCreate...";
        if (workerEmail && setupData.worker_email_sent) statusMsg += `\n📧 Receipt code sent to ${workerEmail}`;
        showStatus("init-status", statusMsg, "success");

        const escrowTx = {
            TransactionType: "EscrowCreate",
            Amount:          escrowAmount,
            Destination:     recipient,
            Condition:       condition.toUpperCase(),
        };
        if (cancelAfterRipple) escrowTx.CancelAfter = cancelAfterRipple;

        const xummRes  = await safeFetch(`${REFEREE_URL}/xumm/create-payload`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ txjson: escrowTx }),
        });
        const xummData = await xummRes.json();

        if (xummData.nextUrl) {
            window.open(xummData.nextUrl, "_blank");

            const sharePanel = document.getElementById("share-panel");
            const shareId    = document.getElementById("share-project-id");
            if (sharePanel && shareId) {
                shareId.textContent      = receiptCode;
                sharePanel.style.display = "block";
                if (window.lucide) lucide.createIcons();
            }

            showStatus(
                "init-status",
                `Vault created! Xaman opened — sign the EscrowCreate transaction.\n` +
                `Receipt Code: ${receiptCode}\n` +
                `Share this with your seller once signed.` +
                (workerEmail && setupData.worker_email_sent ? `\n📧 We've also emailed the receipt code to ${workerEmail}` : ""),
                "success"
            );

            pollEscrowCreate(xummData.uuid, receiptCode);
        } else {
            throw new Error("Xaman failed to return a sign URL.");
        }

    } catch (err) {
        showStatus("init-status", `❌ ${err.message}`, "error");
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ---------------------------------------------------------------------------
// POLL XAMAN FOR ESCROW CREATE CONFIRMATION
// ---------------------------------------------------------------------------
let escrowCreateTimer = null;

async function pollEscrowCreate(uuid, receiptCode) {
    if (!uuid) return;
    escrowCreateTimer = setInterval(async () => {
        try {
            const res  = await safeFetch(`${REFEREE_URL}/xumm/payload/${uuid}`);
            const data = await res.json();
            if (data.signed && data.tx_hash) {
                clearInterval(escrowCreateTimer);
                await safeFetch(`${REFEREE_URL}/escrow/${encodeURIComponent(receiptCode)}/confirm`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ tx_hash: data.tx_hash }),
                });
                showStatus(
                    "init-status",
                    `✅ Escrow is live on XRPL!\nReceipt Code: ${receiptCode}\n` +
                    `Share this with your seller — they submit their work and payment is released automatically on AI approval.`,
                    "success"
                );
            }
        } catch (err) { console.warn("EscrowCreate poll error:", err); }
    }, 3000);
}

// ---------------------------------------------------------------------------
// NFT DvP MODE TOGGLE
// ---------------------------------------------------------------------------
function toggleNftDvpMode() {
    const checkbox   = document.getElementById("nft-dvp-toggle");
    const expanded   = document.getElementById("dvp-expanded");
    const pill       = document.getElementById("dvp-pill");
    const btn        = document.getElementById("nft-dvp-btn");
    const wrap       = document.getElementById("dvp-toggle-wrap");
    checkbox.checked = !checkbox.checked;
    const on = checkbox.checked;
    if (expanded) expanded.style.display = on ? "block" : "none";
    if (pill) {
        pill.textContent = on ? "ON" : "OFF";
        pill.style.background = on ? "rgba(16,185,129,.2)" : "rgba(255,255,255,.07)";
        pill.style.color       = on ? "#10b981" : "var(--text-muted)";
        pill.style.borderColor = on ? "rgba(16,185,129,.4)" : "rgba(255,255,255,.12)";
    }
    if (btn) btn.style.background = on ? "rgba(16,185,129,.14)" : "rgba(16,185,129,.06)";
    if (wrap) wrap.style.borderColor = on ? "rgba(16,185,129,.5)" : "rgba(16,185,129,.25)";
}

function setProofPolicy(value) {
    document.getElementById("proof-policy-value").value = value;
    const allBtn = document.getElementById("policy-all-btn");
    const anyBtn = document.getElementById("policy-any-btn");
    if (value === "ALL") {
        allBtn.style.background   = "rgba(99,102,241,.18)";
        allBtn.style.color        = "#818cf8";
        allBtn.style.borderColor  = "rgba(99,102,241,.5)";
        anyBtn.style.background   = "rgba(255,255,255,.04)";
        anyBtn.style.color        = "var(--text-muted)";
        anyBtn.style.borderColor  = "rgba(255,255,255,.12)";
    } else {
        anyBtn.style.background   = "rgba(99,102,241,.18)";
        anyBtn.style.color        = "#818cf8";
        anyBtn.style.borderColor  = "rgba(99,102,241,.5)";
        allBtn.style.background   = "rgba(255,255,255,.04)";
        allBtn.style.color        = "var(--text-muted)";
        allBtn.style.borderColor  = "rgba(255,255,255,.12)";
    }
}

// ---------------------------------------------------------------------------
// NFT DvP — SELLER REGISTERS OFFER + BUYER ACCEPTANCE POLLING
// ---------------------------------------------------------------------------
let _nftDvpPollTimer = null;

async function registerNftOffer(escrowId) {
    const nftTokenId = document.getElementById("dvp-nft-token-id")?.value.trim();
    if (!nftTokenId) { showStatus("dvp-status", "Please enter the NFT Token ID.", "error"); return; }
    showStatus("dvp-status", "⏳ Verifying NFT sell offer on XRPL...", "info");
    try {
        const res = await safeFetch(`${REFEREE_URL}/escrow/${encodeURIComponent(escrowId)}/nft-offer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ escrow_id: escrowId, nft_token_id: nftTokenId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Failed to register offer.");
        showStatus("dvp-status",
            "✅ Offer verified! The buyer has been notified to accept the NFT. Payment will release automatically once they accept.",
            "success");
        // Start polling for acceptance
        startNftDvpPolling(escrowId);
    } catch(e) {
        showStatus("dvp-status", `❌ ${e.message}`, "error");
    }
}

function startNftDvpPolling(escrowId) {
    if (_nftDvpPollTimer) clearInterval(_nftDvpPollTimer);
    _nftDvpPollTimer = setInterval(async () => {
        try {
            const res  = await safeFetch(`${REFEREE_URL}/escrow/${encodeURIComponent(escrowId)}/nft-status`);
            const data = await res.json();
            if (data.status === "accepted") {
                clearInterval(_nftDvpPollTimer);
                _nftDvpPollTimer = null;
                showStatus("dvp-status", "🎉 NFT accepted by buyer! Payment is being released to your wallet.", "success");
            } else if (data.status === "expired") {
                clearInterval(_nftDvpPollTimer);
                _nftDvpPollTimer = null;
                showStatus("dvp-status", "⚠️ NFT offer expired. Please create a new sell offer and register it again.", "warning");
            }
        } catch (e) { /* ignore transient poll errors */ }
    }, 10000);
}

// ---------------------------------------------------------------------------
// SELLER — Load job info
// ---------------------------------------------------------------------------
async function loadJobInfo(projectId) {
    if (!projectId) return;
    showStatus("job-info-status", "⏳ Loading job details...", "info");

    try {
        const res  = await safeFetch(`${REFEREE_URL}/escrow/${encodeURIComponent(projectId)}`);
        const data = await res.json();

        if (!res.ok) {
            showStatus("job-info-status", `❌ ${data.detail || "Project not found."}`, "error");
            return;
        }

        const infoPanel = document.getElementById("job-info-panel");
        if (infoPanel) {
            infoPanel.style.display = "block";
            document.getElementById("info-buyer").textContent    = data.buyer_name       || "—";
            document.getElementById("info-task").textContent     = data.task_description || "—";
            document.getElementById("info-amount").textContent   = data.display_amount   || "—";
            document.getElementById("info-deadline").textContent = data.deadline         || "—";
            document.getElementById("info-status").textContent   = data.status           || "—";

            // Show submission attempts
            const attRow = document.getElementById("info-attempts-row");
            const attVal = document.getElementById("info-attempts");
            if (attRow && attVal && data.max_submissions != null) {
                attRow.style.display = "flex";
                const used      = data.submission_count    || 0;
                const max       = data.max_submissions     || 3;
                const remaining = data.attempts_remaining  ?? (max - used);
                let attText = `${used} used of ${max} allowed · ${remaining} remaining`;
                if (remaining === 0) {
                    attText = `⛔ No attempts remaining (${used}/${max} used)`;
                    attVal.style.color = "var(--red)";
                } else if (remaining === 1) {
                    attText = `⚠️ ${remaining} attempt remaining (${used}/${max} used)`;
                    attVal.style.color = "var(--amber, #f59e0b)";
                } else {
                    attVal.style.color = "";
                }
                attVal.textContent = attText;
            }

            // Show live USD equivalent for XRP amounts
            const usdRow = document.getElementById("info-amount-usd-row");
            const usdVal = document.getElementById("info-amount-usd");
            if (data.currency === "XRP" && data.amount_xrp && xrpPriceUsd) {
                const usd = (data.amount_xrp * xrpPriceUsd).toFixed(2);
                const gbp = xrpPriceGbp ? ` · £${(data.amount_xrp * xrpPriceGbp).toFixed(2)} GBP` : "";
                if (usdRow) usdRow.style.display = "flex";
                if (usdVal) usdVal.textContent = `$${usd} USD${gbp}`;
            } else if (data.currency === "RLUSD") {
                if (usdRow) usdRow.style.display = "flex";
                if (usdVal) usdVal.textContent = `≈ $${data.amount_rlusd?.toFixed(2)} USD (RLUSD is pegged 1:1)`;
            } else {
                if (usdRow) usdRow.style.display = "none";
            }
        }

        // Trustline warning
        if (data.trustline_warning) {
            showStatus("job-info-status", data.trustline_warning, "warning");
        } else {
            hideStatus("job-info-status");
        }

        // Show DEX quote panel if seller wants RLUSD and escrow is in XRP
        if (data.seller_currency === "RLUSD" && data.currency === "XRP" && data.amount_xrp) {
            await fetchDexQuote(data.worker_address, data.amount_xrp);
        }

        // NFT DvP panel — shown when work passed but awaiting NFT transfer
        const dvpPanel = document.getElementById("nft-dvp-seller-panel");
        if (data.nft_dvp && data.status === "PASS_AWAITING_NFT") {
            if (dvpPanel) {
                dvpPanel.style.display = "block";
            } else {
                // Inject panel dynamically
                const submitSection = document.getElementById("submit-section") || document.getElementById("job-info-panel");
                if (submitSection) {
                    const panel = document.createElement("div");
                    panel.id = "nft-dvp-seller-panel";
                    panel.style.cssText = "margin-top:1rem;padding:1rem;background:rgba(16,185,129,.06);border:1px solid rgba(16,185,129,.2);border-radius:10px;";
                    panel.innerHTML = `
                        <div style="font-size:.85rem;font-weight:700;color:#10b981;margin-bottom:.5rem;">✅ Work passed! Transfer your NFT to release payment.</div>
                        <p style="font-size:.8rem;color:var(--text-muted);margin-bottom:.75rem;">
                            Create an NFTokenCreateOffer in Xaman with:<br>
                            &bull; Destination = ${data.buyer_address || "buyer's wallet"}<br>
                            &bull; Amount = 0 (payment comes from escrow)<br>
                            Then paste the NFT Token ID below.
                        </p>
                        <input type="text" id="dvp-nft-token-id" placeholder="NFT Token ID (64-char hex)" style="width:100%;margin-bottom:.5rem;">
                        <button onclick="registerNftOffer('${projectId}')" style="padding:.55rem 1.2rem;background:#10b981;color:#fff;border:none;border-radius:7px;font-weight:700;cursor:pointer;font-size:.85rem;">Register NFT Offer</button>
                        <div class="status-msg" id="dvp-status" style="margin-top:.5rem;"></div>
                    `;
                    submitSection.parentNode.insertBefore(panel, submitSection.nextSibling);
                }
            }
            // If offer already created, start polling
            if (data.nft_dvp_status === "offer_created") {
                startNftDvpPolling(projectId);
            }
        } else if (dvpPanel) {
            dvpPanel.style.display = "none";
        }

        console.log("✅ Job info loaded:", data);

    } catch (err) {
        showStatus("job-info-status", `❌ Error loading job: ${err.message}`, "error");
    }
}

// ---------------------------------------------------------------------------
// STEP 2 — SUBMIT WORK FOR AUDIT
// ---------------------------------------------------------------------------
async function submitWork() {
    const btn = document.getElementById("submit-btn");

    const projectID   = document.getElementById("worker-project-id")?.value.trim();
    const workProof   = document.getElementById("work-proof")?.value.trim();
    const callbackUrl = document.getElementById("callback-url")?.value.trim() || null;

    const evidenceLinksCheck = Array.from(document.querySelectorAll("#evidence-links-container .evidence-link-input"))
        .map(el => el.value.trim()).filter(Boolean);
    const nftTokenIdCheck = document.getElementById("nft-token-id-field")?.value.trim();
    const vcJwtCheck      = document.getElementById("vc-jwt-field")?.value.trim();

    const hasProof = workProof || evidenceLinksCheck.length > 0 || workerFiles.length > 0 || nftTokenIdCheck || vcJwtCheck;
    if (!projectID || !hasProof) {
        const msg = !projectID
            ? "❌ Please enter your Receipt Code."
            : "❌ Please provide at least one form of proof: a description, URL, file upload, NFT token ID, or Verifiable Credential.";
        showStatus("submit-status", msg, "error");
        return;
    }

    if (btn) btn.disabled = true;
    const evidenceLinks = Array.from(document.querySelectorAll("#evidence-links-container .evidence-link-input"))
        .map(el => el.value.trim()).filter(Boolean);
    const linkMsg = evidenceLinks.length > 0
        ? `⏳ Fetching ${evidenceLinks.length} evidence link${evidenceLinks.length > 1 ? "s" : ""} and submitting for AI audit…`
        : "⏳ Submitting work for AI audit...";
    showStatus("submit-status", linkMsg, "info");

    const nftTokenId          = document.getElementById("nft-token-id-field")?.value.trim() || null;
    const nftWallet           = document.getElementById("nft-wallet-field")?.value.trim() || null;
    const vcJwt               = document.getElementById("vc-jwt-field")?.value.trim() || null;

    const submitBody = JSON.stringify({
        escrow_id:          projectID,
        work:               workProof,
        callback_url:       callbackUrl,
        worker_attachments: workerFiles.filter(f => f.data).map(f => ({
            filename: f.filename, mime_type: f.mime_type, data: f.data,
        })),
        evidence_links: evidenceLinks,
        nft_token_id:          nftTokenId          || undefined,
        nft_wallet:            nftWallet            || undefined,
        vc_jwt:                vcJwt                || undefined,
    });

    const MAX_RETRIES = 5;
    let res;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            res = await safeFetch(`${REFEREE_URL}/evaluate`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: submitBody,
            });
            break; // success — exit retry loop
        } catch (err) {
            if (attempt < MAX_RETRIES) {
                showStatus("submit-status",
                    `⏳ Server is waking up… (attempt ${attempt}/${MAX_RETRIES}) — this can take up to 30 seconds.`,
                    "info");
                await new Promise(r => setTimeout(r, 4000));
            } else {
                throw err; // rethrow after final attempt
            }
        }
    }

    try {

        const result = await res.json();
        console.log("📋 Audit response:", result);

        if (res.status === 429) {
            // Submission limit reached — offer purchase option
            const projectID = document.getElementById("worker-project-id")?.value.trim();
            showStatus(
                "submit-status",
                `⛔ Submission limit reached.\n\n${result.detail}`,
                "error"
            );
            showPurchaseAttemptPanel(projectID);
            if (btn) btn.disabled = false;
            return;
        }

        if (!res.ok) throw new Error(result.detail || "Audit request failed.");

        lastEvaluateResult = result;
        const verdict      = result.verdict;

        // NFT DvP — work passed but awaiting NFT transfer
        if (result.status === "pass_awaiting_nft") {
            showVerdictPanel(verdict);
            showStatus("submit-status",
                `✅ Work PASSED! Score: ${verdict?.score}/100\n\n` +
                `🔄 NFT Delivery required before payment releases.\n\n` +
                (result.nft_dvp_instructions || "Create an NFTokenCreateOffer in Xaman and register it below."),
                "success");
            // Inject NFT DvP panel below submit section
            const existingDvpPanel = document.getElementById("nft-dvp-seller-panel");
            if (!existingDvpPanel) {
                const submitSection = document.getElementById("submit-status");
                if (submitSection && submitSection.parentNode) {
                    const panel = document.createElement("div");
                    panel.id = "nft-dvp-seller-panel";
                    panel.style.cssText = "margin-top:1rem;padding:1rem;background:rgba(16,185,129,.06);border:1px solid rgba(16,185,129,.2);border-radius:10px;";
                    panel.innerHTML = `
                        <div style="font-size:.85rem;font-weight:700;color:#10b981;margin-bottom:.5rem;">🔄 Register your NFT sell offer</div>
                        <p style="font-size:.8rem;color:var(--text-muted);margin-bottom:.75rem;">
                            In Xaman: create an NFTokenCreateOffer<br>
                            &bull; Destination = ${result.buyer_address || "buyer's wallet"}<br>
                            &bull; Amount = 0<br>
                            Then paste the NFT Token ID below.
                        </p>
                        <input type="text" id="dvp-nft-token-id" placeholder="NFT Token ID (64-char hex)" style="width:100%;margin-bottom:.5rem;">
                        <button onclick="registerNftOffer('${result.escrow_id}')" style="padding:.55rem 1.2rem;background:#10b981;color:#fff;border:none;border-radius:7px;font-weight:700;cursor:pointer;font-size:.85rem;">Register NFT Offer</button>
                        <div class="status-msg" id="dvp-status" style="margin-top:.5rem;"></div>
                    `;
                    submitSection.parentNode.insertBefore(panel, submitSection.nextSibling);
                }
            }
            if (btn) btn.disabled = false;
            return;
        }

        if (result.status === "approved") {
            showVerdictPanel(verdict);

            if (result.auto_finish_queued) {
                // ── Happy path: payment is being released automatically ──
                showStatus(
                    "submit-status",
                    `✅ APPROVED! Score: ${verdict.score}/100\n\n` +
                    `🎉 Payment is being released to your wallet automatically — no further action needed.\n` +
                    `${verdict.summary}`,
                    "success"
                );

                // Show DEX swap option if seller wants RLUSD and there's a quote
                if (result.seller_currency === "RLUSD" && result.dex_quote_rlusd) {
                    showDexSwapPanel(result);
                }

                // Show a minimal receipt / fallback section
                showAutoFinishReceipt(result);

            } else {
                // ── Fallback: auto-finish couldn't run (missing sequence etc.) ──
                showStatus(
                    "submit-status",
                    `✅ APPROVED! Score: ${verdict.score}/100\n${verdict.summary}\n\n` +
                    `⚠️ Automatic payment release unavailable — please claim manually below.`,
                    "warning"
                );
                showManualClaimSection(result);
            }

        } else {
            showStatus(
                "submit-status",
                `❌ REJECTED — Score: ${verdict.score}/100\n${verdict.summary}`,
                "error"
            );
            showVerdictPanel(verdict);
        }

    } catch (err) {
        showStatus("submit-status", `❌ ${err.message}`, "error");
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ---------------------------------------------------------------------------
// VERDICT PANEL
// ---------------------------------------------------------------------------
function showVerdictPanel(verdict) {
    const panel = document.getElementById("verdict-panel");
    if (!panel) return;
    panel.style.display = "block";

    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || "—"; };
    setEl("verdict-result",  verdict.verdict);
    setEl("verdict-score",   `${verdict.score}/100`);
    setEl("verdict-summary", verdict.summary);
    setEl("verdict-details", verdict.details);

    const metEl    = document.getElementById("verdict-met");
    const failedEl = document.getElementById("verdict-failed");
    if (metEl    && verdict.criteria_met?.length)    metEl.innerHTML    = verdict.criteria_met.map(c    => `<li>✓ ${c}</li>`).join("");
    if (failedEl && verdict.criteria_failed?.length) failedEl.innerHTML = verdict.criteria_failed.map(c => `<li>✕ ${c}</li>`).join("");

    const header = document.getElementById("verdict-header");
    const badge  = document.getElementById("verdict-result");
    if (header) { header.classList.remove("pass", "fail"); header.classList.add(verdict.verdict === "PASS" ? "pass" : "fail"); }
    if (badge)  { badge.classList.remove("pass", "fail");  badge.classList.add(verdict.verdict  === "PASS" ? "pass" : "fail"); }
}

// ---------------------------------------------------------------------------
// AUTO-FINISH RECEIPT (shown after auto-finish is queued)
// ---------------------------------------------------------------------------
function showAutoFinishReceipt(result) {
    const section = document.getElementById("auto-finish-receipt");
    if (!section) return;
    section.style.display = "block";

    const amountStr = result.currency === "RLUSD"
        ? `${result.amount_rlusd} RLUSD (≈ $${result.amount_rlusd?.toFixed(2)} USD)`
        : `${result.amount_xrp} XRP${xrpPriceUsd ? ` (≈ $${(result.amount_xrp * xrpPriceUsd).toFixed(2)} USD)` : ""}`;

    const addrEl = document.getElementById("receipt-worker-address");
    const amtEl  = document.getElementById("receipt-amount");
    if (addrEl) addrEl.textContent = result.worker_address || "—";
    if (amtEl)  amtEl.textContent  = amountStr;

    if (window.lucide) lucide.createIcons();
}

// ---------------------------------------------------------------------------
// DEX SWAP PANEL (shown when seller wants RLUSD, auto-finish delivered XRP)
// ---------------------------------------------------------------------------
function showDexSwapPanel(result) {
    const panel = document.getElementById("dex-swap-panel");
    if (!panel) return;
    panel.style.display = "block";

    const quoteEl = document.getElementById("dex-swap-quote");
    if (quoteEl && result.dex_quote_rlusd) {
        quoteEl.textContent =
            `~${result.dex_quote_rlusd.toFixed(4)} RLUSD for ${result.amount_xrp} XRP`;
    }

    // Store data for the swap button
    panel.dataset.xrpAmount    = result.amount_xrp;
    panel.dataset.workerAddr   = result.worker_address;
    panel.dataset.rlusdIssuer  = result.rlusd_issuer || "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
    panel.dataset.estimatedRlusd = result.dex_quote_rlusd;

    if (window.lucide) lucide.createIcons();
}

async function triggerDexSwap() {
    const panel = document.getElementById("dex-swap-panel");
    if (!panel) return;

    const xrpAmount      = parseFloat(panel.dataset.xrpAmount);
    const workerAddress  = panel.dataset.workerAddr;
    const rlusdIssuer    = panel.dataset.rlusdIssuer;
    const estimatedRlusd = parseFloat(panel.dataset.estimatedRlusd);

    if (!xrpAmount || !workerAddress || !estimatedRlusd) {
        showStatus("dex-swap-status", "❌ Missing quote data. Please refresh.", "error");
        return;
    }

    showStatus("dex-swap-status", "⏳ Opening Xaman for RLUSD swap...", "info");

    const minRlusd = (estimatedRlusd * 0.98).toFixed(6);

    const offerTx = {
        TransactionType: "OfferCreate",
        TakerPays: { currency: "RLUSD", issuer: rlusdIssuer, value: minRlusd },
        TakerGets: String(Math.floor(xrpAmount * 1_000_000)),
    };

    try {
        const res  = await safeFetch(`${REFEREE_URL}/xumm/create-payload`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ txjson: offerTx }),
        });
        const data = await res.json();
        if (data.nextUrl) {
            window.open(data.nextUrl, "_blank");
            showStatus(
                "dex-swap-status",
                `✅ Xaman opened — sign to receive ~${estimatedRlusd.toFixed(4)} RLUSD\n(minimum ${minRlusd} RLUSD with 2% slippage protection)`,
                "success"
            );
        } else {
            throw new Error("Xaman did not return a sign URL.");
        }
    } catch (err) {
        showStatus("dex-swap-status", `❌ Swap failed: ${err.message}`, "error");
    }
}

// ---------------------------------------------------------------------------
// MANUAL CLAIM SECTION (fallback only)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// PURCHASE EXTRA SUBMISSION ATTEMPT
// ---------------------------------------------------------------------------
function showPurchaseAttemptPanel(escrowId) {
    // Insert a purchase panel into the submit area if not already present
    let panel = document.getElementById("purchase-attempt-panel");
    if (!panel) {
        panel = document.createElement("div");
        panel.id = "purchase-attempt-panel";
        panel.className = "info-callout";
        panel.style.cssText = "margin-top:1rem;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);";
        const submitBtn = document.getElementById("submit-btn");
        submitBtn?.parentNode?.insertBefore(panel, submitBtn.nextSibling);
    }
    panel.innerHTML = `
        <i data-lucide="zap" style="color:var(--amber,#f59e0b);flex-shrink:0;"></i>
        <div>
            <strong>Need another attempt?</strong> Pay 0.05 XRP to unlock one more submission.
            <div style="margin-top:.6rem;display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn btn-secondary btn-sm" id="buy-attempt-btn" onclick="purchaseExtraAttempt('${escrowId}')">
                    <i data-lucide="plus-circle"></i> Buy extra attempt (0.05 XRP)
                </button>
            </div>
            <div class="status-msg" id="purchase-attempt-status" style="margin-top:.5rem;"></div>
        </div>`;
    lucide.createIcons();
}

async function purchaseExtraAttempt(escrowId) {
    const btn = document.getElementById("buy-attempt-btn");
    if (btn) btn.disabled = true;
    showStatus("purchase-attempt-status", "⏳ Opening Xaman to pay 0.05 XRP…", "info");

    try {
        // Request a fee payload for 0.05 XRP
        const res  = await safeFetch(`${REFEREE_URL}/xumm/fee-payload`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ amount_xrp: 0.05 }),
        });
        const data = await res.json();
        if (!data.nextUrl) throw new Error("No Xaman URL returned.");

        window.open(data.nextUrl, "_blank");
        showStatus("purchase-attempt-status", "Sign the 0.05 XRP payment in Xaman, then wait…", "info");

        // Poll until signed
        let attempts = 0;
        const poll = setInterval(async () => {
            attempts++;
            if (attempts > 60) { clearInterval(poll); showStatus("purchase-attempt-status", "Timed out waiting for payment.", "error"); return; }
            try {
                const pr   = await safeFetch(`${REFEREE_URL}/xumm/payload/${data.uuid}`);
                const pd   = await pr.json();
                if (pd.signed && pd.tx_hash) {
                    clearInterval(poll);
                    // Submit purchase
                    const cr = await safeFetch(`${REFEREE_URL}/evaluate/purchase-attempt`, {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ escrow_id: escrowId, fee_hash: pd.tx_hash }),
                    });
                    const cd = await cr.json();
                    if (!cr.ok) throw new Error(cd.detail || "Purchase failed.");
                    showStatus("purchase-attempt-status",
                        `✅ Extra attempt unlocked! You now have ${cd.attempts_remaining} attempt${cd.attempts_remaining !== 1 ? "s" : ""} remaining.`,
                        "success"
                    );
                    // Remove the panel and re-enable submit
                    const panel = document.getElementById("purchase-attempt-panel");
                    if (panel) panel.remove();
                    const submitBtn = document.getElementById("submit-btn");
                    if (submitBtn) submitBtn.disabled = false;
                    // Reload job info to show updated count
                    loadJobInfo(escrowId);
                }
            } catch(e) {
                clearInterval(poll);
                showStatus("purchase-attempt-status", `❌ ${e.message}`, "error");
                if (btn) btn.disabled = false;
            }
        }, 3000);

    } catch(err) {
        showStatus("purchase-attempt-status", `❌ ${err.message}`, "error");
        if (btn) btn.disabled = false;
    }
}

function showManualClaimSection(result) {
    const section = document.getElementById("claim-section");
    if (!section) return;
    section.style.display = "block";

    section.dataset.fulfillment   = result.fulfillment;
    section.dataset.workerAddress = result.worker_address;
    section.dataset.condition     = result.condition;

    if (result.escrow_sequence) {
        const seqField = document.getElementById("escrow-sequence");
        if (seqField) seqField.value = result.escrow_sequence;
    }
    if (result.buyer_address) {
        const ownerField = document.getElementById("escrow-owner");
        if (ownerField) ownerField.value = result.buyer_address;
    }
}

async function claimFromPanel() {
    const section = document.getElementById("claim-section");
    const seq     = document.getElementById("escrow-sequence")?.value.trim();
    const owner   = document.getElementById("escrow-owner")?.value.trim();

    if (!section || !seq || !owner) {
        showStatus("claim-status", "❌ Escrow sequence and buyer wallet are required.", "error");
        return;
    }

    showStatus("claim-status", "⏳ Opening Xaman to claim...", "info");

    try {
        const finishTx = {
            TransactionType: "EscrowFinish",
            Account:         section.dataset.workerAddress,
            Owner:           owner,
            OfferSequence:   parseInt(seq),
            Fulfillment:     section.dataset.fulfillment?.toUpperCase(),
            Condition:       section.dataset.condition?.toUpperCase(),
            Fee:             "5000",
        };

        const res  = await safeFetch(`${REFEREE_URL}/xumm/create-payload`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ txjson: finishTx }),
        });
        const data = await res.json();

        if (data.nextUrl) {
            window.open(data.nextUrl, "_blank");
            showStatus("claim-status", "✅ Xaman opened — sign to claim your payment.", "success");
        } else {
            throw new Error("Xaman did not return a sign URL.");
        }
    } catch (err) {
        showStatus("claim-status", `❌ ${err.message}`, "error");
    }
}

// ---------------------------------------------------------------------------
// DEX QUOTE (pre-submission display)
// ---------------------------------------------------------------------------
async function fetchDexQuote(workerAddress, xrpAmount) {
    if (!workerAddress || !xrpAmount) return;

    const quotePanel = document.getElementById("dex-quote-panel");
    const quoteText  = document.getElementById("dex-quote-text");
    const trustWarn  = document.getElementById("dex-trust-warning");

    if (quotePanel) quotePanel.style.display = "block";
    if (quoteText)  quoteText.textContent    = "⏳ Fetching live quote...";
    if (trustWarn)  trustWarn.style.display  = "none";

    try {
        const res  = await safeFetch(`${REFEREE_URL}/dex/quote`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ worker_address: workerAddress, xrp_amount: xrpAmount }),
        });
        const data = await res.json();
        dexQuoteData = data;

        if (!data.trust_line_ok) {
            if (quoteText) quoteText.textContent = "⚠️ No RLUSD trust line found on your wallet.";
            if (trustWarn) { trustWarn.style.display = "block"; trustWarn.textContent = data.trust_line_instructions; }
            return;
        }
        if (data.estimated_rlusd) {
            const rate = (data.estimated_rlusd / data.xrp_amount).toFixed(4);
            if (quoteText) quoteText.textContent =
                `~${data.estimated_rlusd.toFixed(4)} RLUSD for ${data.xrp_amount} XRP` +
                `  (rate: 1 XRP ≈ ${rate} RLUSD)` +
                (data.slippage_warning ? "  ⚠️ High slippage detected" : "");
        } else {
            if (quoteText) quoteText.textContent = "⚠️ No liquidity path found. Consider receiving XRP instead.";
        }
    } catch (err) {
        if (quoteText) quoteText.textContent = "❌ Could not fetch quote.";
    }
}

function onSellerCurrencyChange() {
    const currency   = document.getElementById("payout-currency")?.value;
    const quotePanel = document.getElementById("dex-quote-panel");
    if (currency === "RLUSD") {
        if (quotePanel) quotePanel.style.display = "block";
        const quoteText = document.getElementById("dex-quote-text");
        if (quoteText) quoteText.textContent = "Look up your Receipt Code above to see a live quote.";
    } else {
        if (quotePanel) quotePanel.style.display = "none";
        dexQuoteData = null;
    }
}

// ---------------------------------------------------------------------------
// COPY HELPERS
// ---------------------------------------------------------------------------
function copyProjectId() {
    const id = document.getElementById("share-project-id")?.textContent?.trim();
    if (!id) return;
    navigator.clipboard.writeText(id).then(() => {
        const btn = document.getElementById("copy-btn");
        if (btn) {
            btn.innerHTML = '<i data-lucide="check"></i> Copied!';
            if (window.lucide) lucide.createIcons();
            setTimeout(() => {
                btn.innerHTML = '<i data-lucide="copy"></i> Copy Code';
                if (window.lucide) lucide.createIcons();
            }, 2000);
        }
    });
}

function copyWorkerLink() {
    const id = document.getElementById("share-project-id")?.textContent?.trim();
    if (!id) return;
    const link = `${window.location.origin}${window.location.pathname}?worker=${encodeURIComponent(id)}`;
    navigator.clipboard.writeText(link).then(() => {
        showStatus("init-status", `✅ Seller link copied!\n${link}`, "success");
    });
}

// ---------------------------------------------------------------------------
// COLLECT DELIVERY PAGE
// ---------------------------------------------------------------------------
const REFEREE_URL_COLLECT = "https://xrpl-referee.onrender.com";

async function loadDelivery(escrowId) {
    document.getElementById("hero-section").style.display = "none";
    document.getElementById("main-tabs").style.display    = "none";
    document.getElementById("panel-buyer").style.display  = "none";
    document.getElementById("panel-worker").style.display = "none";
    document.querySelectorAll(".flow-section, .compare-section, .use-cases-title, .use-cases")
        .forEach(el => el.style.display = "none");

    const panel   = document.getElementById("collect-panel");
    const loading = document.getElementById("collect-loading");
    const error   = document.getElementById("collect-error");
    const content = document.getElementById("collect-content");
    const expired = document.getElementById("collect-expired");

    panel.style.display = "block";
    lucide.createIcons();

    try {
        const res  = await fetch(`${REFEREE_URL_COLLECT}/escrow/${encodeURIComponent(escrowId)}/delivery`);
        const data = await res.json();
        loading.style.display = "none";

        if (res.status === 410) {
            expired.style.display = "block";
            document.getElementById("collect-expired-id").textContent = escrowId;
            lucide.createIcons();
            return;
        }
        if (!res.ok) {
            error.style.display = "block";
            error.textContent   = data.detail || "Could not load delivery.";
            return;
        }

        content.style.display = "block";

        if (data.delivered_at) {
            document.getElementById("collect-delivered-at").textContent =
                "Delivered " + new Date(data.delivered_at).toLocaleString("en-GB", {dateStyle:"long", timeStyle:"short"});
        }

        const v = data.verdict || {};
        document.getElementById("collect-score").textContent   = v.score != null ? `Score: ${v.score}/100` : "";
        document.getElementById("collect-summary").textContent = v.summary || "";
        document.getElementById("collect-work-text").textContent = data.work || "(no text submitted)";

        // Show auto-finish tx hash if available
        if (data.auto_finish_hash) {
            const hashEl = document.getElementById("collect-tx-hash");
            if (hashEl) {
                hashEl.style.display = "block";
                hashEl.innerHTML = `Payment tx: <a href="https://livenet.xrpl.org/transactions/${data.auto_finish_hash}" target="_blank" style="color:var(--blue);font-family:monospace;">${data.auto_finish_hash.substring(0, 20)}…</a>`;
            }
        }

        const atts = data.attachments || [];
        if (atts.length > 0) {
            document.getElementById("collect-attachments-section").style.display = "block";
            document.getElementById("collect-attachments-list").innerHTML = atts.map(a => {
                if (a.data) {
                    const blob = b64toBlob(a.data, a.mime_type);
                    const url  = URL.createObjectURL(blob);
                    return `<a href="${url}" download="${a.filename}" style="display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.7);border:1px solid rgba(255,255,255,.85);border-radius:8px;padding:6px 12px;font-size:.78rem;font-weight:600;text-decoration:none;color:var(--text);">
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0066FF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        ${a.filename}</a>`;
                }
                return `<div style="display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.7);border-radius:8px;padding:6px 12px;font-size:.78rem;color:var(--text-muted);">📎 ${a.filename}</div>`;
            }).join("");
        }

        if (data.expires_at) {
            const exp      = new Date(data.expires_at);
            const daysLeft = Math.ceil((exp - new Date()) / 86400000);
            document.getElementById("collect-expiry-text").textContent =
                `This delivery will be permanently deleted on ${exp.toLocaleString("en-GB", {dateStyle:"long", timeStyle:"short"})} (${daysLeft} day${daysLeft !== 1 ? "s" : ""} remaining). Please save any files you need.`;
        }

        lucide.createIcons();

    } catch(e) {
        loading.style.display = "none";
        error.style.display   = "block";
        error.textContent     = "Network error loading delivery. Please try again.";
        console.error(e);
    }
}

function b64toBlob(b64, mimeType) {
    const bytes = atob(b64);
    const arr   = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], {type: mimeType});
}

// Auto-trigger from URL params
(function() {
    const params      = new URLSearchParams(window.location.search);
    const collectId   = params.get("collect");
    const workerId    = params.get("worker");
    const workerEmail = params.get("worker_email");
    const amount      = params.get("amount");
    if (collectId) {
        loadDelivery(collectId.trim().toUpperCase());
    } else if (workerId) {
        switchTab("worker");
        const f = document.getElementById("worker-project-id");
        if (f) { f.value = workerId; loadJobInfo(workerId); }
    }
    if (workerEmail) {
        const ef = document.getElementById("worker-email-field");
        if (ef) ef.value = decodeURIComponent(workerEmail);
    }
    if (amount) {
        const af = document.getElementById("amt");
        if (af && !af.value) af.value = amount;
    }
})();

// ---------------------------------------------------------------------------
// DYNAMIC LINK FIELDS (spec links + evidence links)
// ---------------------------------------------------------------------------
function addLinkField(containerId, btnId, maxExtra) {
    const container = document.getElementById(containerId);
    const btn       = document.getElementById(btnId);
    if (!container || !btn) return;
    const current = container.querySelectorAll("input").length;
    if (current >= maxExtra + 1) return;  // already at max (1 default + maxExtra added)

    const input = document.createElement("input");
    input.type  = "url";
    input.className = containerId.startsWith("spec") ? "spec-link-input" : "evidence-link-input";
    input.placeholder = `https://… link ${current + 1} (optional)`;
    input.style.marginBottom = "6px";
    container.appendChild(input);

    // Hide button if at max
    if (container.querySelectorAll("input").length >= maxExtra + 1) {
        btn.style.display = "none";
    }
    if (window.lucide) lucide.createIcons();
}

// ---------------------------------------------------------------------------
// GLEIF COMPANY SEARCH
// ---------------------------------------------------------------------------
let _gleifTimer = null;
async function gleifSearch(query, resultsId, targetId) {
    const resultsEl = document.getElementById(resultsId);
    if (!query || query.length < 3) { if (resultsEl) resultsEl.style.display = "none"; return; }

    // If it looks like an XRPL address, use directly
    if (query.startsWith("r") && query.length > 20) {
        const target = document.getElementById(targetId);
        if (target) target.value = query;
        if (resultsEl) resultsEl.style.display = "none";
        return;
    }

    clearTimeout(_gleifTimer);
    _gleifTimer = setTimeout(async () => {
        try {
            // Query AgentTrust registry and GLEIF in parallel
            const [registryRes, gleifRes] = await Promise.allSettled([
                safeFetch(`${REFEREE_URL}/nft/issuers?limit=50`),
                safeFetch(`${REFEREE_URL}/gleif/search?q=${encodeURIComponent(query)}&limit=8`),
            ]);

            // AgentTrust registered issuers — filter client-side by query
            let registryItems = [];
            if (registryRes.status === "fulfilled") {
                const d = await registryRes.value.json();
                const q = query.toLowerCase();
                registryItems = (d.issuers || [])
                    .filter(i => i.name?.toLowerCase().includes(q) || i.wallet_address?.toLowerCase().includes(q) || i.category?.toLowerCase().includes(q))
                    .map(i => ({ source: "registry", lei: null, name: i.name, wallet: i.wallet_address, category: i.category }));
            }

            // GLEIF legal entities
            let gleifItems = [];
            if (gleifRes.status === "fulfilled") {
                const d = await gleifRes.value.json();
                gleifItems = (d.results || []).map(r => ({ source: "gleif", lei: r.lei, name: r.name, wallet: null, category: null }));
            }

            const combined = [...registryItems, ...gleifItems].slice(0, 10);
            if (!resultsEl) return;
            if (!combined.length) { resultsEl.style.display = "none"; return; }

            resultsEl.innerHTML = combined.map(r => {
                const nameEsc = r.name.replace(/'/g, "\\'");
                const badge = r.source === "registry"
                    ? `<span style="font-size:.65rem;padding:1px 6px;border-radius:10px;background:rgba(16,185,129,.15);color:#10b981;border:1px solid rgba(16,185,129,.25);">AgentTrust${r.category ? " · " + r.category : ""}</span>`
                    : `<span style="font-size:.65rem;padding:1px 6px;border-radius:10px;background:rgba(99,102,241,.12);color:#818cf8;border:1px solid rgba(99,102,241,.2);">GLEIF · LEI ${r.lei}</span>`;
                const clickVal = r.wallet || r.lei || "";
                return `<div onclick="selectGleifResult('${clickVal}','${nameEsc}','${targetId}','${resultsId}',${r.wallet ? `'${r.wallet}'` : 'null'})"
                     style="padding:8px 12px;cursor:pointer;font-size:.8rem;border-bottom:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column;gap:3px;"
                     onmouseover="this.style.background='rgba(255,255,255,.06)'" onmouseout="this.style.background=''">
                    <div style="font-weight:600;">${r.name}</div>
                    <div>${badge}</div>
                </div>`;
            }).join("");
            resultsEl.style.display = "block";
        } catch(e) { if (resultsEl) resultsEl.style.display = "none"; }
    }, 350);
}

async function selectGleifResult(lei, name, targetId, resultsId, knownWallet) {
    const resultsEl = document.getElementById(resultsId);
    if (resultsEl) resultsEl.style.display = "none";
    const searchInput = resultsEl ? resultsEl.previousElementSibling : null;
    if (searchInput) searchInput.value = name;

    const target = document.getElementById(targetId);
    const statusId = resultsId + "-status";
    let statusEl = document.getElementById(statusId);
    if (!statusEl && resultsEl) {
        statusEl = document.createElement("div");
        statusEl.id = statusId;
        statusEl.style.cssText = "font-size:.72rem;color:#10b981;margin-top:.3rem;";
        resultsEl.parentNode.appendChild(statusEl);
    }

    // Registry hit: wallet already known
    if (knownWallet) {
        if (target) target.value = knownWallet;
        if (statusEl) statusEl.textContent = "✅ AgentTrust verified issuer · XRPL wallet set";
        return;
    }

    // GLEIF hit: attempt XRPL wallet lookup via domain chain
    if (target) target.value = lei || "";
    try {
        const res = await safeFetch(`${REFEREE_URL}/gleif/xrpl-lookup?q=${encodeURIComponent(name)}`);
        const data = await res.json();
        const match = data.results?.find(r => r.lei === lei);
        if (match?.xrpl_wallet && target) {
            target.value = match.xrpl_wallet;
            if (statusEl) statusEl.innerHTML = "✅ GLEIF verified · XRPL wallet found";
        } else {
            // Clear the hidden field — LEI is not a valid issuer wallet
            if (target) target.value = "";
            // Show manual wallet input
            if (statusEl) {
                statusEl.innerHTML = `
                    <span style="color:#f59e0b;">⚠️ GLEIF verified company — but no XRPL wallet on record.</span>
                    <br>If you know their XRPL wallet address, paste it below:
                    <input type="text" placeholder="rXXX… issuer wallet address"
                        style="margin-top:5px;width:100%;font-size:.78rem;padding:5px 8px;border-radius:6px;background:rgba(255,255,255,.06);border:1px solid rgba(245,158,11,.3);color:var(--text);"
                        oninput="document.getElementById('${targetId}').value=this.value.trim()">
                    <span style="font-size:.68rem;color:var(--text-muted);">Leave blank to skip NFT issuer verification.</span>`;
            }
        }
    } catch(e) {
        if (target) target.value = "";
        if (statusEl) statusEl.textContent = "⚠️ Could not look up XRPL wallet — paste the issuer wallet address manually if known.";
    }
}
