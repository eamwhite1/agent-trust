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
        console.log("Phase 1: Generating Condition...");
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

        // Calculate XRPL Time (Seconds since Jan 1, 2000)
        const RIPPLE_EPOCH = 946684800;
        const nowRipple = Math.floor(Date.now() / 1000) - RIPPLE_EPOCH;

        const escrowTx = {
            TransactionType: "EscrowCreate",
            Amount: Math.floor(parseFloat(amountXRP) * 1000000).toString(), // Convert to Drops
            Destination: recipient,
            Condition: condition.toUpperCase(), 
            CancelAfter: nowRipple + 86400 // 24-hour window
        };

        console.log("Phase 2: Sending to Xaman Bridge...");
        const xummResponse = await fetch(`${REFEREE_URL}/xumm/create-payload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ txjson: escrowTx })
        });

        const xummData = await xummResponse.json();
        
        if (xummData.nextUrl) {
            window.open(xummData.nextUrl, '_blank');
            alert("Payload sent! Please sign the 'EscrowCreate' in your Xaman app.");
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
 * Triggered by the "Release Funds / Audit" button.
 */
async function releaseFunds() {
    const projectID = document.getElementById('project-id').value.trim();
    const workProof = document.getElementById('work-proof').value.trim();
    const auditHash = document.getElementById('audit-fee-hash').value.trim();

    if (!projectID || !workProof || !auditHash) {
        alert("Please enter Project ID, Proof of Work, and the 0.2 XRP Audit Fee Hash.");
        return;
    }

    try {
        console.log("Requesting AI Audit...");
        const response = await fetch(`${REFEREE_URL}/evaluate`, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "x-payment-hash": auditHash 
            },
            body: JSON.stringify({
                task: "Standard Quality Audit", // This will be dynamic in our next update
                work: workProof,
                escrow_id: projectID
            })
        });

        const result = await response.json();
        
        if (result.status === "success" && result.fulfillment) {
            alert(`✅ AUDIT APPROVED!\n\nVerdict: ${result.ai_verdict}`);
            
            // Collect details for the final claim
            const seq = prompt("Enter the Sequence Number from your EscrowCreate transaction:");
            const owner = prompt("Enter the Wallet Address of the Sender (who created the escrow):");
            const recipient = prompt("Enter your Receiving Wallet Address:");
            
            if (seq && owner && recipient) {
                await claimXRP(owner, seq, result.fulfillment, recipient);
            }
        } else {
            alert(`❌ AUDIT REJECTED:\n\n${result.ai_verdict || "Insufficient details."}`);
        }
    } catch (err) {
        console.error("Audit Error:", err);
        alert("Audit failed to process. Check your console and backend logs.");
    }
}

/**
 * STEP 3: FINAL CLAIM (EscrowFinish)
 * Submits the fulfillment to the ledger to move the XRP.
 */
async function claimXRP(ownerAddress, sequenceNumber, fulfillment, recipientAddress) {
    try {
        console.log("Generating Final Claim (EscrowFinish)...");
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
            alert("Final step: Sign in Xaman to claim your XRP!");
        }
    } catch (err) {
        console.error("Claim Error:", err);
        alert("Failed to create the claim payload.");
    }
}
