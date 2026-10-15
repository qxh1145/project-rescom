# Rewards journey report (rewards-journey-2026-10-15T05-15-55-340Z)

- Base URL: http://localhost:3000 (pilot build, `/api` rewrite to backend); DB: `rescom_rewards_check`
- Commit: `eedb620` (working tree includes uncommitted Story 12.11 changes)
- Result: **PASS**
- Steps ok: 216/216
- Flag-off sweep: PASS (19/19)

## setup

| Actor | Step | Request | Status | Result | ms | X-Request-Id | Key ids / error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| admin | register (email) | `POST /api/auth/register` | 201 | pass | 421 | 5564c665-8bf8-4ffe-94bd-f807030660ac |  `{"userId":"e8b9f928-9397-4ca1-9c3f-d1e2f3a4f4bf"}` |
| admin | csrf token | `GET /api/auth/csrf` | 200 | pass | 16 | 2c98b951-4352-4dd1-b1a3-828e564b1b71 |   |
| userA | register (email) | `POST /api/auth/register` | 201 | pass | 295 | d615ee71-d057-4fb1-93b1-37fdc55bbe0f |  `{"userId":"15aac881-6a72-49d1-8366-6b6751368484"}` |
| userA | csrf token | `GET /api/auth/csrf` | 200 | pass | 7 | 10052dca-1d36-4e1d-a4f8-2844169bec49 |   |
| userB | register (email) | `POST /api/auth/register` | 201 | pass | 289 | a2d49016-3492-47e6-b8b8-cc69f3fcd3f6 |  `{"userId":"203cf357-e444-4218-bc45-b5bcc7e4bc0f"}` |
| userB | csrf token | `GET /api/auth/csrf` | 200 | pass | 6 | 6f500467-5e40-42e5-87f4-37ef558aacca |   |
| userC | register (email) | `POST /api/auth/register` | 201 | pass | 286 | da167057-77a0-4d37-870b-4907a4b9f933 |  `{"userId":"4348f401-904b-4b08-8ac2-bc344941d846"}` |
| userC | csrf token | `GET /api/auth/csrf` | 200 | pass | 7 | 016b2597-fced-40ac-8a5f-d5298a3c757e |   |
| userD | register (email) | `POST /api/auth/register` | 201 | pass | 288 | 2b0e6b63-7047-4705-84da-8e08e52c8e11 |  `{"userId":"48b70d4c-abae-44d2-885c-5c5628b14005"}` |
| userD | csrf token | `GET /api/auth/csrf` | 200 | pass | 6 | 4ac8ca8d-8625-41fa-aec2-511c119f1521 |   |
| userE | register (email) | `POST /api/auth/register` | 201 | pass | 416 | aef6546b-ae59-4e7c-b2d0-f42ca2487647 |  `{"userId":"2a453532-d57c-4311-b2ec-1fa3318eee01"}` |
| userE | csrf token | `GET /api/auth/csrf` | 200 | pass | 6 | 7dc1f18a-4052-41f3-aa7b-e6f8bb2b0186 |   |
| admin | scratch-DB role -> ADMIN | `SQL` | - | pass | 0 |  |   |
| admin | login | `POST /api/auth/login` | 200 | pass | 278 | 7ff4a97c-1725-4dc2-a3e7-d70d6df7480d |   |
| admin | csrf token | `GET /api/auth/csrf` | 200 | pass | 5 | 5a1bf452-93d9-482a-9893-34c638ead96e |   |
| userA | scratch-DB activation + funding 30000 pts | `SQL` | - | pass | 0 |  |   |
| userB | scratch-DB activation + funding 1000 pts | `SQL` | - | pass | 0 |  |   |
| userC | scratch-DB activation + funding 30000 pts | `SQL` | - | pass | 0 |  |   |
| userD | scratch-DB activation + funding 30000 pts | `SQL` | - | pass | 0 |  |   |

## Admin catalog

| Actor | Step | Request | Status | Result | ms | X-Request-Id | Key ids / error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| admin | settings read | `GET /api/admin/rewards/settings` | 200 | pass | 10 | 9d881767-986c-43cd-a1c0-58ced3c6bd72 |   |
| journey | settings read | `assert` | - | pass | 10 |  |  `{"dailyPointsLimit":500}` |
| admin | settings update | `PUT /api/admin/rewards/settings` | 200 | pass | 13 | 98a767ef-d555-4115-832a-2900657d1306 |   |
| journey | settings update (daily limit 100000 so price tests are not capped) | `assert` | - | pass | 13 |  |   |
| admin | list brands | `GET /api/admin/rewards/brands` | 200 | pass | 5 | cb878ae0-6a82-4dfe-908d-5c83bbff0d21 |   |
| journey | brands list | `assert` | - | pass | 6 |  |  `{"brands":6}` |
| admin | create voucher V1 | `POST /api/admin/rewards/vouchers` | 201 | pass | 20 | 48812b30-27b7-48a0-93a6-f0bc4229e54a |  `{"voucherId":"f07fe4ba-c5d5-4d10-99e4-21cdd3a21332"}` |
| admin | import codes V1 | `POST /api/admin/rewards/vouchers/:id/codes` | 200 | pass | 14 | 6b07ead9-343e-44f5-9adc-96f5f02a5cd5 |  `{"accepted":9,"committed":true}` |
| admin | voucher detail V1 | `GET /api/admin/rewards/vouchers/:id` | 200 | pass | 10 | 87f3682c-44d7-45f9-9935-dcb3a515299e |   |
| journey | create V1 (promo price, 9 codes) + CSV import | `assert` | - | pass | 45 |  |  `{"voucherId":"f07fe4ba-c5d5-4d10-99e4-21cdd3a21332"}` |
| admin | create voucher invalid promo | `POST /api/admin/rewards/vouchers` | 400 | pass | 8 | a174b4d8-91b8-4640-bf46-f0c35c502fc0 | VALIDATION_ERROR  |
| journey | create validation: promo >= base rejected | `assert` | - | pass | 8 |  |   |
| admin | import duplicate (VALIDATE) | `POST /api/admin/rewards/vouchers/:id/codes` | 200 | pass | 23 | a80b39c4-94fd-4cd4-922f-f0e6391ccbfe |   |
| admin | import duplicate (COMMIT) | `POST /api/admin/rewards/vouchers/:id/codes` | 200 | pass | 7 | d905140f-895c-4988-9368-25e6befb8f0e |   |
| admin | voucher detail V1 after rejected import | `GET /api/admin/rewards/vouchers/:id` | 200 | pass | 6 | 95539d92-3088-476b-b1d6-821aae816c4d |   |
| journey | CSV import: in-file duplicate rejected, nothing committed | `assert` | - | pass | 37 |  |   |
| admin | create voucher V2 | `POST /api/admin/rewards/vouchers` | 201 | pass | 9 | a1d3de43-c921-4b31-ae20-90c63e2bfe06 |  `{"voucherId":"0708abd5-5e43-41ba-ad66-27c0c869a833"}` |
| admin | import codes V2 | `POST /api/admin/rewards/vouchers/:id/codes` | 200 | pass | 11 | 6c490507-865e-455d-b942-00de090be42e |  `{"accepted":5,"committed":true}` |
| admin | create voucher V8 | `POST /api/admin/rewards/vouchers` | 201 | pass | 10 | 689ddb74-4f39-4862-847f-c1593f27da12 |  `{"voucherId":"789210cb-f140-48bc-9eca-118cba5f5f9c"}` |
| admin | import codes V8 | `POST /api/admin/rewards/vouchers/:id/codes` | 200 | pass | 11 | 9b978042-0bbe-4e6b-9966-c90fa252b18d |  `{"accepted":2,"committed":true}` |
| admin | create voucher V3 | `POST /api/admin/rewards/vouchers` | 201 | pass | 11 | cbff5e85-23fd-417a-b31e-5efbcfae1952 |  `{"voucherId":"73b0e4ba-3eef-4411-a90a-289183e6a3b8"}` |
| admin | import codes V3 | `POST /api/admin/rewards/vouchers/:id/codes` | 200 | pass | 10 | aa98ca29-bf94-4843-a25f-8aff8c32ea5c |  `{"accepted":1,"committed":true}` |
| admin | create voucher V4 | `POST /api/admin/rewards/vouchers` | 201 | pass | 8 | b50bc3f2-9e49-45ff-b41b-98623d11bba1 |  `{"voucherId":"efb11523-aaac-428f-a160-9308b85014d1"}` |
| admin | import codes V4 | `POST /api/admin/rewards/vouchers/:id/codes` | 200 | pass | 9 | 0fe1a869-e35c-47c3-ab04-4a17dfcc3811 |  `{"accepted":3,"committed":true}` |
| admin | create voucher V5 | `POST /api/admin/rewards/vouchers` | 201 | pass | 8 | 91590667-dcac-47eb-a2f7-f72ff4598af2 |  `{"voucherId":"b07c1df2-a3ca-4998-8e38-932345209560"}` |
| admin | import codes V5 | `POST /api/admin/rewards/vouchers/:id/codes` | 200 | pass | 10 | 7abc17d0-4fd2-4ade-ad11-2709bcfb1b83 |  `{"accepted":4,"committed":true}` |
| admin | create voucher V6 | `POST /api/admin/rewards/vouchers` | 201 | pass | 8 | 3a205f34-1b30-4b8d-92a3-ad6f4c6a8b92 |  `{"voucherId":"62f0043d-8e6e-42f4-858d-c29c7d066443"}` |
| admin | stock V6 shared (no codes needed) | `POST /api/admin/rewards/vouchers/:id/stock` | 200 | pass | 9 | 46b95b3d-2764-43bc-b098-5c64a38d4dc2 |   |
| admin | create voucher V7 | `POST /api/admin/rewards/vouchers` | 201 | pass | 8 | a2f7925a-d3e6-4880-83df-3c84876340fa |  `{"voucherId":"19a99166-af94-441a-ba5b-73b11c795c42"}` |
| admin | import codes V7 | `POST /api/admin/rewards/vouchers/:id/codes` | 200 | pass | 9 | 538be890-5740-4e53-933f-e7f03c11ee4a |  `{"accepted":3,"committed":true}` |
| journey | create V2..V8 (flash, last-unit, insufficient, cheap, shared, survey-rule, flash-whole-stock) | `assert` | - | pass | 133 |  |  `{"v2":"0708abd5-5e43-41ba-ad66-27c0c869a833","v3":"73b0e4ba-3eef-4411-a90a-289183e6a3b8","v4":"efb11523-aaac-428f-a160-9308b85014d1","v5":"b07c1df2-a3ca-4998-8e38-932345209560","v6":"62f0043d-8e6e-42f4-858d-c29c7d066443","v7":"19a99166-af94-441a-ba5b-73b11c795c42"}` |
| admin | admin voucher list | `GET /api/admin/rewards/vouchers` | 200 | pass | 11 | ecc455b2-a7a7-4651-94e2-7bd32d84a3fd |   |
| admin | admin voucher list ACTIVE + q | `GET /api/admin/rewards/vouchers?filter=ACTIVE&q=Journey%20V1%20726781` | 200 | pass | 6 | 82e93ca3-fd9c-42b4-9e80-788cbc275d3c |   |
| journey | admin list + filter + search | `assert` | - | pass | 17 |  |   |

## Admin Flash

| Actor | Step | Request | Status | Result | ms | X-Request-Id | Key ids / error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| admin | flash price >= regular | `POST /api/admin/rewards/flash-sales` | 409 | pass | 12 | 111f4baa-53c8-49ff-ab42-50c99f4331c4 | FLASH_PRICE_NOT_BELOW_REGULAR  |
| admin | flash quota > unreserved stock | `POST /api/admin/rewards/flash-sales` | 409 | pass | 8 | aa315698-9539-4cf9-8ea6-1e869a5869b2 | FLASH_QUOTA_EXCEEDS_STOCK  |
| admin | flash starts in past | `POST /api/admin/rewards/flash-sales` | 409 | pass | 8 | d7b187b1-e328-4099-9673-286654235004 | FLASH_STARTS_IN_PAST  |
| journey | flash conflicts: price >= regular, quota > unreserved, start in past | `assert` | - | pass | 28 |  |   |
| admin | create flash F1 | `POST /api/admin/rewards/flash-sales` | 201 | pass | 15 | f0e1fd77-dff4-46c6-a49e-aac2c841f145 |  `{"flashSaleId":"be4557b3-5f43-4acb-a143-b5ab615541a5","code":"FS-261015-A"}` |
| admin | create flash F2 | `POST /api/admin/rewards/flash-sales` | 201 | pass | 12 | bb367e66-bc35-48bf-8c86-6c637f655acd |  `{"flashSaleId":"c62aa426-779a-4b4c-8490-3a4e65df3d84","code":"FS-261015-B"}` |
| admin | create flash F3 | `POST /api/admin/rewards/flash-sales` | 201 | pass | 12 | 4ccbf3cc-7e44-4cfb-a2d9-3369b8f72ebb |  `{"flashSaleId":"7eaf3c5b-2b20-4215-888c-b4e8fdf223ce","code":"FS-261015-C"}` |
| journey | create Flash F1 (V2: 5 in stock, quota 3), F2 (V7, survey rule), F3 (V8: quota = whole stock 2) | `assert` | - | pass | 40 |  |   |
| admin | flash overlap | `POST /api/admin/rewards/flash-sales` | 409 | pass | 8 | 2f92aa28-50b2-496e-b941-a598429cf71a | FLASH_OVERLAP  |
| journey | flash overlap on the same voucher rejected | `assert` | - | pass | 8 |  |   |

## User browse

| Actor | Step | Request | Status | Result | ms | X-Request-Id | Key ids / error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| userA | catalog list | `GET /api/rewards/vouchers?brand=gong-cha&category=COFFEE&sort=POINTS_ASC&limit=5` | 200 | pass | 11 | b837fe4c-f0ba-4bea-b843-4a62262e4dc9 |   |
| userA | catalog search q | `GET /api/rewards/vouchers?q=Journey%20V3%20last%20unit%20726781` | 200 | pass | 17 | 4d027b58-f134-4561-b388-946f6df9e593 |   |
| userB | wallet balance | `GET /api/economy/wallet` | 200 | pass | 25 | 4bbf0513-0923-4bfc-8cf1-41a91ee690c2 |   |
| userB | catalog affordable=true | `GET /api/rewards/vouchers?affordable=true&limit=50` | 200 | pass | 8 | 7a5c1ce9-266e-4ade-a793-54523625bbaf |   |
| journey | catalog list with filters | `assert` | - | pass | 61 |  |  `{"total":4}` |
| userA | voucher detail | `GET /api/rewards/vouchers/:id` | 200 | pass | 6 | 78bd0588-0737-4fbe-b80c-30f1daddcdd8 |   |
| userA | wallet balance | `GET /api/economy/wallet` | 200 | pass | 13 | 5f2d954a-8fbe-473f-84d1-64deb3660909 |   |
| journey | voucher detail + balance from wallet | `assert` | - | pass | 20 |  |   |

## Redeem success

| Actor | Step | Request | Status | Result | ms | X-Request-Id | Key ids / error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| userA | wallet balance | `GET /api/economy/wallet` | 200 | pass | 7 | 09dc2e1f-2be2-47fe-9a4c-9def30821885 |   |
| userA | quote A V1 | `POST /api/rewards/quotes` | 201 | pass | 18 | cd446e75-bb57-4a00-8320-c949c53d8730 |  `{"quoteId":"e2274f3f-aed3-407c-934a-998827096ca7","source":"PROMO","points":800}` |
| userA | redeem A V1 | `POST /api/rewards/redemptions` | 201 | pass | 30 | 8d5ef032-3f34-48fc-89ff-568ee338d908 |  `{"redemptionId":"6e860c12-6c5e-49c2-8dc1-b3bcf4fa5868","reference":"RDM-2026-9OAT","ticketId":"6e860c12-6c5e-49c2-8dc1-b3bcf4fa5868","pointsSpent":800}` |
| userA | replay redeem (same key) | `POST /api/rewards/redemptions` | 201 | pass | 6 | d805ddeb-d79f-48af-85fe-3b2545e120e0 |   |
| userA | wallet balance | `GET /api/economy/wallet` | 200 | pass | 6 | f9fcf005-3a24-4f37-9425-fbddeaf33f4e |   |
| userA | get redemption by key | `GET /api/rewards/redemptions/by-key/:id` | 201 | pass | 6 | e0d4515f-c16f-4026-953b-63a8460f6de8 |   |
| journey | A: quote -> redeem V1 -> replay same key -> by-key | `assert` | - | pass | 74 |  |  `{"ticketId":"6e860c12-6c5e-49c2-8dc1-b3bcf4fa5868"}` |
| userA | quote V5 for conflict | `POST /api/rewards/quotes` | 201 | pass | 11 | 615cc4b9-354e-4b2a-8116-f471399dc766 |   |
| userA | reuse key with another quote | `POST /api/rewards/redemptions` | 409 | pass | 4 | 2fe45503-685a-4f84-abd7-d7c913e3ec22 | IDEMPOTENCY_KEY_CONFLICT  |
| userA | redeem used quote with a new key | `POST /api/rewards/redemptions` | 409 | pass | 7 | 2394990a-0044-4f6a-bac5-29acddc443d4 | QUOTE_ALREADY_REDEEMED  |
| journey | same key + different quote -> IDEMPOTENCY_KEY_CONFLICT; same quote + new key -> QUOTE_ALREADY_REDEEMED | `assert` | - | pass | 21 |  |   |
| userC | wallet balance | `GET /api/economy/wallet` | 200 | pass | 11 | 4c796f87-5ee7-429b-accf-6e6f1df01afe |   |
| userC | quote C V1 | `POST /api/rewards/quotes` | 201 | pass | 10 | 1676bc6f-8f88-427f-8547-f21f24313972 |  `{"quoteId":"e33656a8-b207-4e0b-8794-ca794d6037f7","source":"PROMO","points":800}` |
| userC | redeem C V1 | `POST /api/rewards/redemptions` | 201 | pass | 18 | 94225015-a151-4ffe-9067-a5f20d9db04f |  `{"redemptionId":"11dd5a8d-6c45-4483-a3fd-9875f0d5966c","reference":"RDM-2026-K9PC","ticketId":"11dd5a8d-6c45-4483-a3fd-9875f0d5966c","pointsSpent":800}` |
| userD | quote D V6 shared | `POST /api/rewards/quotes` | 201 | pass | 10 | 10ed2889-cdca-46c0-b1a3-b8b011971ea2 |  `{"quoteId":"e6e6e1c9-d2a6-4983-aaa7-7cdfe86cd19e","source":"BASE","points":600}` |
| userD | redeem D V6 shared | `POST /api/rewards/redemptions` | 201 | pass | 17 | 8aa06001-d308-4c5e-a0f1-7a4572ad5ba4 |  `{"redemptionId":"6115d597-30cd-47ee-8ded-f892778be32e","reference":"RDM-2026-FXEK","ticketId":"6115d597-30cd-47ee-8ded-f892778be32e","pointsSpent":600}` |
| userD | wallet balance | `GET /api/economy/wallet` | 200 | pass | 10 | 368fc068-1882-496b-883d-d985ac0833f0 |   |
| journey | C redeems V1, D redeems shared V6 (tickets for the faulty-code flow) | `assert` | - | pass | 76 |  |   |

## My vouchers

| Actor | Step | Request | Status | Result | ms | X-Request-Id | Key ids / error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| userA | list my vouchers | `GET /api/rewards/my-vouchers` | 200 | pass | 6 | 0427d5a6-494f-431b-b992-b7bffe4c7c37 |   |
| userA | ticket detail | `GET /api/rewards/my-vouchers/:id` | 200 | pass | 6 | 3f8c0ce6-5b18-4dc8-be65-cc951f25a7be |   |
| userA | mark used | `POST /api/rewards/my-vouchers/:id/use` | 200 | pass | 12 | 30559ef6-fee5-44c5-ab39-fcb44a570411 |   |
| userA | list after use | `GET /api/rewards/my-vouchers` | 200 | pass | 5 | b450c0a6-c8c5-4cf7-ae64-f235178a1f35 |   |
| userA | undo use | `POST /api/rewards/my-vouchers/:id/undo-use` | 200 | pass | 10 | 31632ede-1168-4e0d-9d2c-dc97ae4a3fb5 |   |
| journey | list by tab, detail with code, use, undo | `assert` | - | pass | 40 |  |  `{"unused":1}` |
| userB | B opens A's ticket | `GET /api/rewards/my-vouchers/:id` | 404 | pass | 4 | bb3255ce-f8e7-4515-8c52-b0c621483fe4 | TICKET_NOT_FOUND  |
| journey | another user's ticket is not found | `assert` | - | pass | 4 |  |   |

## Failure codes

| Actor | Step | Request | Status | Result | ms | X-Request-Id | Key ids / error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| userA | A quote V3 | `POST /api/rewards/quotes` | 201 | pass | 10 | f98b7f9b-1c88-4d0e-8e48-8e4a733309ef |   |
| userB | B quote V3 | `POST /api/rewards/quotes` | 201 | pass | 10 | a744f66b-3299-4218-b9bf-c6d3543c5041 |   |
| userA | A redeem V3 (last unit) | `POST /api/rewards/redemptions` | 201 | pass | 18 | d61e7d6b-b8a5-4440-917a-9e42aa35393e |   |
| userB | wallet balance | `GET /api/economy/wallet` | 200 | pass | 6 | bff9ccd8-8111-4871-adb1-c9b8f365f03c |   |
| userB | B redeem V3 (sold out) | `POST /api/rewards/redemptions` | 409 | pass | 11 | 5de5acd5-bbd9-418a-93a3-e91e77a59290 | SOLD_OUT  |
| userB | wallet balance | `GET /api/economy/wallet` | 200 | pass | 5 | f76d3808-4de4-4ff7-aaa9-193615962bfa |   |
| journey | SOLD_OUT: last unit taken between quote and confirm (V3) | `assert` | - | pass | 60 |  |   |
| userB | B quote V1 | `POST /api/rewards/quotes` | 201 | pass | 9 | 760c1e35-50f9-4d8e-a56b-8fe42a848c5f |   |
| admin | admin price change V1 | `POST /api/admin/rewards/vouchers/:id/price` | 200 | pass | 9 | 0ada2b21-0d37-4692-bf1a-d06825699cbf |   |
| admin | voucher detail after price change | `GET /api/admin/rewards/vouchers/:id` | 200 | pass | 6 | 0bf5849c-b6c2-40d8-90a1-1361955d2c3a |   |
| userB | wallet balance | `GET /api/economy/wallet` | 200 | pass | 5 | 40d971c4-2594-4874-96ed-7a06cc76ca8f |   |
| userB | B redeem V1 at stale price | `POST /api/rewards/redemptions` | 409 | pass | 20 | b3e01004-62fb-4f34-b7af-3f8b43164eb6 | PRICE_CHANGED  |
| userB | wallet balance | `GET /api/economy/wallet` | 200 | pass | 6 | fd8c657e-aa39-4cb9-8f38-380aee8de259 |   |
| journey | PRICE_CHANGED: Admin changes price between quote and confirm (V1) | `assert` | - | pass | 55 |  |   |
| userB | B quote V4 (800 of 1100) | `POST /api/rewards/quotes` | 201 | pass | 15 | e50d5b5f-67b9-43fd-9d27-9b5b954a7eca |   |
| userB | quote B V5 (spends 500) | `POST /api/rewards/quotes` | 201 | pass | 10 | 639fa928-35c3-4591-ae13-f0212ab37315 |  `{"quoteId":"023697eb-d1f9-46a2-b6f2-98ecbeb28d25","source":"BASE","points":500}` |
| userB | redeem B V5 (spends 500) | `POST /api/rewards/redemptions` | 201 | pass | 27 | 3c2788f2-b821-44df-a39c-c2f330f238ea |  `{"redemptionId":"3ccbb8aa-1656-458e-824b-60498c0f39f4","reference":"RDM-2026-IFAC","ticketId":"3ccbb8aa-1656-458e-824b-60498c0f39f4","pointsSpent":500}` |
| userB | wallet balance | `GET /api/economy/wallet` | 200 | pass | 6 | 6b97a236-b3a9-4c58-af9e-12fa911fbb6c |   |
| userB | B redeem V4 (not enough left) | `POST /api/rewards/redemptions` | 409 | pass | 17 | 7d7021ea-305e-4512-ac74-eb78a63506d9 | INSUFFICIENT_POINTS  |
| userB | wallet balance | `GET /api/economy/wallet` | 200 | pass | 7 | b6566ce1-7c0b-4e3a-9f47-1e76da87a411 |   |
| journey | INSUFFICIENT_POINTS: balance spent between quote and confirm (V4 then V5) | `assert` | - | pass | 82 |  |   |
| userC | C quote V4 | `POST /api/rewards/quotes` | 201 | pass | 10 | 7467e86e-fd3b-4d0c-beb5-2ae6e3d64d59 |   |
| admin | admin pause V4 | `PATCH /api/admin/rewards/vouchers/:id` | 200 | pass | 13 | f156d479-b0bf-4e4f-b140-da4e094579ca |   |
| userC | wallet balance | `GET /api/economy/wallet` | 200 | pass | 5 | d481547d-b461-4698-a99c-50a38d783358 |   |
| userC | C redeem paused V4 | `POST /api/rewards/redemptions` | 409 | pass | 10 | b59ad62b-e062-4d83-80f3-e26ea617e2ca | VOUCHER_UNAVAILABLE  |
| userC | wallet balance | `GET /api/economy/wallet` | 200 | pass | 5 | b2667bf7-da15-4f03-a6a8-465088336740 |   |
| admin | admin resume V4 | `PATCH /api/admin/rewards/vouchers/:id` | 200 | pass | 9 | b23d517c-6b0f-4da5-acf8-9a435384b4e5 |   |
| admin | admin hide V4 | `PATCH /api/admin/rewards/vouchers/:id` | 200 | pass | 9 | f043d2a3-ca0b-4ace-b14a-27802a54c3a2 |   |
| userC | C quote hidden V4 | `POST /api/rewards/quotes` | 404 | pass | 4 | e83dec0d-4d8c-4c2b-a4c6-067f9351459c | VOUCHER_NOT_FOUND  |
| userC | catalog without hidden V4 | `GET /api/rewards/vouchers?q=Journey%20V4%20726781` | 200 | pass | 5 | d835ef6e-3bc1-4b14-9e77-ff3fee18e5de |   |
| admin | admin unhide V4 | `PATCH /api/admin/rewards/vouchers/:id` | 200 | pass | 16 | fc8c8239-b384-413b-8a60-51a8ac9a1a80 |   |
| journey | VOUCHER_UNAVAILABLE: Admin pauses after quote (V4), then hide -> not found at quote | `assert` | - | pass | 88 |  |   |
| userE | wallet balance | `GET /api/economy/wallet` | 200 | pass | 21 | aca13775-a37b-4b88-b058-7d75a153339e |   |
| userE | E quote V1 (not activated) | `POST /api/rewards/quotes` | 403 | pass | 14 | 41b16e08-3196-4686-b318-e0f52667f804 | ACCOUNT_NOT_ELIGIBLE  |
| userE | wallet balance | `GET /api/economy/wallet` | 200 | pass | 7 | d781653d-6be8-4924-837b-49c6d58cd17c |   |
| journey | ACCOUNT_NOT_ELIGIBLE: ACCOUNT_NOT_ACTIVATED (E) | `assert` | - | pass | 42 |  |   |
| userA | quote A V5 #1 | `POST /api/rewards/quotes` | 201 | pass | 16 | 0a0e46e5-4d44-463d-ae9b-f0cb5f39433e |  `{"quoteId":"a23127c9-32cc-4c93-baac-df178b068a34","source":"BASE","points":500}` |
| userA | redeem A V5 #1 | `POST /api/rewards/redemptions` | 201 | pass | 36 | c202c21b-8226-4461-b349-59bddc42d38a |  `{"redemptionId":"d00f9aa1-cdcd-4c34-9e9f-0a3873a4dfca","reference":"RDM-2026-VDLQ","ticketId":"d00f9aa1-cdcd-4c34-9e9f-0a3873a4dfca","pointsSpent":500}` |
| userA | quote A V5 #2 | `POST /api/rewards/quotes` | 201 | pass | 15 | 7da3b285-5f02-4032-8be3-ff652586f6af |  `{"quoteId":"b2ca9141-51b3-4472-a4ae-05bb198e316e","source":"BASE","points":500}` |
| userA | redeem A V5 #2 | `POST /api/rewards/redemptions` | 201 | pass | 22 | c9a076b3-0ff6-473f-a4e3-e62df11caa5a |  `{"redemptionId":"9bbda9c0-8a1c-4294-bee5-862b27dc51e3","reference":"RDM-2026-B9P4","ticketId":"9bbda9c0-8a1c-4294-bee5-862b27dc51e3","pointsSpent":500}` |
| userA | wallet balance | `GET /api/economy/wallet` | 200 | pass | 6 | 8508f7b7-0c16-4568-8a6f-ed562b21b4f7 |   |
| userA | A quote V5 3rd time | `POST /api/rewards/quotes` | 403 | pass | 12 | 8f233b18-494f-46d8-bb1b-4b1f75546937 | ACCOUNT_NOT_ELIGIBLE  |
| userA | wallet balance | `GET /api/economy/wallet` | 200 | pass | 9 | 0f446e8b-27b7-478c-b9d8-0e4f28c5e26e |   |
| journey | ACCOUNT_NOT_ELIGIBLE: VOUCHER_LIMIT_REACHED (A, 3rd V5 in 30 days) | `assert` | - | pass | 116 |  |   |

## Admin stock

| Actor | Step | Request | Status | Result | ms | X-Request-Id | Key ids / error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| admin | stock below issued | `POST /api/admin/rewards/vouchers/:id/stock` | 409 | pass | 10 | 88e70dd5-5421-4228-9b89-13c0f82099bd | STOCK_BELOW_COMMITTED  |
| admin | stock increase needs codes | `POST /api/admin/rewards/vouchers/:id/stock` | 409 | pass | 9 | ac56ccb8-b13f-471f-a0de-8869c029fddf | STOCK_INCREASE_NEEDS_CODES  |
| admin | stock decrease 9 -> 8 | `POST /api/admin/rewards/vouchers/:id/stock` | 200 | pass | 17 | ad033afe-15e2-475a-940d-baf420337a01 |   |
| journey | stock adjust: below issued+reserved rejected; increase without codes rejected; decrease ok | `assert` | - | pass | 36 |  |   |

## Flash

| Actor | Step | Request | Status | Result | ms | X-Request-Id | Key ids / error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| admin | flash monitor F1 (active) | `GET /api/admin/rewards/flash-sales/:id` | 200 | pass | 36 | d3aabf20-02be-4889-b05e-4a91f80788fe |   |
| admin | voucher detail V2 (reserved) | `GET /api/admin/rewards/vouchers/:id` | 200 | pass | 12 | 347de4b4-fdee-4624-910c-5947f34d56fe |   |
| journey | wait for F1, F2, F3 reserved_at (lifecycle job) | `assert` | - | pass | 63340 |  |   |
| userA | user flash list | `GET /api/rewards/flash-sales` | 200 | pass | 9 | c5abef0b-629a-4d34-9251-2334e7ca2756 |   |
| journey | user flash list shows F1 | `assert` | - | pass | 9 |  |   |
| userA | userA quote V2 (flash) | `POST /api/rewards/quotes` | 201 | pass | 18 | bbed416f-5b81-46c2-8ee2-f925a80a91d5 |  `{"source":"FLASH","points":600}` |
| userB | userB quote V2 (flash) | `POST /api/rewards/quotes` | 201 | pass | 10 | bb7727fc-910f-481c-8535-f9e3e2bee6d5 |  `{"source":"FLASH","points":600}` |
| userC | userC quote V2 (flash) | `POST /api/rewards/quotes` | 201 | pass | 10 | 1dd25ea1-bef0-4a4c-a1d1-2b2e4559f261 |  `{"source":"FLASH","points":600}` |
| userD | userD quote V2 (flash) | `POST /api/rewards/quotes` | 201 | pass | 9 | 7dbb856b-5f0a-4c8d-b8d9-a73db6a2201f |  `{"source":"FLASH","points":600}` |
| userA | userA redeem flash | `POST /api/rewards/redemptions` | 201 | pass | 36 | 28a580a9-b90e-4605-8748-625c22d5813a |   |
| userA | A second flash quote (cap 1) | `POST /api/rewards/quotes` | 403 | pass | 11 | ddd6f596-ebcd-4164-8e94-f500774a10a4 | ACCOUNT_NOT_ELIGIBLE  |
| userB | userB redeem flash | `POST /api/rewards/redemptions` | 201 | pass | 21 | eb4dc347-83cb-4276-8dd4-86cd7fd84c8a |   |
| userC | userC redeem flash | `POST /api/rewards/redemptions` | 201 | pass | 21 | 2fec9ce8-0f0c-4c32-bb3f-a12cf1521bdf |   |
| userD | wallet balance | `GET /api/economy/wallet` | 200 | pass | 7 | 21c3244b-99a7-4ea5-8658-301e12fd1fca |   |
| userD | D redeem flash quote after sell-out (regular stock left) | `POST /api/rewards/redemptions` | 409 | pass | 12 | 00b7d827-9e9c-4254-b52b-2360e761b122 | PRICE_CHANGED  |
| userD | wallet balance | `GET /api/economy/wallet` | 200 | pass | 4 | 1e5cdb9b-6d87-45a8-9edc-77f551eed14b |   |
| admin | flash monitor F1 (sold out) | `GET /api/admin/rewards/flash-sales/:id` | 200 | pass | 7 | f9b41e48-6ba3-4c25-b1dd-5837f8a7a06e |   |
| admin | admin flash list | `GET /api/admin/rewards/flash-sales` | 200 | pass | 10 | f0877cd8-69e5-4859-8cd4-0a12a36fc9f4 |   |
| journey | Flash: A,B,C,D quote FLASH; A,B,C redeem; per-user cap; D loses (PRICE_CHANGED to regular price); sale sold out | `assert` | - | pass | 186 |  |   |
| userC | quote C V8 (flash, quota == stock) | `POST /api/rewards/quotes` | 201 | pass | 8 | dd1cea2f-65b9-4fb0-85f3-40169681498e |  `{"quoteId":"cade39ce-496c-4613-90e1-7bb5897c2057","source":"FLASH","points":400}` |
| userC | redeem C V8 (flash, quota == stock) | `POST /api/rewards/redemptions` | 201 | pass | 18 | 352e764d-e921-46c7-bf2c-884f6f4000bd |  `{"redemptionId":"d741e26d-cb05-4c71-a471-a86b730923c6","reference":"RDM-2026-NQRA","ticketId":"d741e26d-cb05-4c71-a471-a86b730923c6","pointsSpent":400}` |
| journey | Flash where quota = whole stock (stock_remaining 0 after reserve): first redeem succeeds | `assert` | - | pass | 27 |  |   |
| userA | A quote V7 (flash needs a recent survey) | `POST /api/rewards/quotes` | 403 | pass | 7 | 5dd41b3a-3b37-424c-90aa-767cde62c890 | ACCOUNT_NOT_ELIGIBLE  |
| admin | end F2 reason OTHER without note | `POST /api/admin/rewards/flash-sales/:id/end` | 400 | pass | 5 | d3839e6c-7384-4752-a18d-273963c750a7 | VALIDATION_ERROR  |
| admin | end F2 early | `POST /api/admin/rewards/flash-sales/:id/end` | 200 | pass | 13 | ca471620-48ef-4f86-b9ad-d8f68d2dadb4 |   |
| admin | end F2 again | `POST /api/admin/rewards/flash-sales/:id/end` | 409 | pass | 6 | 96e3ffaf-dc05-4e51-a311-855675542921 | FLASH_ALREADY_ENDED  |
| admin | poll V7 stock | `GET /api/admin/rewards/vouchers/:id` | 200 | pass | 4 | 3a431016-911a-4de2-8372-f54a8c56bfc0 |   |
| journey | Flash F2: ACCOUNT_NOT_ELIGIBLE NO_RECENT_SURVEY; Admin ends early; unsold quota returns | `assert` | - | pass | 35 |  |   |

## Faulty code

| Actor | Step | Request | Status | Result | ms | X-Request-Id | Key ids / error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| userA | userA reports code issue | `POST /api/rewards/my-vouchers/:id/issues` | 201 | pass | 7 | 3ffd62a0-7825-4fe3-b0c8-a1438fc3f874 |  `{"reportId":"448ca797-d57f-4d75-9207-f9fa9c259b34","status":"OPEN"}` |
| userC | userC reports code issue | `POST /api/rewards/my-vouchers/:id/issues` | 201 | pass | 7 | f7e6af09-6217-4107-ac6d-0c70769e5956 |  `{"reportId":"096f7e7d-fba2-4535-b7c3-d034bfd0e24c","status":"OPEN"}` |
| userD | userD reports code issue | `POST /api/rewards/my-vouchers/:id/issues` | 201 | pass | 7 | 05cd10cd-0373-4f63-85f9-c34a1858619d |  `{"reportId":"7ea1d6ae-8fed-4a95-9050-52e9d380fb99","status":"OPEN"}` |
| userA | A reports again | `POST /api/rewards/my-vouchers/:id/issues` | 409 | pass | 6 | 0d6e703a-196b-4fa5-890f-faced15be732 | CODE_ISSUE_ALREADY_OPEN  |
| userA | A ticket shows open issue | `GET /api/rewards/my-vouchers/:id` | 200 | pass | 7 | 675237f5-f648-4fab-ab1f-0fa3932f60c1 |   |
| journey | users report: A (V1), C (V1), D (V6 shared); duplicate report refused | `assert` | - | pass | 34 |  |   |
| admin | admin code-issue queue (OPEN) | `GET /api/admin/rewards/code-issues?status=OPEN&limit=50` | 200 | pass | 13 | 026ed9e3-15c8-4603-a819-8e6571178bcf |   |
| admin | admin code-issue detail | `GET /api/admin/rewards/code-issues/:id` | 200 | pass | 9 | 18e452a8-e79b-432a-b686-c3d4071f4153 |   |
| journey | Admin queue lists them; canReplace and reason; no code value in payloads | `assert` | - | pass | 22 |  |  `{"open":3}` |
| userD | wallet balance | `GET /api/economy/wallet` | 200 | pass | 5 | 0ee6ef59-d39a-49bb-8c3b-23cb70b83d46 |   |
| admin | reject without note | `POST /api/admin/rewards/code-issues/:id/resolve` | 400 | pass | 4 | 76b208a9-33fe-42a9-aa3f-9cff3a3c9459 | VALIDATION_ERROR  |
| admin | replace a shared code | `POST /api/admin/rewards/code-issues/:id/resolve` | 409 | pass | 10 | dd277a6a-3b7f-44a9-95ec-35842d563c57 | REPLACEMENT_NOT_SUPPORTED  |
| admin | reject with note | `POST /api/admin/rewards/code-issues/:id/resolve` | 200 | pass | 11 | b3bab2f7-9ea6-4d63-9725-49d5c19a1da5 |   |
| admin | refund after reject | `POST /api/admin/rewards/code-issues/:id/resolve` | 409 | pass | 5 | 17ea69ae-c56b-4090-a25a-5b2944361130 | CODE_ISSUE_ALREADY_RESOLVED  |
| userD | wallet balance | `GET /api/economy/wallet` | 200 | pass | 5 | eae3ee53-8803-4017-afac-954feffb50fd |   |
| journey | REJECT: note required; REPLACE refused for shared code; REJECT with note; already resolved | `assert` | - | pass | 42 |  |   |
| admin | replace code | `POST /api/admin/rewards/code-issues/:id/resolve` | 200 | pass | 12 | 44a60222-6a4c-482e-8069-fe3c644b3f9e |   |
| userA | A ticket after replace | `GET /api/rewards/my-vouchers/:id` | 200 | pass | 6 | f21e2e4c-204c-4ac5-96ed-0d0b5a697c78 |   |
| admin | replace again (idempotent) | `POST /api/admin/rewards/code-issues/:id/resolve` | 200 | pass | 6 | 76667223-81de-4933-badf-08c8b6a45554 |   |
| admin | refund after replace | `POST /api/admin/rewards/code-issues/:id/resolve` | 409 | pass | 4 | 0ee969f3-b008-4404-8257-f898a0a503fb | CODE_ISSUE_ALREADY_RESOLVED  |
| journey | REPLACE: user gets a different code; replay is idempotent; refund after replace refused | `assert` | - | pass | 29 |  |   |
| userC | wallet balance | `GET /api/economy/wallet` | 200 | pass | 5 | 90645e64-fb98-4894-99a2-4e3d7b2ef69e |   |
| admin | refund | `POST /api/admin/rewards/code-issues/:id/resolve` | 200 | pass | 15 | f4dc6674-82c0-43ac-98bf-42f2ced6a78d |   |
| userC | wallet balance | `GET /api/economy/wallet` | 200 | pass | 5 | 5012672f-9a84-47ea-a290-c8b113f11024 |   |
| userC | C history | `GET /api/rewards/redemptions?limit=50` | 200 | pass | 17 | 28e823d6-6df2-46d9-9109-36c424bb96ab |   |
| journey | REFUND: RFD- reference, wallet restored, history REFUNDED | `assert` | - | pass | 43 |  |   |

## History

| Actor | Step | Request | Status | Result | ms | X-Request-Id | Key ids / error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| userB | B history | `GET /api/rewards/redemptions?limit=50` | 200 | pass | 14 | 1daad181-b30b-4f5f-93c4-b259dda698b9 |   |
| userB | B history page 1 | `GET /api/rewards/redemptions?limit=1&offset=0` | 200 | pass | 6 | 02c92df9-10e8-48bd-86d4-04dd8752470b |   |
| userA | A history | `GET /api/rewards/redemptions?limit=50` | 200 | pass | 6 | d417899b-0131-41a7-99e9-c6b9e1e65b28 |   |
| journey | history: Success / Failed / Refunded, pagination | `assert` | - | pass | 28 |  |  `{"failedCodes":["INSUFFICIENT_POINTS","PRICE_CHANGED","SOLD_OUT"]}` |

## Notifications

| Actor | Step | Request | Status | Result | ms | X-Request-Id | Key ids / error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| userA | userA notifications | `GET /api/notifications` | 200 | pass | 5 | 52fcb042-1f25-4f5a-be79-6146d7483146 |   |
| userA | userA notifications | `GET /api/notifications` | 200 | pass | 29 | 3aacdb99-4751-43a8-821f-aaf653f86d06 |   |
| userC | userC notifications | `GET /api/notifications` | 200 | pass | 13 | 5ac24e13-d1bd-476b-90c5-5a3fc36817e4 |   |
| userD | userD notifications | `GET /api/notifications` | 200 | pass | 8 | c476527c-db96-418f-8b27-37bd59410532 |   |
| journey | faulty-code notifications reach A, C and D | `assert` | - | pass | 1058 |  |   |

## Stats

| Actor | Step | Request | Status | Result | ms | X-Request-Id | Key ids / error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| admin | admin stats (today) | `GET /api/admin/rewards/stats?from=2026-10-15&to=2026-10-15` | 200 | pass | 20 | fd1fbc1e-7104-4cb4-b247-b5e17f7269c4 |   |
| journey | GET /admin/rewards/stats matches the run (refunded excluded) | `assert` | - | pass | 43 |  |  `{"statsCount":10,"runCounted":10,"pointsSpent":5600}` |

## SQL

| Actor | Step | Request | Status | Result | ms | X-Request-Id | Key ids / error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sql | every journal sums to zero | `SQL` | - | pass | 0 |  |  `{"unbalancedJournals":0}` |
| sql | each SUCCEEDED redemption has exactly one journal keyed redemption:{userId}:{key}, linked via journal_id | `SQL` | - | pass | 0 |  |  `{"succeeded":11,"violations":0}` |
| sql | each refund has exactly one journal keyed redemption-refund:{reportId}, linked via journal_id | `SQL` | - | pass | 0 |  |  `{"refunds":1,"violations":0}` |
| sql | stock_total = stock_remaining + flash reserved + issued (per voucher) | `SQL` | - | pass | 0 |  |  `{"vouchers":8,"violations":0,"firstViolation":null}` |
| sql | each code assigned at most once | `SQL` | - | pass | 0 |  |  `{"codesIssuedTwice":0,"replacementAlsoIssued":0}` |
| sql | ledger accounts: no balance drift, no negative user account | `SQL` | - | pass | 0 |  |  `{"driftedAccounts":0,"negativeUserAccounts":0}` |

## 8.4 SQL checks

| Check | Result | Counts |
| --- | --- | --- |
| every journal sums to zero | pass | `{"unbalancedJournals":0}` |
| each SUCCEEDED redemption has exactly one journal keyed redemption:{userId}:{key}, linked via journal_id | pass | `{"succeeded":11,"violations":0}` |
| each refund has exactly one journal keyed redemption-refund:{reportId}, linked via journal_id | pass | `{"refunds":1,"violations":0}` |
| stock_total = stock_remaining + flash reserved + issued (per voucher) | pass | `{"vouchers":8,"violations":0,"firstViolation":null}` |
| each code assigned at most once | pass | `{"codesIssuedTwice":0,"replacementAlsoIssued":0}` |
| ledger accounts: no balance drift, no negative user account | pass | `{"driftedAccounts":0,"negativeUserAccounts":0}` |

## Route sweep (flag on, signed in)

| Actor | Route | Status | Expected | Result |
| --- | --- | --- | --- | --- |
| admin | `/admin/vouchers` | 200 | 200 | pass |
| admin | `/admin/vouchers/new` | 200 | 200 | pass |
| admin | `/admin/vouchers/[id]` | 200 | 200 | pass |
| admin | `/admin/vouchers/[id]/edit` | 200 | 200 | pass |
| admin | `/admin/flash-sales` | 200 | 200 | pass |
| admin | `/admin/flash-sales/new` | 200 | 200 | pass |
| admin | `/admin/flash-sales/[id]/edit` | 200 | 200 | pass |
| admin | `/admin/code-issues` | 200 | 200 | pass |
| admin | `/admin/voucher-stats` | 200 | 200 | pass |
| userA | `/rewards` | 200 | 200 | pass |
| userA | `/rewards/[id]` | 200 | 200 | pass |
| userA | `/rewards/my-vouchers` | 200 | 200 | pass |
| userA | `/rewards/my-vouchers/[ticketId]` | 200 | 200 | pass |
| userA | `/rewards/history` | 200 | 200 | pass |

## Flag-off sweep (REWARDS_ENABLED=false, NEXT_PUBLIC_REWARDS_ENABLED unset)

| Check | Status | Expected | Result |
| --- | --- | --- | --- |
| page /admin/vouchers (admin) | 404 | 404 | pass |
| page /admin/vouchers/new (admin) | 404 | 404 | pass |
| page /admin/vouchers/[id] (admin) | 404 | 404 | pass |
| page /admin/vouchers/[id]/edit (admin) | 404 | 404 | pass |
| page /admin/flash-sales (admin) | 404 | 404 | pass |
| page /admin/flash-sales/new (admin) | 404 | 404 | pass |
| page /admin/flash-sales/[id]/edit (admin) | 404 | 404 | pass |
| page /admin/code-issues (admin) | 404 | 404 | pass |
| page /admin/voucher-stats (admin) | 404 | 404 | pass |
| page /rewards (user) | 404 | 404 | pass |
| page /rewards/[id] (user) | 404 | 404 | pass |
| page /rewards/my-vouchers (user) | 404 | 404 | pass |
| page /rewards/my-vouchers/[ticketId] (user) | 404 | 404 | pass |
| page /rewards/history (user) | 404 | 404 | pass |
| API GET /rewards/vouchers (user, valid session) | 404 | 404 | pass |
| API GET /admin/rewards/vouchers (admin, valid session) | 404 | 404 | pass |
| API GET /admin/rewards/stats (admin, valid session) | 404 | 404 | pass |
| wallet page (user) is served | 200 | 200 | pass |
| wallet shows the cash copy (found in: JS chunk 19k9_l3al1bgu.js) | 200 | 200 | pass |
