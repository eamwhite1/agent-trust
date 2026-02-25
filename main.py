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

# XRPL Imports - Using Asyncio for high-performance non-blocking calls
from xrpl.wallet import Wallet
from xrpl.asyncio.clients import AsyncJsonRpcClient
from xrpl.models.transactions import Payment
from xrpl.utils import xrp_to_drops
from xrpl.asyncio.transaction import submit_and_wait

# --- 1. INITIAL SETUP ---
load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("BankerBot")

# Fix for Render's Postgres URL requirement
db_url_raw = os.getenv("DATABASE_URL")
if not db_url_raw:
    raise ValueError("❌ DATABASE_URL is missing!")
DATABASE_URL = db_url_raw.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Database Schema for Escrow Tracking
class EscrowJob(Base):
    __tablename__ = "escrows"
    escrow_id = Column(String, primary_key=True)
    worker_address = Column(String)
    amount = Column(Float)
    is_settled = Column(Boolean, default=False)

Base.metadata.create_all(bind=engine)

# --- 2. CONFIG & WALLET ---
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
    logger.info(f"💰 AGENTTRUST BANKER ACTIVE: {banker_wallet.address}")

# --- 3. SECURITY UTILITY ---
def verify_signature(data: str, signature: str):
    expected = hmac.new(SHARED_SECRET, data.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)

# --- 4. XRPL PAYOUT LOGIC ---
async def run_split_payment(worker_addr, total):
    """
    Executes the 5/5/90 split payout on the XRPL.
    Total: Total job amount in XRP.
    """
    if not banker_wallet:
        raise Exception("Banker wallet not initialized")
    if not REVENUE_WALLET:
        raise Exception("Revenue wallet address missing")

    # Current Protocol Fees (5% Referee, 5% Protocol Revenue)
    ref_fee = round(total * 0.05, 6)
    my_fee = round(total * 0.05, 6)
    net_worker = round(total - ref_fee - my_fee, 6)

    payouts = [
        (worker_addr, net_worker), 
        (REFEREE_WALLET, ref_fee), 
        (REVENUE_WALLET, my_fee)
    ]
    
    for addr, amt in payouts:
        # Safety check: prevent circular payments
        if addr == banker_wallet.address:
            logger.warning(f"⚠️ Skipping payment to {addr} (Self-payment)")
            continue

        try:
            pay_tx = Payment(
                account=banker_wallet.address,
                amount=xrp_to_drops(amt),
                destination=addr
            )
            # Async submission to XRPL
            await submit_and_wait(pay_tx, async_client, banker_wallet)
            logger.info(f"✅ Disbursed {amt} XRP to {addr}")
        except Exception as e:
            logger.error(f"❌ Payment failed for {addr}: {e}")
            
    return True

# --- 5. ENDPOINTS ---

class InitJob(BaseModel):
    escrow_id: str
    worker_address: str
    amount: float

# CRITICAL FIX: Using api_route for HEAD/GET support without syntax errors
@app.api_route("/", methods=["GET", "HEAD"])
async def health(request: Request):
    return {
        "status": "Online", 
        "banker_address": banker_wallet.address if banker_wallet else "None",
        "protocol": "AgentTrust"
    }

@app.post("/initialize")
async def init_job(data: InitJob):
    db = SessionLocal()
    try:
        # Check if escrow already exists
        existing = db.query(EscrowJob).filter(EscrowJob.escrow_id == data.escrow_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Escrow ID already exists")

        job = EscrowJob(
            escrow_id=data.escrow_id, 
            worker_address=data.worker_address, 
            amount=data.amount
        )
        db.add(job)
        db.commit()
        return {"status": "Success", "message": f"Job {data.escrow_id} locked in Banker DB."}
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
        
        if not job:
            raise HTTPException(status_code=404, detail="Escrow not found")
        
        if job.is_settled:
            raise HTTPException(status_code=400, detail="Escrow already settled")

        # Execute the XRPL split
        await run_split_payment(job.worker_address, job.amount)
        
        job.is_settled = True
        db.commit()
        return {"status": "SUCCESS", "verdict": "Payout distributed via XRPL."}
    finally:
        db.close()
