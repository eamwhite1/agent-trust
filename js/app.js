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

    // Check total size across all files in this array
    const currentTotal = targetArray.reduce((sum, f) => sum + (f.size || 0), 0);
    if (currentTotal + file.size > MAX_TOTAL_SIZE_MB * 1024 * 1024) {
        alert(`Adding "${file.name}" would exceed the ${MAX_TOTAL_SIZE_MB} MB total limit. Please remove some files first.`);
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
            // DOCX / TXT / MD — extract as plain text, append to textarea
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
        jpg:  "image/jpeg",
        jpeg: "image/jpeg",
        png:  "image/png",
        gif:  "image/gif",
        webp: "image/webp",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        txt:  "text/plain",
        md:   "text/markdown",
    };
    return map[ext] || "application/octet-stream";
}

function formatBytes(bytes) {
    if (bytes < 1024)           return `${bytes} B`;
    if (bytes < 1024 * 1024)   return `${(bytes / 1024).toFixed(1)} KB`;
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
        e.preventDefault();
        zone.classList.remove("drag-over");
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
let feePayloadUUID    = null;
let feePollingTimer   = null;
let buyerWalletAddress = null;

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
    const btnAuto       = document.getElementById("btn-auto");
    const btnManual     = document.getElementById("btn-manual");
    if (!manualSection) return;
    if (mode === "manual") {
        manualSection.style.display = "block";
        btnManual?.classList.add("active");
        btnAuto?.classList.remove("active");
    } else {
        manualSection.style.display = "none";
        btnAuto?.classList.add("active");
        btnManual?.classList.remove("active");
    }
}

// Generates a unique human-readable code like AT-7X9K-2MQ4
function generateReceiptCode() {
    const chars   = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/I/1
    const segment = (len) => Array.from(
        crypto.getRandomValues(new Uint8Array(len)),
        b => chars[b % chars.length]
    ).join("");
    return `AT-${segment(4)}-${segment(4)}`;
}

// ---------------------------------------------------------------------------
// SAFE FETCH — gives readable errors when server returns non-JSON
// ---------------------------------------------------------------------------
async function safeFetch(url, options = {}) {
    const res         = await fetch(url, options);
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
        const body = await res.text();
        throw new Error(
            `Server returned ${res.status} (${res.statusText}) — expected JSON but got:\n${body.substring(0, 200)}`
        );
    }
    return res;
}

// ---------------------------------------------------------------------------
// DOM READY
// ---------------------------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
    initDropZone("buyer-drop-zone",  buyerFiles,  "buyer-file-list",  "job-description", "Buyer Spec");
    initDropZone("worker-drop-zone", workerFiles, "worker-file-list", "work-proof",       "Worker Proof");

    const amtField = document.getElementById("amt");
    if (amtField) amtField.addEventListener("input", updateFeeDisplay);

    setPaymentMode("auto");
});

// ---------------------------------------------------------------------------
// STEP 1A — PAY PROTOCOL FEE (Buyer via Xaman)
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
        showStatus("fee-status", "Opening Xaman — sign the 0.1 XRP payment, then return here.", "info");

        feePollingTimer = setInterval(pollFeePayment, 3000);

    } catch (err) {
        console.error("Fee payload error:", err);
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
            console.log("✅ Fee payment confirmed. TX hash:", data.tx_hash);

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
// STEP 1B — INITIALIZE VAULT (Buyer)
// ---------------------------------------------------------------------------
async function initVault() {
    const btn = document.getElementById("init-btn");

    const buyerName    = document.getElementById("buyer-name")?.value.trim();
    const buyerEmail   = document.getElementById("buyer-email")?.value.trim() || null;
    const workerEmail  = document.getElementById("worker-email-field")?.value.trim() || null;
    const projectLabel = document.getElementById("project-label")?.value.trim() || null;
    const taskDesc     = document.getElementById("job-description")?.value.trim();
    const recipient    = document.getElementById("recipient")?.value.trim();
    const amountXRP    = document.getElementById("amt")?.value;
    const feeHash      = document.getElementById("audit-fee-hash")?.value.trim();
    const cancelHrs    = parseInt(document.getElementById("cancel-hours")?.value || "168");

    if (!buyerName || !projectLabel || !taskDesc || !recipient || !amountXRP) {
        showStatus("init-status", "❌ Please fill in all required fields including Project Label.", "error");
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
        const setupRes = await safeFetch(`${REFEREE_URL}/escrow/generate`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                escrow_id:         receiptCode,
                fee_hash:          feeHash,
                project_label:     projectLabel,
                buyer_name:        buyerName,
                buyer_address:     buyerWalletAddress || "",
                buyer_email:       buyerEmail,        // V2: notify buyer on PASS
                worker_email:      workerEmail,       // V2: send receipt code to worker
                task_description:  taskDesc,
                worker_address:    recipient,
                amount_xrp:        parseFloat(amountXRP),
                cancel_after_hrs:  cancelHrs,
                buyer_attachments: buyerFiles.filter(f => f.data).map(f => ({
                    filename:  f.filename,
                    mime_type: f.mime_type,
                    data:      f.data,
                })),
            }),
        });

        const setupData = await setupRes.json();

        if (!setupRes.ok) throw new Error(setupData.detail || "Backend rejected the request.");

        const condition         = setupData.condition;
        const cancelAfterRipple = setupData.cancel_after_ripple;
        const workerEmailSent   = setupData.worker_email_sent;

        console.log("✅ Vault created:", setupData);

        let statusMsg = "✅ Vault created! Opening Xaman for EscrowCreate...";
        if (workerEmail && workerEmailSent) statusMsg += `\n📧 Receipt code sent to ${workerEmail}`;
        showStatus("init-status", statusMsg, "success");

        // Build and sign EscrowCreate via Xaman
        const escrowTx = {
            TransactionType: "EscrowCreate",
            Amount:          Math.floor(parseFloat(amountXRP) * 1_000_000).toString(),
            Destination:     recipient,
            Condition:       condition.toUpperCase(),
        };
        if (cancelAfterRipple) escrowTx.CancelAfter = cancelAfterRipple;

        const xummRes  = await safeFetch(`${REFEREE_URL}/xumm/create-payload`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ txjson: escrowTx }),
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
                `Vault created! Xaman opened — sign the EscrowCreate transaction.\nReceipt Code: ${receiptCode}\nShare this with your worker once signed.` +
                (workerEmail && workerEmailSent ? `\n📧 We've also emailed the receipt code to ${workerEmail}` : ""),
                "success"
            );

            pollEscrowCreate(xummData.uuid, receiptCode);

        } else {
            throw new Error("Xaman failed to return a sign URL.");
        }

    } catch (err) {
        console.error("Init error:", err);
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
                    method:  "POST",
                    headers: { "Content-Type": "application/json" },
                    body:    JSON.stringify({ tx_hash: data.tx_hash }),
                });
                showStatus(
                    "init-status",
                    `✅ Escrow live on XRPL!\nReceipt Code: ${receiptCode}\nShare this with your worker — they can now submit their work and claim payment automatically.`,
                    "success"
                );
                console.log(`✅ EscrowCreate confirmed on-chain: ${data.tx_hash}`);
            }
        } catch (err) {
            console.warn("EscrowCreate poll error:", err);
        }
    }, 3000);
}

// ---------------------------------------------------------------------------
// WORKER — Load job info when Receipt Code is entered
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
            document.getElementById("info-buyer").textContent    = data.buyer_name        || "—";
            document.getElementById("info-task").textContent     = data.task_description  || "—";
            document.getElementById("info-amount").textContent   = `${data.amount_xrp} XRP`;
            document.getElementById("info-deadline").textContent = data.deadline          || "—";
            document.getElementById("info-status").textContent   = data.status            || "—";
        }

        hideStatus("job-info-status");
        console.log("✅ Job info loaded:", data);

        await fetchQuoteAfterLookup(data.worker_address, data.amount_xrp);

    } catch (err) {
        showStatus("job-info-status", `❌ Error loading job: ${err.message}`, "error");
    }
}

// ---------------------------------------------------------------------------
// STEP 2 — SUBMIT WORK FOR AUDIT (Worker)
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
    showStatus("submit-status", "⏳ Submitting work for AI audit...", "info");

    try {
        const res = await safeFetch(`${REFEREE_URL}/evaluate`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                escrow_id:          projectID,
                work:               workProof,
                callback_url:       callbackUrl,
                worker_attachments: workerFiles.filter(f => f.data).map(f => ({
                    filename:  f.filename,
                    mime_type: f.mime_type,
                    data:      f.data,
                })),
            }),
        });

        const result = await res.json();
        console.log("📋 Audit response:", result);

        if (!res.ok) throw new Error(result.detail || "Audit request failed.");

        const verdict = result.verdict;

        if (result.status === "approved" && result.fulfillment) {
            showStatus(
                "submit-status",
                `✅ APPROVED! Score: ${verdict.score}/100\n${verdict.summary}`,
                "success"
            );
            showVerdictPanel(verdict);
            await claimXRP(result);

        } else if (result.status === "approved" && !result.fulfillment) {
            showStatus(
                "submit-status",
                `AI approved your work but the vault could not be found for Receipt Code "${projectID}". ` +
                `Please check the ID is exactly correct and contact support if the issue persists.`,
                "warning"
            );
        } else {
            showStatus(
                "submit-status",
                `❌ REJECTED — Score: ${verdict.score}/100\n${verdict.summary}`,
                "error"
            );
            showVerdictPanel(verdict);
        }

    } catch (err) {
        console.error("Submit error:", err);
        showStatus("submit-status", `❌ ${err.message}`, "error");
    } finally {
        if (btn) btn.disabled = false;
    }
}

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

    // Style the verdict header
    const header = document.getElementById("verdict-header");
    const badge  = document.getElementById("verdict-result");
    if (header) {
        header.classList.remove("pass", "fail");
        header.classList.add(verdict.verdict === "PASS" ? "pass" : "fail");
    }
    if (badge) {
        badge.classList.remove("pass", "fail");
        badge.classList.add(verdict.verdict === "PASS" ? "pass" : "fail");
    }
}

// ---------------------------------------------------------------------------
// STEP 3 — CLAIM PAYMENT (EscrowFinish via Xaman)
// ---------------------------------------------------------------------------
async function claimXRP(auditResult) {
    const currency = document.getElementById("payout-currency")?.value || "XRP";

    const claimSection = document.getElementById("claim-section");
    if (claimSection) {
        claimSection.style.display         = "block";
        claimSection.dataset.fulfillment   = auditResult.fulfillment;
        claimSection.dataset.workerAddress = auditResult.worker_address;
        claimSection.dataset.xrpAmount     = auditResult.amount_xrp || null;
        claimSection.dataset.currency      = currency;
        claimSection.dataset.condition     = auditResult.condition;

        // Auto-fill sequence and buyer address
        if (auditResult.escrow_sequence) {
            const seqField = document.getElementById("escrow-sequence");
            if (seqField) seqField.value = auditResult.escrow_sequence;
        }
        if (auditResult.buyer_address) {
            const ownerField = document.getElementById("escrow-owner");
            if (ownerField) ownerField.value = auditResult.buyer_address;
        }
    }

    showStatus("submit-status", "✅ Audit approved! Click Claim Payment below to receive your XRP.", "success");
}

async function sendEscrowFinish(fulfillment, workerAddress, sequence, currency = "XRP", xrpAmount = null, condition = null) {
    const ownerAddress = document.getElementById("escrow-owner")?.value.trim();

    if (!ownerAddress) {
        showStatus("claim-status", "❌ Please enter the escrow owner (buyer) address.", "error");
        return;
    }

    showStatus("claim-status", "⏳ Opening Xaman to claim your XRP...", "info");

    try {
        const finishTx = {
            TransactionType: "EscrowFinish",
            Account:         workerAddress,
            Owner:           ownerAddress,
            OfferSequence:   parseInt(sequence),
            Fulfillment:     fulfillment.toUpperCase(),
            Fee:             "5000",
        };
        if (condition) finishTx.Condition = condition.toUpperCase();

        const res  = await safeFetch(`${REFEREE_URL}/xumm/create-payload`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ txjson: finishTx }),
        });
        const data = await res.json();

        if (data.nextUrl) {
            window.open(data.nextUrl, "_blank");

            if (currency === "RLUSD" && xrpAmount) {
                showStatus(
                    "claim-status",
                    "✅ Step 1 of 2: Xaman opened — sign to receive your XRP from escrow.\n" +
                    "Once signed, a second Xaman window will open to swap to RLUSD.",
                    "success"
                );
                setTimeout(() => triggerDexSwap(workerAddress, xrpAmount), 5000);
            } else {
                showStatus("claim-status", "✅ Xaman opened — sign to receive your XRP!", "success");
            }
        } else {
            throw new Error("Xaman failed to generate a signing URL.");
        }

    } catch (err) {
        console.error("Claim error:", err);
        showStatus("claim-status", `❌ ${err.message}`, "error");
    }
}

async function claimFromPanel() {
    const claimSection = document.getElementById("claim-section");
    const seq          = document.getElementById("escrow-sequence")?.value.trim();
    const currency     = claimSection?.dataset.currency  || "XRP";
    const xrpAmount    = parseFloat(claimSection?.dataset.xrpAmount) || null;
    const condition    = claimSection?.dataset.condition || null;

    if (!claimSection || !seq) {
        showStatus("claim-status", "❌ Please enter the escrow sequence number.", "error");
        return;
    }

    await sendEscrowFinish(
        claimSection.dataset.fulfillment,
        claimSection.dataset.workerAddress,
        seq,
        currency,
        xrpAmount,
        condition,
    );
}

// ---------------------------------------------------------------------------
// DEX — RLUSD QUOTE & SWAP
// ---------------------------------------------------------------------------
let dexQuoteData = null;

async function fetchDexQuote(workerAddress, xrpAmount) {
    if (!workerAddress || !xrpAmount || xrpAmount <= 0) return;

    const quotePanel = document.getElementById("dex-quote-panel");
    const quoteText  = document.getElementById("dex-quote-text");
    const trustWarn  = document.getElementById("dex-trust-warning");

    if (quotePanel) quotePanel.style.display = "block";
    if (quoteText)  quoteText.textContent    = "⏳ Fetching live quote...";
    if (trustWarn)  trustWarn.style.display  = "none";

    try {
        const res  = await safeFetch(`${REFEREE_URL}/dex/quote`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ worker_address: workerAddress, xrp_amount: xrpAmount }),
        });
        const data = await res.json();
        dexQuoteData = data;

        if (!data.trust_line_ok) {
            if (quoteText) quoteText.textContent = "⚠️ No RLUSD trust line found.";
            if (trustWarn) { trustWarn.style.display = "block"; trustWarn.textContent = data.trust_line_instructions; }
            return;
        }

        if (data.estimated_rlusd) {
            const rate = (data.estimated_rlusd / data.xrp_amount).toFixed(4);
            quoteText.textContent =
                `~${data.estimated_rlusd.toFixed(4)} RLUSD for ${data.xrp_amount} XRP` +
                `  (rate: 1 XRP ≈ ${rate} RLUSD)` +
                (data.slippage_warning ? "  ⚠️ Slippage warning — rate may shift" : "");
        } else {
            quoteText.textContent = "⚠️ No liquidity path found for XRP → RLUSD. Try receiving XRP instead.";
        }

    } catch (err) {
        console.error("DEX quote error:", err);
        if (document.getElementById("dex-quote-text"))
            document.getElementById("dex-quote-text").textContent = "❌ Could not fetch quote. Check connection.";
    }
}

function onCurrencyChange() {
    const currency   = document.getElementById("payout-currency")?.value;
    const quotePanel = document.getElementById("dex-quote-panel");
    if (currency === "RLUSD") {
        if (quotePanel) quotePanel.style.display = "block";
        const quoteText = document.getElementById("dex-quote-text");
        if (quoteText) quoteText.textContent = "Enter your Receipt Code and look up the job to see a live quote.";
    } else {
        if (quotePanel) quotePanel.style.display = "none";
        dexQuoteData = null;
    }
}

async function fetchQuoteAfterLookup(workerAddress, xrpAmount) {
    const currency = document.getElementById("payout-currency")?.value;
    if (currency === "RLUSD" && workerAddress && xrpAmount) {
        await fetchDexQuote(workerAddress, xrpAmount);
    }
}

async function triggerDexSwap(workerAddress, xrpAmount) {
    if (!dexQuoteData?.estimated_rlusd) return;

    showStatus("submit-status", "⏳ Opening Xaman for RLUSD swap...", "info");

    const minRlusd = (dexQuoteData.estimated_rlusd * 0.98).toFixed(6);

    const offerTx = {
        TransactionType: "OfferCreate",
        TakerPays: {
            currency: "RLUSD",
            issuer:   dexQuoteData.rlusd_issuer,
            value:    minRlusd,
        },
        TakerGets: String(Math.floor(xrpAmount * 1_000_000)),
    };

    try {
        const res  = await safeFetch(`${REFEREE_URL}/xumm/create-payload`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ txjson: offerTx }),
        });
        const data = await res.json();

        if (data.nextUrl) {
            window.open(data.nextUrl, "_blank");
            showStatus(
                "submit-status",
                `✅ Xaman opened for DEX swap!\n` +
                `Sign to receive ~${dexQuoteData.estimated_rlusd.toFixed(4)} RLUSD.\n` +
                `(Minimum guaranteed: ${minRlusd} RLUSD with 2% slippage protection)`,
                "success"
            );
        } else {
            throw new Error("Xaman did not return a sign URL for the swap.");
        }
    } catch (err) {
        console.error("DEX swap error:", err);
        showStatus("submit-status", `❌ DEX swap failed: ${err.message}`, "error");
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
    // Uses ?worker= param so the worker tab auto-opens and job info auto-loads
    const link = `${window.location.origin}${window.location.pathname}?worker=${encodeURIComponent(id)}`;
    navigator.clipboard.writeText(link).then(() => {
        showStatus("init-status", `✅ Worker link copied!\n${link}`, "success");
    });
}
