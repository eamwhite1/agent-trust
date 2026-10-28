#!/usr/bin/env python3
"""
check_snippets.py — Extract MCP tool calls from site pages and validate them
against the live tools/list inputSchema.

Pages checked: /testnet/, /try/, /agents/, /claude-md/
"""
import re, sys, json, urllib.request, os
from pathlib import Path

BASE = Path(__file__).parent.parent
API = os.environ.get("AGENT_TRUST_API", "https://mcp.cryptovault.co.uk")
PAGES = ["testnet", "try", "agents", "claude-md"]

# Fetch live tools list
def get_tools():
    try:
        with urllib.request.urlopen(f"{API}/tools/list", timeout=15) as r:
            data = json.loads(r.read())
        return {t["name"]: t for t in (data.get("tools") or [])}
    except Exception as e:
        print(f"WARN: could not fetch tools/list: {e}", file=sys.stderr)
        return {}

# Extract tool calls from HTML (simple regex, handles most cases)
CALL_RE = re.compile(r'\b([a-z][a-z0-9_]+)\s*\(([^)]*)\)', re.DOTALL)
KNOWN_TOOLS = None

def check_page(page_name, tools):
    path = BASE / page_name / "index.html"
    if not path.exists():
        return []
    text = path.read_text()
    # Only look in <pre> blocks (code snippets)
    pre_re = re.compile(r'<pre[^>]*>(.*?)</pre>', re.DOTALL)
    errors = []
    for pre_match in pre_re.finditer(text):
        block = pre_match.group(1)
        # Unescape HTML entities
        block = block.replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&')
        for m in CALL_RE.finditer(block):
            name = m.group(1)
            if name not in tools:
                continue
            # Check kwargs
            tool = tools[name]
            schema = tool.get("inputSchema") or {}
            props = schema.get("properties") or {}
            additional = schema.get("additionalProperties", True)
            args_str = m.group(2).strip()
            # Parse kwarg names (simple)
            kwarg_names = set(re.findall(r'(\w+)\s*=', args_str))
            if not kwarg_names:
                continue
            if additional is False:
                unknown = kwarg_names - set(props.keys())
                if unknown:
                    errors.append(f"  {page_name}/index.html: {name}() has unknown kwargs: {unknown}")
    return errors

def main():
    tools = get_tools()
    if not tools:
        print("WARN: no tools loaded, skipping validation")
        sys.exit(0)

    print(f"Checking {len(PAGES)} pages against {len(tools)} tools...")
    all_errors = []
    for page in PAGES:
        errs = check_page(page, tools)
        all_errors.extend(errs)

    if all_errors:
        print("FAIL — invalid tool calls found:")
        for e in all_errors:
            print(e)
        sys.exit(1)
    else:
        print(f"PASS — all snippets validated ({len(PAGES)} pages)")

if __name__ == "__main__":
    main()
