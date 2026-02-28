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
 * Pulls data from the new UI fields and sends the Job Description to the AI.
 */
async function releaseFunds() {
    // 1. Grab values from the new HTML IDs
    const projectID = document.getElementById('project-id').value.trim();
    const workProof = document.getElementById('work-proof').value.trim();
    const jobTask = document.getElementById('job-description').value.trim(); // The new criteria
    const auditHash = document.getElementById('audit-hash-step2').value.trim(); // The new Step 2 hash box
    
    const seq = document.getElementById('escrow-sequence').value.trim();
    const owner = document.getElementById('escrow-sender').value.trim();
    const recipient = document.getElementById('escrow-dest').value.trim();

    // 2. Validation Check
    if (!projectID || !workProof || !auditHash || !seq || !owner || !recipient || !jobTask) {
        alert("Missing Data! Please ensure Job Description, Proof, Audit Fee Hash, Sequence, and Addresses are all filled in.");
        return;
    }

    try {
        console.log("🚀 Requesting AI Audit for Project:", projectID);
        
        const response = await fetch(`${REFEREE_URL}/evaluate`, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "x-payment-hash": auditHash 
            },
            body: JSON.stringify({
                task: jobTask,      // This passes your Job Description to the AI
                work: workProof,    // This passes your completed work to the AI
                escrow_id: projectID
            })
        });

        const result = await response.json();
        
        if (result.status === "success" && result.fulfillment) {
            console.log("✅ AI APPROVED! Fulfillment Key Received.");
            alert(`✅ AUDIT APPROVED!\n\nVerdict: ${result.ai_verdict}`);
            
            // Immediately trigger the Xaman claim using the data in the boxes
            await claimXRP(owner, seq, result.fulfillment, recipient);
            
        } else {
            alert(`❌ AUDIT REJECTED:\n\n${result.ai_verdict || "The AI was not satisfied or the fee hash was already used."}`);
        }
    } catch (err) {
        console.error("Audit Error:", err);
        alert("Audit failed to process. Check your browser console and Render logs.");
    }
}

/**
 * STEP 3: FINAL CLAIM (EscrowFinish)
 * Packages the secret key into the final Xaman prompt.
 */
async function claimXRP(ownerAddress, sequenceNumber, fulfillment, recipientAddress) {
    try {
        console.log("Generating Final Claim (EscrowFinish)...");
        
        const finishTx = {
            TransactionType: "EscrowFinish",
            Account: recipientAddress, // The person clicking the button (usually the receiver)
            Owner: ownerAddress,       // The person who originally created the vault
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
            // Open Xaman in a new tab
            window.open(data.nextUrl, '_blank');
            alert("Final Step: A new tab has opened for Xaman. Sign to release the XRP from the vault!");
        } else {
            throw new Error("Xaman failed to generate the signature URL.");
        }
    } catch (err) {
        console.error("Claim Error:", err);
        alert("Failed to create the claim payload: " + err.message);
    }
}
