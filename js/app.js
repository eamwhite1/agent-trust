// ---------------------------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------------------------
// The frontend (AgentTrust repo) and API (xrpl-referee repo) are separate
// Render services, so we must use the absolute API URL.
const REFEREE_URL = "https://xrpl-referee.onrender.com";

// ---------------------------------------------------------------------------
// FILE ATTACHMENT STATE
// ---------------------------------------------------------------------------
// Each entry: { filename, mime_type, data (base64), size }
let buyerFiles  = [];
let workerFiles = [];

const MAX_FILE_SIZE_MB = 10;
const ACCEPTED_MIME_TYPES = {
    "application/pdf":                          "pdf",
    "image/jpeg":                               "image",
    "image/png":                                "image",
    "image/gif":                                "image",
    "image/webp":                               "image",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "text/plain":                               "text",
    "text/markdown":                            "text",
};

// ---------------------------------------------------------------------------
// FILE READING HELPERS
// ---------------------------------------------------------------------------

/**
 * Reads a File object. For PDF/images: returns base64.
 * For DOCX/TXT/MD: extracts text and appends to the relevant textarea.
 */
async function processFile(file, targetArray, targetTextareaId, labelPrefix) {
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        alert(`"${file.name}" is too large. Maximum file size is ${MAX_FILE_SIZE_MB}MB.`);
        return;
    }

    const mime = file.type || guessMime(file.name);

    if (!ACCEPTED_MIME_TYPES[mime]) {
        alert(`"${file.name}" is not a supported file type.`);
        return;
    }

    // Check for duplicates
    if (targetArray.find(f => f.filename === file.name)) {
        alert(`"${file.name}" has already been added.`);
        return;
    }

    return new Promise((resolve) => {
        const reader = new FileReader();

        if (mime === "application/pdf" || mime.startsWith("image/")) {
            // Read as base64 for direct Gemini multimodal input
            reader.onload = (e) => {
                const base64 = e.target.result.split(",")[1]; // strip data:mime;base64,
                targetArray.push({ filename: file.name, mime_type: mime, data: base64, size: file.size });
                resolve();
            };
            reader.readAsDataURL(file);

        } else {
            // DOCX / TXT / MD — extract as plain text and append to textarea
            reader.onload = (e) => {
                const text = e.target.result;
                const textarea = document.getElementById(targetTextareaId);
                if (textarea) {
                    const existing = textarea.value.trim();
                    textarea.value = existing
                        ? `${existing}\n\n--- ${labelPrefix}: ${file.name} ---\n${text}`
                        : `--- ${labelPrefix}: ${file.name} ---\n${text}`;
                }
                // Store a text placeholder so the file shows in the UI list
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
        pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg",
        png: "image/png", gif: "image/gif", webp: "image/webp",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        txt: "text/plain", md: "text/markdown",
    };
    return map[ext] || "application/octet-stream";
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Renders the file list under a drop zone.
 */
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

/**
 * Sets up drag-and-drop and click-to-browse on a drop zone element.
 */
function initDropZone(zoneId, fileArray, fileListId, textareaId, labelPrefix) {
    const zone = document.getElementById(zoneId);
    const input = zone?.querySelector("input[type=file]");
    if (!zone || !input) return;

    zone.addEventListener("dragover",  (e) => { e.preventDefault(); zone.classList.add("drag-over"); });
    zone.addEventListener("dragleave", ()  => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", async (e) => {
        e.preventDefault();
        zone.classList.remove("drag-over");
        const files = Array.from(e.dataTransfer.files);
        for (const f of files) await processFile(f, fileArray, textareaId, labelPrefix);
        renderFileList(fileArray, fileListId);
    });

    zone.addEventListener("click", (e) => {
        if (e.target.classList.contains("file-remove")) return;
        input.click();
    });

    input.addEventListener("change", async () => {
        const files = Array.from(input.files);
        for (const f of files) await processFile(f, fileArray, textareaId, labelPrefix);
        renderFileList(fileArray, fileListId);
        input.value = ""; // reset so same file can be re-added after removal
    });
}

// ---------------------------------------------------------------------------
// SHARED STATE
// ---------------------------------------------------------------------------
let feePayloadUUID   = null;   // Xaman payload UUID for the fee payment
let feePollingTimer  = null;   // setInterval handle for polling Xaman status

// ---------------------------------------------------------------------------
// UTILITY
// ---------------------------------------------------------------------------
function showStatus(elementId, message, type = "info") {
    const el = document.getElementById(elementId);
    if (!el) return;
    const colors = { info: "#007BFF", success: "#34c759", error: "#ff3b30", warning: "#ff9500" };
    el.style.color    = colors[type] || colors.info;
    el.style.display  = "block";
    el.textContent    = message;
}

function hideStatus(elementId) {
    const el = document.getElementById(elementId);
    if (el) el.style.display = "none";
}

// Auto-fill project ID from URL param (worker clicks link in email)
window.addEventListener("DOMContentLoaded", () => {
    const params    = new URLSearchParams(window.location.search);
    const projectId = params.get("project");
    if (projectId) {
        // Fill in worker panel
        const workerProjectField = document.getElementById("worker-project-id");
        if (workerProjectField) {
            workerProjectField.value = projectId;
            // Automatically load job info once the field is filled
            loadJobInfo(projectId);
        }
    }

    // Initialise drag-and-drop zones
    initDropZone("buyer-drop-zone",  buyerFiles,  "buyer-file-list",  "job-description", "Buyer Spec");
    initDropZone("worker-drop-zone", workerFiles, "worker-file-list", "work-proof",       "Worker Proof");

    // Wire up live fee display
    const amtField = document.getElementById("amt");
    if (amtField) amtField.addEventListener("input", updateFeeDisplay);

    // Payment mode toggle
    setPaymentMode("auto");
});

function updateFeeDisplay() {
    const val     = parseFloat(document.getElementById("amt")?.value) || 0;
    const totalEl = document.getElementById("totalX");
    // Worker receives exactly the escrowed amount — the 0.1 XRP fee is separate
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

// ---------------------------------------------------------------------------
// STEP 1A — PAY PROTOCOL FEE (Buyer)
// Opens Xaman for the 0.1 XRP fee. Polls until signed, then auto-proceeds.
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

        // Open Xaman in new tab
        window.open(data.nextUrl, "_blank");
        showStatus("fee-status", "Opening Xaman — sign the 0.1 XRP payment, then return here.", "info");

        // Start polling for confirmation
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

            // Auto-fill the fee hash field (hidden or visible)
            const hashField = document.getElementById("audit-fee-hash");
            if (hashField) hashField.value = data.tx_hash;

            showStatus("fee-status", `✅ Fee paid! Hash: ${data.tx_hash.substring(0, 16)}...`, "success");
            console.log("✅ Fee payment confirmed. TX hash:", data.tx_hash);

            // Re-enable the pay button and enable the init button
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
// SAFE FETCH HELPER
// Wraps fetch() so a non-JSON response (e.g. HTML 404/405 error page)
// gives a readable error message rather than "Unexpected token '<'"
// ---------------------------------------------------------------------------
async function safeFetch(url, options = {}) {
    const res = await fetch(url, options);
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
        const body = await res.text();
        throw new Error(
            `Server returned ${res.status} (${res.statusText}) — expected JSON but got:\n${body.substring(0, 200)}`
        );
    }
    return res;
}
// Generates a unique human-readable code like AT-7X9K-2MQ4
// Uses crypto.getRandomValues — collision probability negligible
// ---------------------------------------------------------------------------
function generateReceiptCode() {
    const chars   = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/I/1
    const segment = (len) => Array.from(
        crypto.getRandomValues(new Uint8Array(len)),
        b => chars[b % chars.length]
    ).join("");
    return `AT-${segment(4)}-${segment(4)}`;
}

// ---------------------------------------------------------------------------
// STEP 1B — INITIALIZE VAULT (Buyer)
// ---------------------------------------------------------------------------
async function initVault() {
    const btn = document.getElementById("init-btn");

    const buyerName  = document.getElementById("buyer-name")?.value.trim();
    const taskDesc   = document.getElementById("job-description")?.value.trim();
    const recipient  = document.getElementById("recipient")?.value.trim();
    const amountXRP  = document.getElementById("amt")?.value;
    const feeHash    = document.getElementById("audit-fee-hash")?.value.trim();
    const cancelHrs  = parseInt(document.getElementById("cancel-hours")?.value || "168");

    if (!buyerName || !taskDesc || !recipient || !amountXRP) {
        showStatus("init-status", "❌ Please fill in all required fields.", "error");
        return;
    }
    if (!feeHash) {
        showStatus("init-status", "❌ Please pay the 0.1 XRP fee first.", "error");
        return;
    }

    // Auto-generate unique receipt code — buyer never types this
    const receiptCode = generateReceiptCode();

    if (btn) btn.disabled = true;
    showStatus("init-status", "⏳ Verifying fee and creating vault...", "info");

    try {
        const setupRes = await safeFetch(`${REFEREE_URL}/escrow/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                escrow_id:          receiptCode,
                fee_hash:           feeHash,
                buyer_name:         buyerName,
                task_description:   taskDesc,
                worker_address:     recipient,
                amount_xrp:         parseFloat(amountXRP),
                cancel_after_hrs:   cancelHrs,
                buyer_attachments:  buyerFiles.filter(f => f.data).map(f => ({
                    filename:  f.filename,
                    mime_type: f.mime_type,
                    data:      f.data,
                })),
            }),
        });

        const setupData = await setupRes.json();

        if (!setupRes.ok) {
            throw new Error(setupData.detail || "Backend rejected the request.");
        }

        const condition         = setupData.condition;
        const cancelAfterRipple = setupData.cancel_after_ripple;

        console.log("✅ Vault created:", setupData);
        showStatus("init-status", "✅ Vault created! Opening Xaman for EscrowCreate...", "success");

        // Build the EscrowCreate transaction
        const escrowTx = {
            TransactionType: "EscrowCreate",
            Amount:          Math.floor(parseFloat(amountXRP) * 1_000_000).toString(),
            Destination:     recipient,
            Condition:       condition.toUpperCase(),
        };

        if (cancelAfterRipple) {
            escrowTx.CancelAfter = cancelAfterRipple;
        }

        // Send to Xaman for signing
        const xummRes  = await safeFetch(`${REFEREE_URL}/xumm/create-payload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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
                `Vault created! Xaman opened for EscrowCreate.\nShare the Receipt Code with your worker so they can submit and claim payment.`,
                "success"
            );
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

        // Populate the job info panel
        const infoPanel = document.getElementById("job-info-panel");
        if (infoPanel) {
            infoPanel.style.display = "block";
            document.getElementById("info-buyer").textContent   = data.buyer_name    || "—";
            document.getElementById("info-task").textContent    = data.task_description || "—";
            document.getElementById("info-amount").textContent  = `${data.amount_xrp} XRP`;
            document.getElementById("info-deadline").textContent = data.deadline      || "—";
            document.getElementById("info-status").textContent  = data.status        || "—";
        }

        hideStatus("job-info-status");
        console.log("✅ Job info loaded:", data);

        // Fetch live DEX quote if worker has selected RLUSD payout
        // We use the worker's own address from the escrow (stored at vault creation)
        await fetchQuoteAfterLookup(data.worker_address, data.amount_xrp);

    } catch (err) {
        showStatus("job-info-status", `❌ Error loading job: ${err.message}`, "error");
    }
}

// ---------------------------------------------------------------------------
// STEP 2 — SUBMIT WORK FOR AUDIT (Worker)
// No payment required — fee was already paid by the buyer in Step 1.
// ---------------------------------------------------------------------------
async function submitWork() {
    const btn = document.getElementById("submit-btn");

    const projectID = document.getElementById("worker-project-id")?.value.trim();
    const workProof = document.getElementById("work-proof")?.value.trim();
    const callbackUrl = document.getElementById("callback-url")?.value.trim() || null;

    if (!projectID || !workProof) {
        showStatus("submit-status", "❌ Please enter your Receipt Code and proof of work.", "error");
        return;
    }

    if (btn) btn.disabled = true;
    showStatus("submit-status", "⏳ Submitting work for AI audit...", "info");

    try {
        const res = await safeFetch(`${REFEREE_URL}/evaluate`, {
            method: "POST",
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

        if (!res.ok) {
            // 404 = wrong project ID, 409 = already released/cancelled
            throw new Error(result.detail || "Audit request failed.");
        }

        const verdict = result.verdict;

        if (result.status === "approved" && result.fulfillment) {
            // Show the verdict
            showStatus(
                "submit-status",
                `✅ APPROVED! Score: ${verdict.score}/100\n${verdict.summary}`,
                "success"
            );

            // Show full verdict details
            showVerdictPanel(verdict);

            // Trigger EscrowFinish in Xaman
            await claimXRP(result);

        } else if (result.status === "approved" && !result.fulfillment) {
            // Approved but vault lookup failed — should not happen but handle gracefully
            showStatus(
                "submit-status",
                `AI approved your work but the vault could not be found for Receipt Code "${projectID}". ` +
                `Please check the ID is exactly correct and contact support if the issue persists.`,
                "warning"
            );
        } else {
            // Rejected — show the feedback
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

    const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val || "—";
    };

    setEl("verdict-result",  verdict.verdict);
    setEl("verdict-score",   `${verdict.score}/100`);
    setEl("verdict-summary", verdict.summary);
    setEl("verdict-details", verdict.details);

    const metEl    = document.getElementById("verdict-met");
    const failedEl = document.getElementById("verdict-failed");

    if (metEl && verdict.criteria_met?.length) {
        metEl.innerHTML = verdict.criteria_met.map(c => `<li>✓ ${c}</li>`).join("");
    }
    if (failedEl && verdict.criteria_failed?.length) {
        failedEl.innerHTML = verdict.criteria_failed.map(c => `<li>✕ ${c}</li>`).join("");
    }
}

// ---------------------------------------------------------------------------
// STEP 3 — CLAIM PAYMENT (EscrowFinish via Xaman)
// ---------------------------------------------------------------------------
async function claimXRP(auditResult) {
    const seq      = document.getElementById("escrow-sequence")?.value.trim();
    const currency = document.getElementById("payout-currency")?.value || "XRP";

    if (!seq) {
        showStatus("submit-status", "✅ Audit approved! Enter your Escrow Sequence number below and click Claim Payment.", "success");
        const claimSection = document.getElementById("claim-section");
        if (claimSection) {
            claimSection.style.display         = "block";
            claimSection.dataset.fulfillment   = auditResult.fulfillment;
            claimSection.dataset.workerAddress = auditResult.worker_address;
            claimSection.dataset.xrpAmount     = auditResult.amount_xrp || null;
            claimSection.dataset.currency      = currency;
            claimSection.dataset.condition     = auditResult.condition;
        }
        return;
    }

    await sendEscrowFinish(auditResult.fulfillment, auditResult.worker_address, seq, currency, auditResult.amount_xrp);
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
        };

        // Condition is required by XRPL when the escrow was created with one
        if (condition) {
            finishTx.Condition = condition.toUpperCase();
        }

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
                // Poll until the EscrowFinish is likely signed (5 second delay), then trigger swap
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

// Called by the "Claim Payment" button in the claim section
async function claimFromPanel() {
    const claimSection = document.getElementById("claim-section");
    const seq          = document.getElementById("escrow-sequence")?.value.trim();
    const currency     = claimSection?.dataset.currency || "XRP";
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

let dexQuoteData = null;  // Stores latest quote response

async function fetchDexQuote(workerAddress, xrpAmount) {
    if (!workerAddress || !xrpAmount || xrpAmount <= 0) return;

    const quotePanel = document.getElementById("dex-quote-panel");
    const quoteText  = document.getElementById("dex-quote-text");
    const trustWarn  = document.getElementById("dex-trust-warning");

    if (quotePanel) quotePanel.style.display = "block";
    if (quoteText)  quoteText.textContent     = "⏳ Fetching live quote...";
    if (trustWarn)  trustWarn.style.display   = "none";

    try {
        const res  = await safeFetch(`${REFEREE_URL}/dex/quote`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ worker_address: workerAddress, xrp_amount: xrpAmount }),
        });
        const data = await res.json();
        dexQuoteData = data;

        console.log("💱 DEX quote:", data);

        if (!data.trust_line_ok) {
            if (quoteText)  quoteText.textContent   = "⚠️ No RLUSD trust line found.";
            if (trustWarn) {
                trustWarn.style.display  = "block";
                trustWarn.textContent    = data.trust_line_instructions;
            }
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
        if (quoteText) quoteText.textContent = "❌ Could not fetch quote. Check connection.";
    }
}

function onCurrencyChange() {
    const currency      = document.getElementById("payout-currency")?.value;
    const quotePanel    = document.getElementById("dex-quote-panel");
    const workerAddress = document.getElementById("worker-project-id") ? null : null; // pulled at submit time

    if (currency === "RLUSD") {
        if (quotePanel) quotePanel.style.display = "block";
        // We don't have the worker address or amount here yet — prompt will show on submit
        const quoteText = document.getElementById("dex-quote-text");
        if (quoteText) quoteText.textContent = "Enter your Receipt Code and look up the job to see a live quote.";
    } else {
        if (quotePanel) quotePanel.style.display = "none";
        dexQuoteData = null;
    }
}

// Called after job info loads so we have the XRP amount for the quote
async function fetchQuoteAfterLookup(workerAddress, xrpAmount) {
    const currency = document.getElementById("payout-currency")?.value;
    if (currency === "RLUSD" && workerAddress && xrpAmount) {
        await fetchDexQuote(workerAddress, xrpAmount);
    }
}

async function triggerDexSwap(workerAddress, xrpAmount) {
    if (!dexQuoteData?.estimated_rlusd) return;

    showStatus("submit-status", "⏳ Opening Xaman for RLUSD swap...", "info");

    // Allow 2% slippage on the minimum RLUSD to receive
    const minRlusd = (dexQuoteData.estimated_rlusd * 0.98).toFixed(6);

    const offerTx = {
        TransactionType: "OfferCreate",
        TakerPays: {
            currency: "RLUSD",
            issuer:   dexQuoteData.rlusd_issuer,
            value:    minRlusd,
        },
        TakerGets: String(Math.floor(xrpAmount * 1_000_000)), // XRP in drops
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
function copyProjectId() {
    const id  = document.getElementById("share-project-id")?.textContent?.trim();
    if (!id) return;
    navigator.clipboard.writeText(id).then(() => {
        const btn = document.getElementById("copy-btn");
        if (btn) {
            btn.textContent = "✅ Copied!";
            setTimeout(() => { btn.textContent = "📋 Copy ID"; }, 2000);
        }
    });
}

function copyWorkerLink() {
    const id   = document.getElementById("share-project-id")?.textContent?.trim();
    if (!id) return;
    const link = `${window.location.origin}${window.location.pathname}?project=${encodeURIComponent(id)}`;
    navigator.clipboard.writeText(link).then(() => {
        showStatus("init-status", `✅ Worker link copied!\n${link}`, "success");
    });
}
