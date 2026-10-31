"""Decide the DAST gate from ZAP's JSON reports (run by scripts/gates/dast.sh inside the ZAP image).

usage: dast-verdict.py <dast-rules.conf> <summary.txt> <scan-name>=<zap-report.json>...

Exit 1 when a High-risk alert is not accepted in the rules file, 2 when the rules file is malformed (a rule without
a reason) or a report is missing, else 0. Every alert is listed in the summary; Medium, Low and Informational alerts
never fail.

The rules file uses ZAP's `-c` format (tab-separated `id<TAB>LEVEL<TAB>(name)`, `id<TAB>OUTOFSCOPE<TAB>url-regex`),
read the way ZAP reads it. An alert is accepted when its rule is IGNOREd, or when every URL it
was raised on matches an OUTOFSCOPE line for its rule (or for `*`). Each rule line must sit under a `# reason: ...`
comment.
"""

import json
import re
import sys

RISKS = {"3": "High", "2": "Medium", "1": "Low", "0": "Informational"}
LEVELS = {"IGNORE", "INFO", "WARN", "FAIL", "OUTOFSCOPE"}


def read_rules(path):
    """The rules file's lines; each needs a `# reason:` comment in the comment block directly above it."""
    rules, problems = [], []
    reason = None
    with open(path, encoding="utf-8") as f:
        for number, raw in enumerate(f, 1):
            line = raw.rstrip("\n")
            if not line.strip():
                reason = None  # a blank line ends the comment block a reason belongs to
                continue
            if line.startswith("#"):
                match = re.match(r"#\s*reason:\s*(\S.*)$", line)
                if match:
                    reason = match.group(1).strip()
                continue
            fields = line.split("\t")
            if len(fields) < 3 or fields[1] not in LEVELS:
                problems.append(f"{path}:{number}: expected 'id<TAB>LEVEL<TAB>(name or url-regex)', got: {line}")
                continue
            if not reason:
                problems.append(f"{path}:{number}: {fields[0]} {fields[1]} has no '# reason: ...' comment above it")
                continue
            rules.append({"ids": fields[0].split(","), "level": fields[1], "pattern": fields[2], "reason": reason,
                          "line": number, "used": 0})
    return rules, problems


def accepting(rules, alert):
    """The rule lines that accept this alert, or [] if it stands."""
    plugin = alert["pluginid"]
    for rule in rules:
        if plugin in rule["ids"] and rule["level"] == "IGNORE":
            return [rule]
    # As ZAP reads them: the regex must match from the start of the URL.
    scopes = [r for r in rules if r["level"] == "OUTOFSCOPE" and (plugin in r["ids"] or "*" in r["ids"])]
    uris = [instance["uri"] for instance in alert.get("instances", [])]
    if scopes and uris:
        used = []
        for uri in uris:
            rule = next((r for r in scopes if re.match(r["pattern"], uri)), None)
            if rule is None:
                return []
            used.append(rule)
        return used
    return []


def main(rules_path, summary_path, *reports):
    rules, problems = read_rules(rules_path)
    lines = []
    if problems:
        lines += ["dast gate: FAILED: the rules file is malformed:"] + problems
        return finish(lines, summary_path, 2)

    blocking = []
    for spec in reports:
        name, _, report_path = spec.partition("=")
        try:
            with open(report_path, encoding="utf-8") as f:
                report = json.load(f)
        except (OSError, ValueError) as error:
            lines += [f"dast gate: FAILED: no usable {name} report ({report_path}): {error}"]
            return finish(lines, summary_path, 2)

        alerts = [(site["@name"], alert) for site in report.get("site", []) for alert in site.get("alerts", [])]
        alerts.sort(key=lambda a: (-int(a[1]["riskcode"]), a[1]["pluginid"], a[0]))
        lines.append(f"{name}: {len(alerts)} alert(s) on {', '.join(sorted({s for s, _ in alerts})) or 'no site'}")
        for site, alert in alerts:
            risk = RISKS.get(alert["riskcode"], alert["riskcode"])
            count = len(alert.get("instances", []))
            text = f"  {risk:13} {alert['pluginid']:>6}  {alert['alert']} ({count} URL(s))"
            accepted = accepting(rules, alert)
            if accepted:
                for rule in accepted:
                    rule["used"] += 1
                first = accepted[0]
                text += f"\n                 accepted ({rules_path}:{first['line']}): {first['reason']}"
            elif alert["riskcode"] == "3":
                example = alert.get("instances", [{}])[0]
                text += f"\n                 BLOCKING: {example.get('method', '')} {example.get('uri', '')}".rstrip()
                blocking.append(f"{name}: {alert['pluginid']} {alert['alert']}")
            lines.append(text)
        lines.append("")

    unused = [r for r in rules if r["level"] in ("IGNORE", "OUTOFSCOPE") and not r["used"]]
    if unused:
        lines += ["Accepting rules that matched no alert in this run (remove them if they stay unused):"]
        lines += [f"  {rules_path}:{r['line']}: {','.join(r['ids'])} {r['level']} {r['pattern']}" for r in unused]
        lines.append("")

    if blocking:
        lines += [f"dast gate: FAILED: {len(blocking)} High-risk alert(s) not accepted:"]
        lines += [f"  {b}" for b in blocking]
        lines += ["Fix them, or accept one with a reason in scripts/gates/dast-rules.conf."]
        return finish(lines, summary_path, 1)
    lines.append("dast gate: passed: no unaccepted High-risk alerts")
    return finish(lines, summary_path, 0)


def finish(lines, summary_path, code):
    text = "\n".join(lines) + "\n"
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write(text)
    sys.stdout.write(text)
    return code


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.stderr.write(__doc__)
        sys.exit(2)
    sys.exit(main(*sys.argv[1:]))
