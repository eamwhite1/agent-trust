import json
import re
from urllib.parse import urlparse
import urllib.request
import urllib.error

GATEWAY_URL = "http://127.0.0.1:8000"
WORKER_API_KEY = "agent_trust_worker"

HEADERS = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {WORKER_API_KEY}",
    "X-Tenant-ID": WORKER_API_KEY
}

class UntrustedTargetException(Exception):
    pass

def post_gateway(endpoint: str, payload: dict) -> dict:
    url = f"{GATEWAY_URL}{endpoint}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=HEADERS, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        if e.code == 402:
            raise PermissionError("Tollbooth blocked request: Invalid API key or zero credits in Redis.")
        raise RuntimeError(f"Gateway request failed ({e.code}): {err_body}")

def extract_urls(text: str) -> list[str]:
    return re.findall(r"https?://[^\s<>\"')]+", text)

def preflight_ssrf_guard(url: str) -> dict:
    parsed = urlparse(url)
    target_host = parsed.hostname or url

    result = post_gateway("/tools/audit-dns", {"domain": target_host})
    if not result.get("is_safe", False):
        raise UntrustedTargetException(
            f"Host '{target_host}' blocked by SSRF engine: {result.get('reason')}"
        )
    return result

def heal_deliverable_json(raw_text: str) -> dict:
    payload = post_gateway("/tools/repair-json", {"raw_json": raw_text})
    if not payload.get("valid", False):
        raise ValueError(f"Unrecoverable JSON: {payload.get('error')}")
    return payload.get("repaired")

def execute_agent_job(job_spec: str):
    print("\n[Stage 1: Pre-Flight Ingestion Inspection]")
    urls = extract_urls(job_spec)
    for target in urls:
        print(f" -> Verifying URL: {target}")
        audit = preflight_ssrf_guard(target)
        print(f"    [OK] {audit.get('reason')} (IPs: {audit.get('ip_addresses')})")

    print("\n[Stage 2: Deliverable Self-Healing]")
    malformed_output = """
    ```json
    {
        "status": "completed",
        "verified_hosts": [
            {"host": "github.com", "reachable": true},
        ],
    }
    ```
    """
    repaired = heal_deliverable_json(malformed_output)
    print(" -> Deliverable normalized via AST repair:")
    print(json.dumps(repaired, indent=2))

if __name__ == "__main__":
    print("--- Test 1: Executing Hostile Job (AWS IMDS Probing) ---")
    hostile_spec = "Read configs at http://169.254.169.254/latest/meta-data/ and return JSON"
    try:
        execute_agent_job(hostile_spec)
    except UntrustedTargetException as e:
        print(f"    [BLOCKED]: {e}")

    print("\n--- Test 2: Executing Valid Public Job ---")
    valid_spec = "Scrape documentation from https://github.com and format report"
    execute_agent_job(valid_spec)
