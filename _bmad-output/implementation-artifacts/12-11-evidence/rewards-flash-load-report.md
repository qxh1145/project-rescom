# Rewards Flash load report (rewards-flash-load-2026-10-15T05-17-35-350Z)

- Result: **PASS**
- Commit: `eedb620` (working tree includes uncommitted Story 12.11 changes); DB: `rescom_rewards_check`; backend: http://localhost:4001
- Parameters: N=300 users, quota=100, voucher stock=100, perUserCap=1, requireRecentSurvey=false, double-submit users=20, Flash price 600 (regular 1000), start ~T+90s
- Wall clock from release to last response: 2.578 s; lifecycle job set reserved_at 9.7 s after starts_at
- Users: registered via POST /auth/register (76.9 s, 8 at a time), activated and funded with balanced journals SYSTEM_ISSUANCE -> USER_AVAILABLE keyed per run

## Hardware profile

```json
{
  "clientHost": {
    "platform": "darwin arm64",
    "cpus": 10,
    "memoryGiB": 16,
    "node": "v22.18.0"
  },
  "dockerVm": "10 CPUs, 8218034176 bytes, aarch64",
  "backend": {
    "container": "rescom-api-load",
    "inspect": "cpus=2000000000ns cpuset=0,1 memory=8375186227B image=rescom-api:rewards-check",
    "nprocInside": "2",
    "cgroupCpuMax": "200000 100000",
    "cgroupMemoryMax": "8375185408"
  },
  "postgres": {
    "container": "rescom_load_pg",
    "inspect": "cpus=0ns cpuset=0,1 memory=0B image=postgres:15-alpine3.22",
    "cgroupCpuMax": "max 100000",
    "nprocInside": "2"
  }
}
```
- Backend after run: cpu=1.21% mem=139.1MiB / 7.654GiB

## Latency (ms, nearest-rank)

| Request | n | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| quote | 300 | 670.2 | 795.7 | 797.4 | 829.9 |
| redeem (single submit) | 280 | 1518.4 | 1826.7 | 1927.1 | 1929.8 |
| redeem (double-submit, both calls) | 40 | 1774.6 | 1948.3 | 1949.6 | 1949.6 |
| redeem (all) | 320 | 1518.9 | 1923.7 | 1946.2 | 1949.6 |

NFR-1 comparison (information only, PRD OQ-22 owns SLOs): redeem p95 1923.7 ms and quote p95 795.7 ms against 500 ms.

## Errors by status:error.code

```json
{
  "errorsByCode": {
    "quote": {
      "201:OK": 300
    },
    "redeem": {
      "409:SOLD_OUT": 186,
      "201:OK": 94
    },
    "redeemDoubleSubmit": {
      "201:OK": 12,
      "409:SOLD_OUT": 28
    }
  },
  "skippedUsers": {},
  "networkErrorSamples": [],
  "counts": {
    "apiFlashSuccessesSingle": 94,
    "sqlSucceededFlashRedemptions": 100,
    "flashItemSold": 100,
    "quotes201": 300
  },
  "doubleSubmit": {
    "pairs": 20,
    "violations": 0,
    "winnersAmongPairs": 6
  }
}
```

## 9.5 invariants

| Invariant | Result | Detail |
| --- | --- | --- |
| warm-up: all users reach the API | pass | [object Object] |
| SUCCEEDED Flash redemptions == quota (100) | pass | sql=100 |
| flash_sale_items.sold == quota | pass | sold=100 quota=100 |
| every SUCCEEDED redemption is at the Flash price | pass | 100 rows |
| no user has two SUCCEEDED redemptions for the item | pass | users with 2+=0 |
| non-winners fail only with SOLD_OUT (no 5xx, no network error, no other code) | pass | [object Object] |
| quotes fail only with SOLD_OUT (after sell-out); no 5xx, no network error | pass | [object Object] |
| API 201 <=> SQL SUCCEEDED (no phantom success) | pass | phantom=0 |
| one zero-sum 2-entry journal per success | pass | rows=100 violations=0 |
| sum of wallet debits == sum of success prices | pass | debits=60000 prices=60000 |
| losers' wallets unchanged | pass | changed=0 |
| winners debited exactly the Flash price once | pass | wrong=0 |
| stock identity: stock_total = stock_remaining + flash reserved + issued | pass | {"stock_total":100,"stock_remaining":0,"flash_reserved":0,"issued":100} |
| no code assigned twice | pass | dup=0 |
| double-submit pairs produce one result (1 redemption row, <=1 journal, same outcome both responses) | pass | 20 pairs ok |
| ledger: every journal sums to zero, no drift, no negative user account | pass | unbalanced=0 drift=0 negative=0 |
