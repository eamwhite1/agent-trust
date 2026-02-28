// --- CONFIGURATION ---
const REFEREE_URL = "https://xrpl-referee.onrender.com"; 

async function initVault() {
    // 1. Setup UI References
    const btn = document.getElementById('init-btn');
    const projectID = document.getElementById('project-id').value;
    const recipient = document.getElementById('recipient').value;
    const amountXRP = document.getElementById('amt').value;
    const manualHash = document.getElementById('audit-fee-hash').value;

    // 2. Validation
    if (!projectID || !recipient || !amountXRP) {
        alert("Please fill in all project fields.");
        return;
    }

    // If manual mode is active, ensure a hash is provided
    if (window.paymentMode === 'manual' && !manualHash) {
        alert("Please paste the Transaction Hash for the 0.2 XRP fee.");
        return;
    }

    if (btn) btn.disabled = true;

    try {
        console.log("Step 1: Initializing Escrow with Referee...");

        // 3. Request Condition (Lock) from Referee
        // We send the manual hash here if it exists so the Referee can verify the fee
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
            throw new Error(errorMsg.detail || "Referee rejected escrow generation.");
        }
        
        const { condition } = await setupResponse.json();
        console.log("✅ Condition Secured:", condition);

        // 4. Prepare the XRPL Escrow Transaction
        const RIPPLE_EPOCH = 946684800;
        const nowRipple = Math.floor(Date.now() / 1000) - RIPPLE_EPOCH;

        const escrowTx = {
            TransactionType: "EscrowCreate",
            Amount: Math.floor(parseFloat(amountXRP) * 1000000).toString(),
            Destination: recipient.trim(),
            Condition: condition.toUpperCase(), // Ensure uppercase
    
            // Some XRPL nodes require FinishAfter to be present with a Condition
            // Setting it to 'now' means it can be finished immediately if the AI approves
            FinishAfter: nowRipple, 
    
            // CancelAfter gives you a 24-hour safety window
            CancelAfter: nowRipple + 86400
        };

        // 5. Handle Fee Payment & Payload Creation
        console.log("Step 2: Bridging to Xaman...");

        const payloadBody = {
            txjson: escrowTx,
            // If auto-pay is on, we tell the Referee to bundle a 0.2 XRP payment
            bundle_fee: window.paymentMode === 'auto' ? true : false
        };

        const xummResponse = await fetch(`${REFEREE_URL}/xumm/create-payload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payloadBody)
        });

        if (!xummResponse.ok) {
            const xummError = await xummResponse.json();
            throw new Error(xummError.detail || "Xaman Bridge failed.");
        }

        const { nextUrl } = await xummResponse.json();

        // 6. Final Redirection
        if (nextUrl) {
            console.log("🚀 Redirecting to Xaman:", nextUrl);
            window.open(nextUrl, '_blank');
            alert("Please sign the request in Xaman to lock the vault.");
        }

    } catch (err) {
        console.error("❌ Protocol Error:", err);
        alert(`Failed: ${err.message}`);
    } finally {
        if (btn) btn.disabled = false;
    }
}

/**
 * Step 2 Logic: Release Funds (The Audit)
 */
async function releaseFunds() {
    const projectID = document.getElementById('project-id').value;
    const workProof = document.getElementById('work-proof').value;
    const auditHash = document.getElementById('audit-fee-hash').value; // In case they paid earlier

    if (!projectID || !workProof) {
        alert("Enter the Project ID and Proof of Work to trigger audit.");
        return;
    }

    try {
        console.log("Requesting AI Audit...");
        const response = await fetch(`${REFEREE_URL}/evaluate`, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "X-Payment-Hash": auditHash // The "receipt" for the audit fee
            },
            body: JSON.stringify({
                task: "Verify the following work against project requirements.",
                work: workProof,
                escrow_id: projectID
            })
        });

        const result = await response.json();
        
        if (result.status === "success") {
            alert(`✅ APPROVED by AI! \nFulfillment: ${result.fulfillment}\n\nYou can now finish the escrow on-chain.`);
            console.log("Fulfillment revealed:", result.fulfillment);
        } else {
            alert(`❌ REJECTED: ${result.ai_verdict}`);
        }
    } catch (err) {
        console.error("Audit Error:", err);
        alert("Audit failed. See console.");
    }
}
