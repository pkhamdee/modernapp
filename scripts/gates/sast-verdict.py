"""Decide the SAST gate from Semgrep's JSON report (run by scripts/gates/sast.sh inside the Semgrep image).

usage: sast-verdict.py <semgrep.json> <sast-accepted.txt> <summary.txt>

Exit 1 when an ERROR-severity finding is not accepted, 2 when the accepted file is malformed, else 0.
Every finding is listed in the summary; WARNING and INFO never fail.
"""

import fnmatch
import json
import sys
from collections import Counter

RULE_PREFIX = "rules."  # semgrep-rules is mounted at /rules, so rule ids start with "rules."


def rule_id(check_id):
    return check_id[len(RULE_PREFIX):] if check_id.startswith(RULE_PREFIX) else check_id


def read_accepted(path):
    """Lines of `rule-id | path-glob | reason`; blank lines and # comments are skipped. A reason is required."""
    entries, problems = [], []
    with open(path, encoding="utf-8") as f:
        for number, line in enumerate(f, 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            fields = [field.strip() for field in line.split("|", 2)]
            if len(fields) != 3 or not all(fields):
                problems.append(f"{path}:{number}: expected 'rule-id | path-glob | reason', got: {line}")
                continue
            entries.append({"rule": fields[0], "path": fields[1], "reason": fields[2], "line": number, "used": 0})
    return entries, problems


def accepting(entries, finding):
    for entry in entries:
        if entry["rule"] == rule_id(finding["check_id"]) and fnmatch.fnmatch(finding["path"], entry["path"]):
            return entry
    return None


def main(report_path, accepted_path, summary_path):
    with open(report_path, encoding="utf-8") as f:
        report = json.load(f)
    entries, problems = read_accepted(accepted_path)
    lines = []
    if problems:
        lines += ["sast gate: FAILED: the accepted-findings file is malformed:"] + problems
        return finish(lines, summary_path, 2)

    findings = sorted(report["results"], key=lambda r: (r["path"], r["start"]["line"], r["check_id"]))
    blocking, accepted, reported = [], [], []
    for finding in findings:
        severity = finding["extra"]["severity"]
        where = f"{finding['path']}:{finding['start']['line']}"
        text = f"{severity:7} {where}  {rule_id(finding['check_id'])}"
        entry = accepting(entries, finding)
        if entry:
            entry["used"] += 1
            accepted.append(f"{text}\n          accepted ({accepted_path}:{entry['line']}): {entry['reason']}")
        elif severity == "ERROR":
            message = " ".join(finding["extra"]["message"].split())
            blocking.append(f"{text}\n          {message}")
        else:
            reported.append(text)

    counts = Counter(f["extra"]["severity"] for f in findings)
    lines.append(
        "Semgrep findings: "
        + ", ".join(f"{counts.get(s, 0)} {s}" for s in ("ERROR", "WARNING", "INFO"))
        + f"; {len(report.get('paths', {}).get('scanned', []))} files scanned"
        + f", {len(report.get('errors', []))} parse/rule errors (see semgrep.json)"
    )
    for title, items in (
        ("Blocking (ERROR, not accepted)", blocking),
        ("Accepted", accepted),
        ("Reported only (WARNING, INFO)", reported),
    ):
        if items:
            lines += ["", f"{title}:"] + [f"  {item}" for item in items]
    unused = [e for e in entries if not e["used"]]
    if unused:
        lines += ["", "Accepted entries that matched nothing (remove them):"]
        lines += [f"  {accepted_path}:{e['line']}: {e['rule']} | {e['path']}" for e in unused]

    lines.append("")
    if blocking:
        lines.append(f"sast gate: FAILED: {len(blocking)} ERROR finding(s); fix them or accept them with a reason "
                     "in scripts/gates/sast-accepted.txt")
        return finish(lines, summary_path, 1)
    lines.append("sast gate: passed: no unaccepted ERROR findings")
    return finish(lines, summary_path, 0)


def finish(lines, summary_path, code):
    text = "\n".join(lines) + "\n"
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write(text)
    sys.stdout.write(text)
    return code


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:4]))
