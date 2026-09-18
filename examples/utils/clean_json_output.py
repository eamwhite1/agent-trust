"""
utils/clean_json_output.py
--------------------------
Strip common LLM output artefacts before submitting a deliverable to the
AgentTrust referee.  No third-party dependencies — stdlib only.

Problems addressed:
  - Markdown code fences  (```json ... ```)
  - Trailing commas before } or ]  (invalid per RFC 8259)
  - Leading/trailing whitespace

Usage:
    from utils.clean_json_output import clean_json_output

    raw = llm.generate(prompt)
    data = clean_json_output(raw)          # returns parsed dict/list
    # pass data to evaluate_escrow_work / POST /evaluate
"""

import json
import re


def clean_json_output(text: str) -> dict | list:
    """Parse LLM output as JSON, repairing common formatting errors.

    Raises ValueError if the text cannot be repaired into valid JSON.
    """
    text = text.strip()

    # Strip markdown code fences: ```json ... ``` or ``` ... ```
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    text = text.strip()

    # Remove trailing commas before ] or }
    text = re.sub(r",\s*([}\]])", r"\1", text)

    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Could not parse LLM output as JSON: {exc}\n\nRaw text:\n{text}") from exc


# ---------------------------------------------------------------------------
# Quick demo
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    samples = [
        # Markdown fence + trailing commas
        '''```json
        {
            "status": "completed",
            "items": ["a", "b",],
        }
        ```''',
        # Plain trailing comma
        '{"result": "ok", "score": 95,}',
        # Already valid
        '{"status": "done"}',
    ]

    for raw in samples:
        try:
            parsed = clean_json_output(raw)
            print("OK:", parsed)
        except ValueError as e:
            print("FAIL:", e)
