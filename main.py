from fastapi import FastAPI, Response, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import psycopg2
import os
import httpx

app = FastAPI()

# --- 1. CORS CONFIGURATION ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATABASE_URL = os.getenv("DATABASE_URL")
# Ensure this matches your Referee's Render URL
REFEREE_PRO_URL = "https://xrpl-referee.onrender.com/evaluate"

# --- 2. DATABASE LOGIC ---
def get_db_conn():
    try:
        if DATABASE_URL and DATABASE_URL.startswith("postgres://"):
            fixed_url = DATABASE_URL.replace("postgres://", "postgresql://", 1)
            return psycopg2.connect(fixed_url)
        return psycopg2.connect(DATABASE_URL)
    except Exception as e:
        print(f"DATABASE CONNECTION ERROR: {e}")
        return None

def init_db():
    conn = get_db_conn()
    if not conn:
        return
    cur = conn.cursor()
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

# --- 3. MODELS ---
class EscrowInitiate(BaseModel):
    escrow_id: str
    task: str
    price: float
    worker: str
    buyer: str

class JobSettle(BaseModel):
    escrow_id: str
    work: str

# --- 4. ROUTES ---

@app.get("/")
def read_root():
    return {"status": "Banker is active."}

@app.post("/initiate")
async def initiate_escrow(data: EscrowInitiate):
    conn = get_db_conn()
    if not conn: raise HTTPException(status_code=500, detail="DB Connection Failed")
    try:
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
        print(f"Error in initiate: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/settle")
async def settle_job(data: JobSettle):
    conn = get_db_conn()
    if not conn: raise HTTPException(status_code=500, detail="DB Connection Failed")
    try:
        # A. Fetch original task
        cur = conn.cursor()
        cur.execute("SELECT task_description FROM active_jobs WHERE escrow_id = %s", (data.escrow_id,))
        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row:
            raise HTTPException(status_code=404, detail="Escrow ID not found.")
        
        original_task = row[0]

        # B. Call Referee with fresh payment hash
        async with httpx.AsyncClient() as client:
            response = await client.post(
                REFEREE_PRO_URL,
                json={"task": original_task, "work": data.work},
                headers={
                    # New hashes here
                    "x-payment-hash": "48CC086B1DA19A5C2CD18D884BE859AB0958E0AA933536A34FED504BCCFB2763"  
                },
                timeout=45.0
            )
        
        # Log the response so we can see it in Render logs
        print(f"DEBUG: Referee Status {response.status_code}, Body: {response.text}")
        
        return response.json()

    except Exception as e:
        print(f"Error in settle: {e}")
        raise HTTPException(status_code=500, detail=str(e))
