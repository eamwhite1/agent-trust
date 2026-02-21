from fastapi import FastAPI
import psycopg2
import os

app = FastAPI()

# Get the database URL from Render's environment variables
DATABASE_URL = os.getenv("DATABASE_URL")

def init_db():
    if not DATABASE_URL:
        return
    # Connect to the database and create the AgentTrust table
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS active_escrows (
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

# Run the database setup when the server starts
@app.on_event("startup")
def on_startup():
    init_db()

# A simple health check
@app.get("/")
def read_root():
    return {"status": "AgentTrust Banker is awake and watching."}
