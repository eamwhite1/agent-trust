// ---------------------------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------------------------
const REFEREE_URL = "https://xrpl-referee.onrender.com";

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

    // Update fee display when amount changes
    const amtField = document.getElementById("amt");
    if (amtField) amtField.addEventListener("input", updateFeeDisplay);

    // Payment mode toggle
    setPaymentMode("auto");
});

function updateFeeDisplay() {
    const val = parseFloat(document.getElementById("amt")?.value) || 0;
    const totalEl = document.getElementById("totalX");
    if (totalEl) totalEl.textContent = (val + 0.2).toFixed(2);
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
// Opens Xaman for the 0.2 XRP fee. Polls until signed, then auto-proceeds.
// ---------------------------------------------------------------------------
async function payFee() {
    const btn = document.getElementById("pay-fee-btn");
    if (btn) btn.disabled = true;
    showStatus("fee-status", "⏳ Opening Xaman for fee payment...", "info");

    try {
        const res  = await fetch(`${REFEREE_URL}/xumm/fee-payload`, { method: "POST" });
        const data = await res.json();

        if (!data.nextUrl) throw new Error("Xaman did not return a sign URL.");

        feePayloadUUID = data.uuid;

        // Open Xaman in new tab
        window.open(data.nextUrl, "_blank");
        showStatus("fee-status", "📱 Xaman opened — sign the 0.2 XRP payment, then return here.", "info");

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
        const res  = await fetch(`${REFEREE_URL}/xumm/payload/${feePayloadUUID}`);
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
// STEP 1B — INITIALIZE VAULT (Buyer)
// Called after fee is confirmed. Verifies fee on-chain, creates vault, emails worker.
// ---------------------------------------------------------------------------
async function initVault() {
    const btn = document.getElementById("init-btn");

    const projectID   = document.getElementById("project-id")?.value.trim();
    const buyerName   = document.getElementById("buyer-name")?.value.trim();
    const taskDesc    = document.getElementById("job-description")?.value.trim();
    const recipient   = document.getElementById("recipient")?.value.trim();
    const amountXRP   = document.getElementById("amt")?.value;
    const feeHash     = document.getElementById("audit-fee-hash")?.value.trim();
    const cancelHrs   = parseInt(document.getElementById("cancel-hours")?.value || "168");

    // Validation
    if (!projectID || !buyerName || !taskDesc || !recipient || !amountXRP) {
        showStatus("init-status", "❌ Please fill in all required fields.", "error");
        return;
    }

    if (!feeHash) {
        showStatus("init-status", "❌ Please pay the 0.2 XRP fee first.", "error");
        return;
    }

    if (btn) btn.disabled = true;
    showStatus("init-status", "⏳ Verifying fee and creating vault...", "info");

    try {
        const setupRes = await fetch(`${REFEREE_URL}/escrow/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                escrow_id:        projectID,
                fee_hash:         feeHash,
                buyer_name:       buyerName,
                task_description: taskDesc,
                worker_address:   recipient,
                amount_xrp:       parseFloat(amountXRP),
                cancel_after_hrs: cancelHrs,
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
        const xummRes  = await fetch(`${REFEREE_URL}/xumm/create-payload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ txjson: escrowTx }),
        });
        const xummData = await xummRes.json();

        if (xummData.nextUrl) {
            window.open(xummData.nextUrl, "_blank");

            // Show the share panel with copy buttons
            const sharePanel = document.getElementById("share-panel");
            const shareId    = document.getElementById("share-project-id");
            if (sharePanel && shareId) {
                shareId.textContent    = projectID;
                sharePanel.style.display = "block";
            }

            showStatus(
                "init-status",
                `✅ Vault created! Xaman opened for EscrowCreate.\nShare your Project ID with the worker using the buttons below.`,
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
// WORKER — Load job info when Project ID is entered
// ---------------------------------------------------------------------------
async function loadJobInfo(projectId) {
    if (!projectId) return;

    showStatus("job-info-status", "⏳ Loading job details...", "info");

    try {
        const res  = await fetch(`${REFEREE_URL}/escrow/${encodeURIComponent(projectId)}`);
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
        showStatus("submit-status", "❌ Please enter your Project ID and proof of work.", "error");
        return;
    }

    if (btn) btn.disabled = true;
    showStatus("submit-status", "⏳ Submitting work for AI audit...", "info");

    try {
        const res = await fetch(`${REFEREE_URL}/evaluate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                escrow_id:    projectID,
                work:         workProof,
                callback_url: callbackUrl,
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
                `⚠️ AI approved your work but the vault could not be found for Project ID "${projectID}". ` +
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
    // The backend returns the worker_address stored at vault creation time
    // and the escrow sequence must be entered by the worker (from their Xaman history)
    const seq = document.getElementById("escrow-sequence")?.value.trim();

    if (!seq) {
        showStatus(
            "submit-status",
            "✅ Audit approved! Enter your Escrow Sequence number below and click Claim Payment.",
            "success"
        );
        // Show the claim section
        const claimSection = document.getElementById("claim-section");
        if (claimSection) {
            claimSection.style.display = "block";
            // Store fulfillment temporarily for when they click claim
            claimSection.dataset.fulfillment    = auditResult.fulfillment;
            claimSection.dataset.workerAddress  = auditResult.worker_address;
        }
        return;
    }

    await sendEscrowFinish(
        auditResult.fulfillment,
        auditResult.worker_address,
        seq
    );
}

async function sendEscrowFinish(fulfillment, workerAddress, sequence) {
    const ownerAddress = document.getElementById("escrow-owner")?.value.trim();

    if (!ownerAddress) {
        showStatus("claim-status", "❌ Please enter the escrow owner (buyer) address.", "error");
        return;
    }

    showStatus("claim-status", "⏳ Opening Xaman to claim your payment...", "info");

    try {
        const finishTx = {
            TransactionType: "EscrowFinish",
            Account:         workerAddress,
            Owner:           ownerAddress,
            OfferSequence:   parseInt(sequence),
            Fulfillment:     fulfillment.toUpperCase(),
        };

        const res  = await fetch(`${REFEREE_URL}/xumm/create-payload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ txjson: finishTx }),
        });
        const data = await res.json();

        if (data.nextUrl) {
            window.open(data.nextUrl, "_blank");
            showStatus("claim-status", "✅ Xaman opened — sign to receive your XRP!", "success");
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

    if (!claimSection || !seq) {
        showStatus("claim-status", "❌ Please enter the escrow sequence number.", "error");
        return;
    }

    await sendEscrowFinish(
        claimSection.dataset.fulfillment,
        claimSection.dataset.workerAddress,
        seq
    );
}

// ---------------------------------------------------------------------------
// SHARE HELPERS — Copy Project ID or worker portal link to clipboard
// ---------------------------------------------------------------------------
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
