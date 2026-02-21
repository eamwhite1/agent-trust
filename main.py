from fastapi import FastAPI, Response, HTTPException
from pydantic import BaseModel
import psycopg2
import os
import httpx

app = FastAPI()

# --- CONFIGURATION ---
DATABASE_URL = os.getenv("DATABASE_URL")
REFEREE_PRO_URL = "https://xrpl-referee.onrender.com/evaluate"

# --- DATABASE SETUP ---
def init_db():
    if not DATABASE_URL:
        print("Error: DATABASE_URL not found.")
        return
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    # We create the table for AgentTrust (shared DB, but unique table)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS active_jobs (
            escrow_id TEXT PRIMARY KEY,
            task_description TEXT,
            buyer_address TEXT,
            worker_address TEXT,
            amount_xrp FLOAT,
            status TEXT DEFAULT 'PENDING'
        );
    """)
    conn.commit()
    cur.close()
    conn.close()

@app.on_event("startup")
def startup_event():
    init_db()

# --- MODELS ---
class EscrowInitiate(BaseModel):
    escrow_id: str
    task: str
    price: float
    worker: str
    buyer: str

class JobSettle(BaseModel):
    escrow_id: str
    work: str

# --- ROUTES ---

# 1. Health Checks (Fixes UptimeRobot 405 error)
@app.get("/")
def read_root():
    return {"status": "AgentTrust Banker is awake and watching."}

@app.api_route("/", methods=["HEAD"])
def head_root(response: Response):
    response.status_code = 200
    return

# 2. Initiate: Save Buyer's task to DB
@app.post("/initiate")
async def initiate_escrow(data: EscrowInitiate):
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO active_jobs (escrow_id, task_description, worker_address, buyer_address, amount_xrp)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (escrow_id) DO NOTHING;
        """, (data.escrow_id, data.task, data.worker, data.buyer, data.price))
        conn.commit()
        cur.close()
        conn.close()
        return {"status": "SUCCESS", "escrow_id": data.escrow_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 3. Settle: The Black Box logic
@app.post("/settle")
async def settle_job(data: JobSettle):
    try:
        # A. Fetch original task from DB
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        cur.execute("SELECT task_description FROM active_jobs WHERE escrow_id = %s", (data.escrow_id,))
        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row:
            raise HTTPException(status_code=404, detail="Escrow ID not found.")
        
        original_task = row[0]

        # B. Call Referee Pro for the Audit
        async with httpx.AsyncClient() as client:
            response = await client.post(
                REFEREE_PRO_URL,
                json={"task": original_task, "work": data.work},
                timeout=30.0
            )
        
        audit_result = response.json()

        # C. Logic for XRPL Release
        # If audit_result['ai_verdict'] contains "APPROVED", 
        # we will trigger the crypto release in the next step.
        
        return {
            "status": "Audit Complete",
            "ai_verdict": audit_result.get("ai_verdict", "No verdict returned"),
            "referee_raw": audit_result
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
