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
    const res         = await fetch(url, options);
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
        const body = await res.text();
        throw new Error(`Server returned ${res.status} — expected JSON:\n${body.substring(0, 200)}`);
    }
    return res;
}

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

// ---------------------------------------------------------------------------
// STEP 1A — PAY PROTOCOL FEE
// ---------------------------------------------------------------------------
async function payFee() {
    const btn = document.getElementById("pay-fee-btn");
    if (btn) btn.disabled = true;
    showStatus("fee-status", "⏳ Opening Xaman for fee payment...", "info");
    try {
        const res  = await safeFetch(`${REFEREE_URL}/xumm/fee-payload`, { method: "POST" });
        const data = await res.json();
        if (!data.nextUrl) throw new Error("Xaman did not return a sign URL.");
        feePayloadUUID = data.uuid;
        window.open(data.nextUrl, "_blank");
        showStatus("fee-status", "Xaman opened — sign the 0.1 XRP payment, then return here.", "info");
        feePollingTimer = setInterval(pollFeePayment, 3000);
    } catch (err) {
        showStatus("fee-status", `❌ Error: ${err.message}`, "error");
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
    const recipient    = document.getElementById("recipient")?.value.trim();
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

    const receiptCode = generateReceiptCode();
    if (btn) btn.disabled = true;
    showStatus("init-status", "⏳ Verifying fee and creating vault...", "info");

    try {
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
            spec_links: [
                document.getElementById("spec-link-1")?.value.trim(),
                document.getElementById("spec-link-2")?.value.trim(),
                document.getElementById("spec-link-3")?.value.trim(),
            ].filter(Boolean),
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

    if (!projectID || !workProof) {
        showStatus("submit-status", "❌ Please enter your Receipt Code and proof of work.", "error");
        return;
    }

    if (btn) btn.disabled = true;
    const evidenceLinks = [
        document.getElementById("evidence-link-1")?.value.trim(),
        document.getElementById("evidence-link-2")?.value.trim(),
        document.getElementById("evidence-link-3")?.value.trim(),
    ].filter(Boolean);
    const linkMsg = evidenceLinks.length > 0
        ? `⏳ Fetching ${evidenceLinks.length} evidence link${evidenceLinks.length > 1 ? "s" : ""} and submitting for AI audit…`
        : "⏳ Submitting work for AI audit...";
    showStatus("submit-status", linkMsg, "info");

    try {
        const res = await safeFetch(`${REFEREE_URL}/evaluate`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                escrow_id:          projectID,
                work:               workProof,
                callback_url:       callbackUrl,
                worker_attachments: workerFiles.filter(f => f.data).map(f => ({
                    filename: f.filename, mime_type: f.mime_type, data: f.data,
                })),
                evidence_links: [
                    document.getElementById("evidence-link-1")?.value.trim(),
                    document.getElementById("evidence-link-2")?.value.trim(),
                    document.getElementById("evidence-link-3")?.value.trim(),
                ].filter(Boolean),
            }),
        });

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
        const res  = await safeFetch(`${REFEREE_URL}/xumm/fee-payload`, { method: "POST" });
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
    const params    = new URLSearchParams(window.location.search);
    const collectId = params.get("collect");
    const workerId  = params.get("worker");
    if (collectId) {
        loadDelivery(collectId.trim().toUpperCase());
    } else if (workerId) {
        switchTab("worker");
        const f = document.getElementById("worker-project-id");
        if (f) { f.value = workerId; loadJobInfo(workerId); }
    }
})();
