// --- CONFIGURATION ---
const REFEREE_URL = "https://xrpl-referee.onrender.com"; 

async function initVault() {
    const btn = document.querySelector('button[onclick="initVault()"]');
    
    // 1. Grab values from your Glassmorphic UI
    const projectID = document.querySelector('input[placeholder="Project Identifier"]').value;
    const recipient = document.querySelector('input[placeholder="Recipient Wallet Address"]').value;
    const amountXRP = document.getElementById('amt').value;

    // Validation
    if (!projectID || !recipient || !amountXRP) {
        alert("Please fill in all fields before initializing the vault.");
        return;
    }

    if (btn) btn.disabled = true; // Disable button to prevent triple-clicks during the process

    try {
        console.log("Step 1: Requesting Condition from Referee for Project:", projectID);
        
        // 2. Ask the Referee to generate the "Lock" (Condition)
        const setupResponse = await fetch(`${REFEREE_URL}/escrow/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ escrow_id: projectID })
        });

        if (!setupResponse.ok) {
            const errorMsg = await setupResponse.json();
            throw new Error(errorMsg.detail || "Failed to get condition from Referee.");
        }
        
        const { condition } = await setupResponse.json();
        console.log("✅ Condition Received:", condition);

        // 3. Prepare the XRPL Escrow Transaction
        const escrowTx = {
            TransactionType: "EscrowCreate",
            Amount: (parseFloat(amountXRP) * 1000000).toString(), // Convert XRP to Drops
            Destination: recipient,
            Condition: condition, // The cryptographic lock from the Referee
            FinishAfter: Math.floor(Date.now() / 1000) + 10, 
        };

        console.log("Step 2: Creating Xaman Payload...");

        // 4. Send the transaction to the Referee's Xaman Bridge
        const xummResponse = await fetch(`${REFEREE_URL}/xumm/create-payload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ txjson: escrowTx })
        });

        if (!xummResponse.ok) {
            const xummError = await xummResponse.json();
            throw new Error(xummError.detail || "Xaman Bridge failed.");
        }

        const { nextUrl } = await xummResponse.json();

        // 5. Open the Xaman Sign Request
        if (nextUrl) {
            console.log("🚀 Success! Redirecting to Xaman:", nextUrl);
            window.open(nextUrl, '_blank');
            alert("Scan the QR code in your Xaman (Xumm) app to lock the vault.");
        }

    } catch (err) {
        console.error("❌ Protocol Error:", err);
        alert(`Transaction failed: ${err.message}`);
    } finally {
        if (btn) btn.disabled = false; // Re-enable button so user can try again if they hit an error
    }
}
