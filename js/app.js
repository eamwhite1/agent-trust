// --- CONFIGURATION ---
// If the Referee is running on your same machine, this is the default:
const REFEREE_URL = "http://127.0.0.1:8000"; 

async function initVault() {
    // 1. Grab values from your Glassmorphic UI
    const projectID = document.querySelector('input[placeholder="Project Identifier"]').value;
    const recipient = document.querySelector('input[placeholder="Recipient Wallet Address"]').value;
    const amountXRP = document.getElementById('amt').value;

    if (!projectID || !recipient || !amountXRP) {
        alert("Please fill in all fields before initializing the vault.");
        return;
    }

    try {
        console.log("Step 1: Requesting Condition from Referee...");
        
        // 2. Ask the Referee to generate the "Lock" (Condition)
        const setupResponse = await fetch(`${REFEREE_URL}/escrow/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ escrow_id: projectID })
        });

        if (!setupResponse.ok) throw new Error("Failed to get condition from Referee.");
        const { condition } = await setupResponse.json();

        // 3. Prepare the XRPL Escrow Transaction
        const escrowTx = {
            TransactionType: "EscrowCreate",
            Account: "", // Xaman will fill this in automatically
            Amount: (parseFloat(amountXRP) * 1000000).toString(), // Convert XRP to Drops
            Destination: recipient,
            Condition: condition, // The cryptographic lock from the Referee
            FinishAfter: Math.floor(Date.now() / 1000) + 10, // Available almost immediately
        };

        console.log("Step 2: Sending payload to Xaman...");

        // 4. Send the transaction to the Referee's Xaman Bridge
        const xummResponse = await fetch(`${REFEREE_URL}/xumm/create-payload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ txjson: escrowTx })
        });

        const { nextUrl } = await xummResponse.json();

        // 5. Open the Xaman Sign Request
        if (nextUrl) {
            window.open(nextUrl, '_blank');
            alert("Please sign the transaction in your Xaman (Xumm) app.");
        }

    } catch (err) {
        console.error("Protocol Error:", err);
        alert("Transaction failed. See console for details.");
    }
}
