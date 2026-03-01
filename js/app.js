// --- CONFIGURATION ---
// Ensure this matches your Render URL exactly (no trailing slash)
const REFEREE_URL = "https://xrpl-referee.onrender.com";

/**
 * STEP 1: INITIALIZE VAULT (EscrowCreate)
 * Triggered by the "Initialize Vault" button.
 */
async function initVault() {
    const btn = document.getElementById('init-btn');
    const projectID = document.getElementById('project-id').value.trim();
    const recipient = document.getElementById('recipient').value.trim();
    const amountXRP = document.getElementById('amt').value;
    const manualHash = document.getElementById('audit-fee-hash').value.trim();

    if (!projectID || !recipient || !amountXRP) {
        alert("Missing fields. Please enter Project ID, Recipient, and Amount.");
        return;
    }

    if (btn) btn.disabled = true;

    try {
        console.log("Phase 1: Generating Condition for escrow_id:", projectID);

        const setupResponse = await fetch(`${REFEREE_URL}/escrow/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                escrow_id: projectID,
                fee_hash: manualHash || null
            })
        });

        const setupData = await setupResponse.json();

        if (!setupResponse.ok) {
            throw new Error(setupData.detail || "Referee backend rejected the request.");
        }

        const condition = setupData.condition;
        console.log("✅ Condition Received:", condition);
        console.log("✅ Vault created for escrow_id:", projectID, "— use this EXACT ID in Step 2.");

        // Calculate XRPL Time (Seconds since Jan 1, 2000)
        const RIPPLE_EPOCH = 946684800;
        const nowRipple = Math.floor(Date.now() / 1000) - RIPPLE_EPOCH;

        const escrowTx = {
            TransactionType: "EscrowCreate",
            Amount: Math.floor(parseFloat(amountXRP) * 1000000).toString(),
            Destination: recipient,
            Condition: condition.toUpperCase(),
            CancelAfter: nowRipple + 86400
        };

        console.log("Phase 2: Sending EscrowCreate to Xaman Bridge...", escrowTx);

        const xummResponse = await fetch(`${REFEREE_URL}/xumm/create-payload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ txjson: escrowTx })
        });

        const xummData = await xummResponse.json();

        if (xummData.nextUrl) {
            window.open(xummData.nextUrl, '_blank');
            alert(
                `✅ Vault Initialized!\n\n` +
                `Project ID: ${projectID}\n\n` +
                `IMPORTANT: Use this exact Project ID in Step 2.\n\n` +
                `A Xaman tab has opened — sign the EscrowCreate transaction.`
            );
        } else {
            throw new Error("Xaman failed to return a sign URL.");
        }

    } catch (err) {
        console.error("❌ Init Error:", err);
        alert(`Initialization Failed: ${err.message}`);
    } finally {
        if (btn) btn.disabled = false;
    }
}

/**
 * STEP 2: TRIGGER AI AUDIT (Request Fulfillment)
 */
async function releaseFunds() {
    const projectID = document.getElementById('project-id').value.trim();
    const workProof = document.getElementById('work-proof').value.trim();
    const jobTask = document.getElementById('job-description').value.trim();
    const auditHash = document.getElementById('audit-hash-step2').value.trim();

    const seq = document.getElementById('escrow-sequence').value.trim();
    const owner = document.getElementById('escrow-sender').value.trim();
    const recipient = document.getElementById('escrow-dest').value.trim();

    // Validation
    if (!projectID || !workProof || !auditHash || !seq || !owner || !recipient || !jobTask) {
        alert("Missing Data! Please ensure all fields are filled in:\n- Project ID\n- Job Description\n- Work Proof\n- Audit Fee Hash\n- Escrow Sequence\n- Sender & Recipient Addresses");
        return;
    }

    console.log("🚀 Requesting AI Audit for Project ID:", projectID);
    console.log("   Task:", jobTask);
    console.log("   Work:", workProof.substring(0, 100) + "...");

    try {
        const response = await fetch(`${REFEREE_URL}/evaluate`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-payment-hash": auditHash
            },
            body: JSON.stringify({
                task: jobTask,
                work: workProof,
                escrow_id: projectID
            })
        });

        const result = await response.json();

        console.log("📋 Full API Response:", result);

        // FIX: Separated the two possible failure modes with clear messaging
        if (result.status === "success") {
            if (result.fulfillment) {
                // Happy path — approved AND vault found
                console.log("✅ AI APPROVED and fulfillment key received!");
                alert(`✅ AUDIT APPROVED!\n\nVerdict: ${result.ai_verdict}\n\nOpening Xaman to release funds...`);
                await claimXRP(owner, seq, result.fulfillment, recipient);

            } else {
                // AI approved but vault wasn't found — the escrow_id mismatch bug
                console.error("❌ AI approved but no vault found for escrow_id:", projectID);
                alert(
                    `⚠️ AI APPROVED but the Vault was not found!\n\n` +
                    `Verdict: ${result.ai_verdict}\n\n` +
                    `The Project ID you used in Step 2 ("${projectID}") ` +
                    `does not match any vault created in Step 1.\n\n` +
                    `FIX: Make sure the Project ID field contains the exact same ` +
                    `value you used when you clicked "Initialize Vault". ` +
                    `Check the Render logs for stored vault IDs.`
                );
            }
        } else {
            // AI genuinely rejected the work
            console.log("❌ Audit rejected by AI.");
            alert(`❌ AUDIT REJECTED:\n\n${result.ai_verdict || "The AI was not satisfied with the submitted work."}`);
        }

    } catch (err) {
        console.error("Audit Error:", err);
        alert("Audit failed to process. Check your browser console and Render logs for details.\n\nError: " + err.message);
    }
}

/**
 * STEP 3: FINAL CLAIM (EscrowFinish)
 */
async function claimXRP(ownerAddress, sequenceNumber, fulfillment, recipientAddress) {
    try {
        console.log("Generating Final Claim (EscrowFinish)...");
        console.log("  Owner:", ownerAddress);
        console.log("  Sequence:", sequenceNumber);
        console.log("  Recipient:", recipientAddress);
        console.log("  Fulfillment (first 20 chars):", fulfillment.substring(0, 20) + "...");

        const finishTx = {
            TransactionType: "EscrowFinish",
            Account: recipientAddress,
            Owner: ownerAddress,
            OfferSequence: parseInt(sequenceNumber),
            Fulfillment: fulfillment.toUpperCase()
        };

        const response = await fetch(`${REFEREE_URL}/xumm/create-payload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ txjson: finishTx })
        });

        const data = await response.json();

        if (data.nextUrl) {
            window.open(data.nextUrl, '_blank');
            alert("✅ Final Step: Xaman has opened in a new tab.\n\nSign the EscrowFinish transaction to release the XRP!");
        } else {
            throw new Error("Xaman failed to generate the signature URL.");
        }

    } catch (err) {
        console.error("Claim Error:", err);
        alert("Failed to create the claim payload: " + err.message);
    }
}
