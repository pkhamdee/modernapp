"""ZAP hook for the API scans of scripts/gates/dast.sh (zap-api-scan.py --hook): the requests ZAP sent.

Before ZAP shuts down, writes /zap/wrk/<DAST_SCAN>-requests.tsv: one line per request in ZAP's history (the
operations it imported from the OpenAPI description, and the active scan's attacks where ZAP keeps them), as
`METHOD<TAB>URL<TAB>STATUS`. dast-verdict.py reads it to show which role-only endpoints a signed-in scan reached
with a 2xx answer, so a scan whose sign-in silently stopped working can't pass.
"""

import os

PAGE = 500


def zap_pre_shutdown(zap):
    path = os.path.join("/zap/wrk", os.environ["DAST_SCAN"] + "-requests.tsv")
    with open(path, "w", encoding="utf-8") as out:
        start = 1
        while True:
            messages = zap.core.messages(start=start, count=PAGE)
            for message in messages:
                request_line = message.get("requestHeader", "").split("\r\n", 1)[0].split(" ")
                status_line = message.get("responseHeader", "").split("\r\n", 1)[0].split(" ")
                if len(request_line) < 2:
                    continue
                status = status_line[1] if len(status_line) > 1 else ""
                out.write(f"{request_line[0]}\t{request_line[1]}\t{status}\n")
            if len(messages) < PAGE:
                break
            start += PAGE
