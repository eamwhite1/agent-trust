"""
AgentTrust Banker — retired service.
Redirects all traffic to the live AgentTrust app at www.cryptovault.co.uk.
The escrow and AI referee functionality has moved to xrpl-referee.onrender.com.
"""
from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="AgentTrust Banker", docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

LIVE_URL = "https://www.cryptovault.co.uk"

@app.get("/{path:path}")
@app.post("/{path:path}")
@app.head("/{path:path}")
def redirect_all(path: str = ""):
    return RedirectResponse(url=LIVE_URL, status_code=301)  # 301 = permanent redirect


if __name__ == "__main__":
    import os, uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
