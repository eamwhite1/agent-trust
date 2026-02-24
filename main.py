import os
import hmac
import hashlib
import logging
import asyncio
from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, String, Float, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

# XRPL Imports - Use ASYNC versions
from xrpl.wallet import Wallet
from xrpl.clients import AsyncJsonRpcClient
from xrpl.models.transactions import Payment
from xrpl.utils import xrp_to_drops
from xrpl.transaction import submit_and_wait

# --- 1. INITIAL SETUP ---
load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("BankerBot")

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

Base.metadata.create_all(bind=engine)

# --- 2. CONFIG & WALLET ---
# We use the Async client for FastAPI compatibility
XRPL_URL = "https://s.altnet.rippletest.net:51234/"
async_client = AsyncJsonRpcClient(XRPL_URL)

SHARED_SECRET = os.getenv("SHARED_SECRET", "change-me-locally").encode()
REFEREE_WALLET = "rmcSrkpZ2i2kuvtCPeTVetee9SixP4djR"
REVENUE_WALLET = os.getenv("MY_REVENUE_WALLET")

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

banker_seed = os.getenv("BANKER_SEED")
if not banker_seed:
    logger.error("❌ BANKER_SEED is missing!")
    banker_wallet = None
else:
    banker_wallet = Wallet.from_seed(banker_seed)
    # This will show in your Render logs so you can see your Banker address!
    logger.info(f"💰 BANKER LIVE AT: {banker_wallet.address}")

# --- 3. SECURITY UTILITY ---
def verify_signature(data: str, signature: str):
    expected = hmac.new(SHARED_SECRET, data.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)

# --- 4. XRPL PAYOUT LOGIC ---
async def run_split_payment(worker_addr, total):
    if not banker_wallet:
        raise Exception("Banker wallet not initialized")
    if not REVENUE_WALLET:
        raise Exception("Revenue wallet address missing")

    ref_fee = round(total * 0.05, 6)
    my_fee = round(total * 0.05, 6)
    net_worker = round(total - ref_fee - my_fee, 6)

    payouts = [
        (worker_addr, net_worker), 
        (REFEREE_WALLET, ref_fee), 
        (REVENUE_WALLET, my_fee)
    ]
    
    for addr, amt in payouts:
        # SKIP if the address is the banker itself (prevents 'same sender/dest' error)
        if addr == banker_wallet.address:
            logger.warning(f"⚠️ Skipping payment to {addr} (Destination is the Banker itself)")
            continue

        try:
            pay_tx = Payment(
                account=banker_wallet.address,
                amount=xrp_to_drops(amt),
                destination=addr
            )
            # CRITICAL FIX: Use 'await' with the async_client
            await submit_and_wait(pay_tx, async_client, banker_wallet)
            logger.info(f"✅ Sent {amt} XRP to {addr}")
        except Exception as e:
            logger.error(f"❌ Failed to pay {addr}: {e}")
            
    return True

# --- 5. ENDPOINTS ---

class InitJob(BaseModel):
    escrow_id: str
    worker_address: str
    amount: float

@app.get("/")
def health():
    return {"status": "Online", "banker_address": banker_wallet.address if banker_wallet else "None"}

@app.post("/initialize")
async def init_job(data: InitJob):
    db = SessionLocal()
    try:
        job = EscrowJob(escrow_id=data.escrow_id, worker_address=data.worker_address, amount=data.amount)
        db.add(job)
        db.commit()
        return {"status": "Job Locked in DB"}
    finally:
        db.close()

@app.post("/payout/{escrow_id}")
async def payout(escrow_id: str, x_signature: str = Header(None)):
    if not x_signature:
        raise HTTPException(status_code=401, detail="Missing signature")

    if not verify_signature(escrow_id, x_signature):
        raise HTTPException(status_code=403, detail="Invalid signature")

    db = SessionLocal()
    try:
        job = db.query(EscrowJob).filter(EscrowJob.escrow_id == escrow_id).first()
        if job and not job.is_settled:
            # We await this call now
            await run_split_payment(job.worker_address, job.amount)
            job.is_settled = True
            db.commit()
            return {"status": "SUCCESS: Split Payout Distributed"}
        raise HTTPException(status_code=400, detail="Job not found or already paid")
    finally:
        db.close()
