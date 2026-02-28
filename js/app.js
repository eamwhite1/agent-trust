// --- CONFIGURATION ---
const REFEREE_URL = "https://xrpl-referee.onrender.com"; 

/**
 * Step 1: Initialize the Vault (EscrowCreate)
 */
async function initVault() {
    const btn = document.getElementById('init-btn');
    const projectID = document.getElementById('project-id').value;
    const recipient = document.getElementById('recipient').value;
    const amountXRP = document.getElementById('amt').value;
    const manualHash = document.getElementById('audit-fee-hash').value;

    if (!projectID || !recipient || !amountXRP) {
        alert("Please fill in all project fields.");
        return;
    }

    if (window.paymentMode === 'manual' && !manualHash) {
        alert("Please paste the Transaction Hash for the 0.2 XRP fee.");
        return;
    }

    if (btn) btn.disabled = true;

    try {
        console.log("Step 1: Requesting Condition from Referee...");
        const setupResponse = await fetch(`${REFEREE_URL}/escrow/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                escrow_id: projectID,
                fee_hash: window.paymentMode === 'manual' ? manualHash : null 
            })
        });

        if (!setupResponse.ok) {
            const errorMsg = await setupResponse.json();
            throw new Error(errorMsg.detail || "Referee rejected generation.");
        }
        
        const { condition } = await setupResponse.json();
        console.log("✅ Condition Secured:", condition);

        // XRPL Time (Seconds since Jan 1, 2000)
        const RIPPLE_EPOCH = 946684800;
        const nowRipple = Math.floor(Date.now() / 1000) - RIPPLE_EPOCH;

        const escrowTx = {
            TransactionType: "EscrowCreate",
            Amount: Math.floor(parseFloat(amountXRP) * 1000000).toString(), // Convert to Drops
            Destination: recipient.trim(),
            Condition: condition.toUpperCase(), 
            CancelAfter: nowRipple + 86400 // 24-hour expiration
        };

        console.log("Step 2: Sending Payload to Xaman...");
        const xummResponse = await fetch(`${REFEREE_URL}/xumm/create-payload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                txjson: escrowTx,
                bundle_fee: window.paymentMode === 'auto' ? true : false
            })
        });

        const { nextUrl } = await xummResponse.json();
        if (nextUrl) {
            window.open(nextUrl, '_blank');
            alert("Sign the EscrowCreate in Xaman. IMPORTANT: Keep your Sequence Number!");
        }

    } catch (err) {
        console.error("❌ Protocol Error:", err);
        alert(`Failed: ${err.message}`);
    } finally {
        if (btn) btn.disabled = false;
    }
}

/**
 * Step 2: Trigger AI Audit (Request Fulfillment)
 */
async function releaseFunds() {
    const projectID = document.getElementById('project-id').value;
    const workProof = document.getElementById('work-proof').value;
    const auditHash = document.getElementById('audit-fee-hash').value;

    if (!projectID || !workProof) {
        alert("Enter Project ID and Proof of Work.");
        return;
    }

    try {
        console.log("Requesting AI Audit...");
        const response = await fetch(`${REFEREE_URL}/evaluate`, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "X-Payment-Hash": auditHash 
            },
            body: JSON.stringify({
                task: "Verify the submitted work against project requirements.",
                work: workProof,
                escrow_id: projectID
            })
        });

        const result = await response.json();
        
        if (result.status === "success" && result.fulfillment) {
            alert(`✅ APPROVED! Fulfillment: ${result.fulfillment}`);
            
            // Ask user if they want to claim now
            const seq = prompt("Enter the Sequence Number of your original EscrowCreate to claim funds:");
            const owner = prompt("Enter the Wallet Address of the person who created the escrow:");
            const recipient = prompt("Enter your Wallet Address (Recipient):");
            
            if (seq && owner && recipient) {
                await claimXRP(owner, seq, result.fulfillment, recipient);
            }
        } else {
            alert(`❌ REJECTED: ${result.ai_verdict}`);
        }
    } catch (err) {
        alert("Audit failed. Check console.");
    }
}

/**
 * Step 3: Final Claim (EscrowFinish)
 */
async function claimXRP(ownerAddress, sequenceNumber, fulfillment, recipientAddress) {
    try {
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

        const { nextUrl } = await response.json();
        if (nextUrl) {
            window.open(nextUrl, '_blank');
            alert("Sign the final claim in Xaman to receive your XRP.");
        }
    } catch (err) {
        console.error("Claim Error:", err);
        alert("Failed to generate claim payload.");
    }
}
