import os
import hmac
import hashlib
import logging
from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, String, Float, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

# --- 1. INITIAL SETUP ---
load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("BankerBot")

# Database Setup
db_url_raw = os.getenv("DATABASE_URL")
if not db_url_raw:
    raise ValueError("❌ DATABASE_URL is missing!")
DATABASE_URL = db_url_raw.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class EscrowJob(Base):
    __tablename__ = "escrows"
    escrow_id = Column(String, primary_key=True)
    worker_address = Column(String)
    amount = Column(Float)
    is_settled = Column(Boolean, default=False)
    fulfillment = Column(String, nullable=True) # The secret key to unlock the vault

Base.metadata.create_all(bind=engine)

# --- 2. CONFIG ---
SHARED_SECRET = os.getenv("SHARED_SECRET", "change-me-locally").encode()

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# --- 3. SECURITY ---
def verify_signature(data: str, signature: str):
    expected = hmac.new(SHARED_SECRET, data.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)

# --- 4. ENDPOINTS ---

class InitJob(BaseModel):
    escrow_id: str
    worker_address: str
    amount: float
    fulfillment: str # Sent by the frontend during Step 01

@app.api_route("/", methods=["GET", "HEAD"])
async def health(request: Request):
    return {"status": "Online", "protocol": "AgentTrust", "service": "Banker Key-Vault"}

@app.post("/initialize")
async def init_job(data: InitJob):
    db = SessionLocal()
    try:
        existing = db.query(EscrowJob).filter(EscrowJob.escrow_id == data.escrow_id).first()
        if existing:
            # Update key if already exists to prevent orphaned escrows
            existing.fulfillment = data.fulfillment
            db.commit()
            return {"status": "Success", "message": "Fulfillment updated."}

        job = EscrowJob(
            escrow_id=data.escrow_id, 
            worker_address=data.worker_address, 
            amount=data.amount,
            fulfillment=data.fulfillment
        )
        db.add(job)
        db.commit()
        logger.info(f"🔒 Key Secured for {data.escrow_id}")
        return {"status": "Success", "message": "Key stored."}
    finally:
        db.close()

@app.post("/payout/{escrow_id}")
async def get_fulfillment(escrow_id: str, x_signature: str = Header(None)):
    """
    Releases the fulfillment key if the Referee's signature is valid.
    The worker uses this key in Xaman to claim the 100% escrow amount.
    """
    if not x_signature:
        raise HTTPException(status_code=401, detail="Missing signature")

    if not verify_signature(escrow_id, x_signature):
        raise HTTPException(status_code=403, detail="Invalid signature")

    db = SessionLocal()
    try:
        job = db.query(EscrowJob).filter(EscrowJob.escrow_id == escrow_id).first()
        if not job:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # We don't block if already settled; the user might need the key again 
        # if the first transaction failed on-chain.
        
        logger.info(f"🔑 Key Released for {escrow_id}")
        return {
            "status": "SUCCESS", 
            "fulfillment": job.fulfillment,
            "message": "Use this fulfillment in your EscrowFinish transaction."
        }
    finally:
        db.close()
