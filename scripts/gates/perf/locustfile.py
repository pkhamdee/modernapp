# Performance gate (ADR 0007): Customers using eShop's main flows against the temporary copy, through its gateway
# as a browser would. Run by scripts/gates/perf.sh; the load and the thresholds are in locust.conf beside this file.
#
# Each simulated Customer opens the app, signs in by SMS code with a mobile number of its own (one code per number
# is valid at a time, so users sharing a number would refuse each other's codes), then browses the catalog, opens
# Products and their Installment plans, looks at the current Auction and its Lots, and now and then signs in again.
# Staff sign-in is left out on purpose: it spends a fixed, deliberately slow password check on every attempt.
# Reading the code from the mock SMS inbox is not an eShop request, so it is made outside Locust's statistics.
#
# The verdict (exit code) is decided here, at the end of the run: fail when the p95 of every eShop request is over
# --p95-ms or more than --max-error-ratio of them failed. That replaces Locust's default of failing on any error.
import itertools
import random
import re
import time

import requests
from locust import HttpUser, between, events, task

# 09 + 3 digits of this run + 5 digits per user: distinct per user, and per run against the same copy.
_run = int(time.time()) % 1000
_user_numbers = itertools.count(1)


@events.init_command_line_parser.add_listener
def _(parser):
    parser.add_argument("--p95-ms", type=float, default=500, help="Fail when the p95 response time is over this (ms)")
    parser.add_argument("--max-error-ratio", type=float, default=0.01, help="Fail when more requests than this failed")
    parser.add_argument("--summary-file", default="", help="Write the verdict to this file too")


@events.quitting.add_listener
def _(environment, **_kwargs):
    options = environment.parsed_options
    total = environment.stats.total
    p95 = total.get_response_time_percentile(0.95) or 0
    lines = [
        f"requests: {total.num_requests}, failures: {total.num_failures} ({total.fail_ratio:.2%}; "
        f"limit {options.max_error_ratio:.2%})",
        f"p95: {p95:.0f} ms (limit {options.p95_ms:.0f} ms), median: {total.median_response_time:.0f} ms, "
        f"rps: {total.total_rps:.1f}",
    ]
    reasons = []
    if total.num_requests == 0:
        reasons.append("no requests were made")
    if total.fail_ratio > options.max_error_ratio:
        reasons.append(f"error ratio {total.fail_ratio:.2%} is over {options.max_error_ratio:.2%}")
    if p95 > options.p95_ms:
        reasons.append(f"p95 {p95:.0f} ms is over {options.p95_ms:.0f} ms")
    # The slowest endpoints first, so a failure says where to look.
    entries = sorted(environment.stats.entries.values(), key=lambda e: e.get_response_time_percentile(0.95) or 0,
                     reverse=True)
    lines.append("slowest p95 by endpoint:")
    for entry in entries[:5]:
        lines.append(f"  {entry.get_response_time_percentile(0.95) or 0:6.0f} ms  {entry.method} {entry.name}"
                     f"  ({entry.num_requests} requests, {entry.num_failures} failed)")
    lines.append(("FAIL: " + "; ".join(reasons)) if reasons else "PASS")
    summary = "\n".join(lines)
    print(summary)
    if options.summary_file:
        with open(options.summary_file, "w", encoding="utf-8") as file:
            file.write(summary + "\n")
    environment.process_exit_code = 1 if reasons else 0


class Customer(HttpUser):
    wait_time = between(0.5, 2)

    def on_start(self):
        self.mobile_number = f"09{_run:03d}{next(_user_numbers):05d}"
        self.token = None
        self.categories = []
        self.products = []
        self.lots = []
        self.client.get("/", name="/ (web app)")
        self.sign_in()

    def sign_in(self):
        """Signs in by SMS code: request a code, read it from the mock's inbox, verify it."""
        with self.client.post("/api/auth/sms-code", json={"mobileNumber": self.mobile_number},
                              catch_response=True) as response:
            if response.status_code != 202:
                response.failure(f"HTTP {response.status_code}")
                return
        code = self.read_sms_code()
        if code is None:
            return
        with self.client.post("/api/auth/sms-code/verify", json={"mobileNumber": self.mobile_number, "code": code},
                              catch_response=True) as response:
            try:
                if response.status_code != 200:
                    raise ValueError(f"HTTP {response.status_code}")
                self.token = response.json()["token"]
            except (ValueError, KeyError) as error:
                response.failure(str(error))

    def read_sms_code(self):
        # The mock's inbox, newest first. Not an eShop request: outside the statistics (a failure here is reported
        # as one, so the gate still sees a sign-in that could not finish).
        start = time.perf_counter()
        try:
            messages = requests.get(f"{self.host}/thirdparty-mock/sms/messages", params={"to": self.mobile_number},
                                    timeout=10).json()
            match = re.search(r"\d{6}", messages[0]["text"]) if messages else None
            if match:
                return match.group(0)
            raise ValueError(f"no SMS code for {self.mobile_number}")
        except Exception as error:  # noqa: BLE001 - any failure to read the code is one failed sign-in
            events.request.fire(request_type="POST", name="/api/auth/sms-code (code not received)",
                                response_time=(time.perf_counter() - start) * 1000, response_length=0,
                                exception=error, context={})
            return None

    def auth(self):
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    def get_json(self, path, name=None, headers=None):
        """GET that counts as failed unless it answers 200 with JSON (an error page served as 200 is a failure too)."""
        with self.client.get(path, name=name, headers=headers, catch_response=True) as response:
            try:
                if response.status_code != 200:
                    raise ValueError(f"HTTP {response.status_code}")
                return response.json()
            except ValueError as error:
                response.failure(str(error))
                return None

    @task(4)
    def browse_catalog(self):
        self.categories = self.get_json("/api/product-categories") or []
        if not self.categories:
            return
        code = random.choice(self.categories)["code"]
        self.products = self.get_json(f"/api/product-categories/{code}/products",
                                      name="/api/product-categories/[code]/products") or []
        for product in self.products[:4]:
            if product.get("imageUrl"):
                self.client.get(product["imageUrl"], name="/images/public/[id]")

    @task(4)
    def open_product(self):
        if not self.products:
            self.browse_catalog()
            if not self.products:
                return
        product = random.choice(self.products)
        self.get_json(f"/api/products/{product['id']}", name="/api/products/[id]")
        self.get_json(f"/api/products/{product['id']}/installment-plans", name="/api/products/[id]/installment-plans")

    @task(3)
    def open_auction_and_lot(self):
        # The temporary copy always has an open Auction with a Lot (seeded by temporary-copy.sh up).
        auction = self.get_json("/api/auctions/current", headers=self.auth())
        self.lots = auction["lots"] if auction else []
        if self.lots:
            lot = random.choice(self.lots)
            self.get_json(f"/api/lots/{lot['id']}", name="/api/lots/[id]", headers=self.auth())

    @task(1)
    def my_account(self):
        if self.token:
            self.get_json("/api/auth/me", headers=self.auth())

    @task(1)
    def sign_in_again(self):
        self.sign_in()
