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
from dotenv import load_dotenv  # <--- Make sure this is here!

# XRPL Imports
from xrpl.wallet import Wallet
from xrpl.clients import JsonRpcClient
from xrpl.models.transactions import Payment
from xrpl.utils import xrp_to_drops
from xrpl.transaction import submit_and_wait

# --- DATABASE SETUP ---
load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL").replace("postgres://", "postgresql://", 1)
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class EscrowJob(Base):
    __tablename__ = "escrows"
    escrow_id = Column(String, primary_key=True)
    worker_address = Column(String)
    amount = Column(Float)
    is_settled = Column(Boolean, default=False)

Base.metadata.create_all(bind=engine)

# --- CONFIG & WALLET ---
XRPL_URL = "https://s.altnet.rippletest.net:51234/"
client = JsonRpcClient(XRPL_URL)
SHARED_SECRET = os.getenv("SHARED_SECRET", "change-me-locally").encode()
REFEREE_WALLET = "rmcSrkpZ2i2kuvtCPeTVetee9SixP4djR"
REVENUE_WALLET = os.getenv("MY_REVENUE_WALLET")

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"])

try:
    banker_wallet = Wallet.from_seed(os.getenv("BANKER_SEED"))
    print(f"💰 Banker Online: {banker_wallet.address}")
except:
    print("❌ ERROR: BANKER_SEED missing!")

# --- SECURITY UTILITY ---
def verify_signature(data: str, signature: str):
    """Verifies that the request was signed by the Referee."""
    expected = hmac.new(SHARED_SECRET, data.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)

# --- XRPL PAYOUT LOGIC ---
async def run_split_payment(worker_addr, total):
    # 10% Fee logic: 5% to Referee, 5% to You
    ref_fee = total * 0.05
    my_fee = total * 0.05
    net_worker = total - ref_fee - my_fee

    payouts = [(worker_addr, net_worker), (REFEREE_WALLET, ref_fee), (REVENUE_WALLET, my_fee)]
    
    for addr, amt in payouts:
        pay_tx = Payment(
            account=banker_wallet.address,
            amount=xrp_to_drops(amt),
            destination=addr
        )
        submit_and_wait(pay_tx, client, banker_wallet)
    return True

# --- ENDPOINTS ---

class InitJob(BaseModel):
    escrow_id: str
    worker_address: str
    amount: float

@app.post("/initialize")
async def init_job(data: InitJob):
    db = SessionLocal()
    job = EscrowJob(escrow_id=data.escrow_id, worker_address=data.worker_address, amount=data.amount)
    db.add(job)
    db.commit()
    db.close()
    return {"status": "Job Locked in DB"}

@app.post("/payout/{escrow_id}")
async def payout(escrow_id: str, x_signature: str = Header(None)):
    if not x_signature:
        raise HTTPException(status_code=401, detail="Missing signature")

    # 1. Verify the Signature (Security Check)
    if not verify_signature(escrow_id, x_signature):
        raise HTTPException(status_code=403, detail="Invalid signature. Hack attempt detected.")

    # 2. Process Payout
    db = SessionLocal()
    job = db.query(EscrowJob).filter(EscrowJob.escrow_id == escrow_id).first()
    
    if job and not job.is_settled:
        await run_split_payment(job.worker_address, job.amount)
        job.is_settled = True
        db.commit()
        db.close()
        return {"status": "SUCCESS: Split Payout Distributed"}
    
    db.close()
    raise HTTPException(status_code=400, detail="Already settled or not found")
