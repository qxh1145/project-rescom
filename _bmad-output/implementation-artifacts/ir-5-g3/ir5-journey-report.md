# IR.5 G3 journey report (ir5-2026-10-03T05-41-03-664Z)

- Base URL: http://localhost:3000 (pilot build, `/api` rewrite → backend); DB: `rescom_ir5_check`
- Result: **PASS**
- Journey steps: 44/44 ok; routes: 36/36 ok

## Journey (D1)

| Actor | Step | Request | Status | Result | ms | X-Request-Id | Key ids / error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| publisher | register (email) | `POST /api/auth/register` | 201 | pass | 353 | 5fb53bd6-7c29-4203-a108-51f034504482 |  `{"userId":"0368dc02-06ee-46f7-ab1c-5b116fec0a38"}` |
| publisher | csrf token | `GET /api/auth/csrf` | 200 | pass | 9 | 2a4b903f-5116-47b4-bee2-79a588b819b0 |   |
| publisher | scratch-DB role → PUBLISHER | `SQL` | — | pass | 0 |  |   |
| publisher | login | `POST /api/auth/login` | 200 | pass | 273 | d31b78ee-8976-4b07-8f44-50609153528e |   |
| publisher | csrf token | `GET /api/auth/csrf` | 200 | pass | 6 | 390e5be1-51c6-4348-b229-17a51a3b2c0c |   |
| publisher | demographics onboarding | `POST /api/demographics/survey` | 200 | pass | 33 | c40cb33b-98e3-4859-9010-7018f2ef3fdc |   |
| admin A | register (email) | `POST /api/auth/register` | 201 | pass | 295 | 1029fd3c-b171-4c6b-a92a-19da2dc906a0 |  `{"userId":"ce223a3d-5d6b-4589-9bc0-aa68b3790745"}` |
| admin A | csrf token | `GET /api/auth/csrf` | 200 | pass | 6 | ad633957-25f1-492a-9f28-5349d5fa8089 |   |
| admin A | scratch-DB role → ADMIN | `SQL` | — | pass | 0 |  |   |
| admin A | login | `POST /api/auth/login` | 200 | pass | 295 | 24853477-a3b2-48ed-b49a-cec3841cca16 |   |
| admin A | csrf token | `GET /api/auth/csrf` | 200 | pass | 6 | f8a4c919-3896-4424-ace0-fb81bfbd3786 |   |
| admin A | demographics onboarding | `POST /api/demographics/survey` | 200 | pass | 20 | 92b95bb7-1737-4ad7-8fd3-abe1b2fc47c5 |   |
| admin B | register (email) | `POST /api/auth/register` | 201 | pass | 284 | 3236195b-add8-432f-aa3c-8b0b59807697 |  `{"userId":"b2228d89-1c6a-4046-a0d4-8dabf18086fe"}` |
| admin B | csrf token | `GET /api/auth/csrf` | 200 | pass | 4 | 0ed81e4b-a540-45fa-83f2-2005a98373a1 |   |
| admin B | scratch-DB role → ADMIN | `SQL` | — | pass | 0 |  |   |
| admin B | login | `POST /api/auth/login` | 200 | pass | 264 | 0cb74370-593d-4e56-88a7-b42ca688b5a1 |   |
| admin B | csrf token | `GET /api/auth/csrf` | 200 | pass | 5 | 2651fb72-72d6-45cf-a712-df8c03bd1f5c |   |
| admin B | demographics onboarding | `POST /api/demographics/survey` | 200 | pass | 19 | e68bd3ab-6d2d-468b-8520-f1e8484d78ed |   |
| respondent | register (email) | `POST /api/auth/register` | 201 | pass | 279 | 9c9af3eb-4b99-49ae-a4ba-1fd5ecbdcfed |  `{"userId":"77d067ad-234a-4b3a-88e6-b03d2e6d18a1"}` |
| respondent | csrf token | `GET /api/auth/csrf` | 200 | pass | 4 | 0db4e05e-3c1b-449a-a4b3-68a5cd360f59 |   |
| respondent | demographics onboarding | `POST /api/demographics/survey` | 200 | pass | 14 | 80cb9590-c507-40d4-9775-92fa342f4933 |   |
| admin A | admin A requests own top-up | `POST /api/economy/top-ups` | 201 | pass | 8 | 85c9b15d-34a8-4ac6-8810-125346ad2d5d |  `{"topUpId":"5bd9be39-1385-4166-b072-ba10ba1dd1d6"}` |
| admin A | admin A self-approval refused | `POST /api/admin/top-ups/:id/approve` | 403 | pass | 9 | 8a74aebd-8d1c-467c-a063-d89a92fee79d | TOPUP_SELF_REVIEW_FORBIDDEN  |
| publisher | publisher top-up request | `POST /api/economy/top-ups` | 201 | pass | 5 | 0806188e-d0d0-470e-8f9b-7f7e0520a86e |  `{"topUpId":"27d95b27-2f51-4f0d-a643-f5046f01e52d"}` |
| admin A | admin A approves top-up | `POST /api/admin/top-ups/:id/approve` | 200 | pass | 19 | de86a165-a26f-49fa-8155-c2a421f66b16 |   |
| admin A | admin A approve replay (idempotent) | `POST /api/admin/top-ups/:id/approve` | 200 | pass | 7 | 6ba7bddb-973e-48e0-9100-34079c4e53e7 |   |
| publisher | create internal form | `POST /api/forms` | 201 | pass | 10 | 68197cb5-654d-406e-9334-35fa8a129688 |  `{"formId":"6335cda7-2a4c-4545-9d89-ee9e6650e604"}` |
| publisher | publish with escrow | `POST /api/forms/:id/publish` | 200 | pass | 24 | 252af202-4552-4e48-bdf2-3929ccd2fece |  `{"formVersionId":"0c666f1f-df68-4bf8-98eb-3713da0df66c","status":"MODERATION_QUEUE"}` |
| admin B | admin B moderation approve | `POST /api/admin/moderation/surveys/:id/approve` | 200 | pass | 19 | 75076ccc-9a15-492e-90c2-78e437586ae9 |   |
| respondent | marketplace feed | `GET /api/marketplace/feed` | 200 | pass | 9 | a3549d37-400c-4d28-b88c-e95ab08edc7a |   |
| respondent | survey summary | `GET /api/surveys/:id` | 200 | pass | 6 | 75f0f693-2119-4140-a84c-e4051950ac54 |   |
| respondent | start attempt | `POST /api/surveys/:id/attempts` | 201 | pass | 31 | 55e6f8f1-a910-4ff2-8756-866161124d13 |  `{"attemptId":"d9cb0846-d1a2-4455-bca4-f7fe5fd5774d","responseId":"8c48ebf6-5422-4283-b9bf-8fb450b0752b","formVersionId":"0c666f1f-df68-4bf8-98eb-3713da0df66c"}` |
| respondent | pinned form read | `GET /api/attempts/:id` | 200 | pass | 8 | 80d5dd81-7b21-4bb6-8fbc-18bd691bafa9 |   |
| respondent | upload initiate (presign) | `POST /api/storage/uploads/initiate` | 201 | pass | 12 | 091f7375-b5de-4edc-8db1-607d3818d269 |  `{"objectId":"ee0e69c7-5af7-410d-8076-2c1d7246110b"}` |
| respondent | browser PUT to presigned URL (MinIO, out-of-API) | `PUT <presigned>` | 200 | pass | 5 |  |   |
| respondent | finalize (scan → CLEAN) | `POST /api/storage/uploads/:id/finalize` | 200 | pass | 54 | f1bceac2-cf22-4795-9f73-1a2294a488be |  `{"objectId":"ee0e69c7-5af7-410d-8076-2c1d7246110b","status":"CLEAN"}` |
| respondent | submit | `POST /api/responses/:id/submit` | 200 | pass | 181 | 25f3260d-d0e4-473a-af81-bc85052f2d0e |  `{"status":"VALIDATED","reward":"SETTLED","journalId":"ad66303e-7ad1-41b7-b6d8-d00c0e71dc8e"}` |
| respondent | submit replay, same key (idempotent) | `POST /api/responses/:id/submit` | 200 | pass | 14 | 3eb65547-72b6-4464-9bc1-de4a86721a19 |  `{"journalId":"ad66303e-7ad1-41b7-b6d8-d00c0e71dc8e"}` |
| respondent | outcome | `GET /api/attempts/:id/outcome` | 200 | pass | 14 | 470826c6-45f5-4140-b899-05f05d07b575 |  `{"attemptStatus":"COMPLETED"}` |
| respondent | wallet | `GET /api/economy/wallet` | 200 | pass | 14 | 929b838a-9209-441a-bd7c-eb71e8b23216 |  `{"available":110,"pending":0}` |
| respondent | notifications | `GET /api/notifications` | 200 | pass | 5 | 814c48fd-cb60-4281-b761-f6f1a6fee7f7 |  `{"count":2}` |
| admin A | admin ledger journals | `GET /api/admin/ledger/journals` | 200 | pass | 13 | 3f5b9354-5e50-44b4-bee2-7f3aa996a9a4 |  `{"journals":41}` |
| sql | escrow, reward and top-up journals: exactly one each, zero-sum | `SQL` | — | pass | 0 |  |  `{"publish":1,"internal-reward":1,"topup-approval":1,"zeroSum":true}` |
| sql | ledger invariants (whole scratch DB) | `SQL` | — | pass | 0 |  |  `{"unbalancedJournals":0,"driftedAccounts":0,"negativeUserAccounts":0,"duplicateKeys":0}` |

## Pilot route sweep (E1)

| Actor | Route | Status | Expected | Result |
| --- | --- | --- | --- | --- |
| respondent | `/account/trust` | 404 | 404 | pass |
| respondent | `/account/streak` | 404 | 404 | pass |
| respondent | `/account/tier` | 404 | 404 | pass |
| respondent | `/leaderboard` | 404 | 404 | pass |
| respondent | `/forms/:id/complaints/:id` | 404 | 404 | pass |
| respondent | `/forms/:id/quality` | 404 | 404 | pass |
| respondent | `/forms/:id/export` | 404 | 404 | pass |
| respondent | `/admin/quality` | 404 | 404 | pass |
| respondent | `/forms/new/builder/ai` | 404 | 404 | pass |
| respondent | `/forms/:id/builder/ai` | 404 | 404 | pass |
| respondent | `/f/:id` | 404 | 404 | pass |
| respondent | `/marketplace` | 200 | 200 | pass |
| respondent | `/wallet` | 200 | 200 | pass |
| respondent | `/wallet/top-up` | 200 | 200 | pass |
| respondent | `/notifications` | 200 | 200 | pass |
| respondent | `/account` | 200 | 200 | pass |
| respondent | `/account/profile` | 200 | 200 | pass |
| respondent | `/onboarding` | 200 | 200 | pass |
| publisher | `/forms` | 200 | 200 | pass |
| publisher | `/forms/new` | 200 | 200 | pass |
| publisher | `/forms/new/builder` | 200 | 200 | pass |
| publisher | `/forms/new/google-form` | 200 | 200 | pass |
| admin A | `/admin` | 200 | 200 | pass |
| admin A | `/admin/surveys` | 200 | 200 | pass |
| admin A | `/admin/top-ups` | 200 | 200 | pass |
| admin A | `/admin/transactions` | 200 | 200 | pass |
| admin A | `/admin/users` | 200 | 200 | pass |
| admin A | `/admin/disputes` | 200 | 200 | pass |
| admin A | `/admin/fraud-log` | 200 | 200 | pass |
| guest | `/` | 200 | 200 | pass |
| guest | `/login` | 200 | 200 | pass |
| guest | `/register` | 200 | 200 | pass |
| guest | `/forgot-password` | 200 | 200 | pass |
| guest | `/privacy` | 200 | 200 | pass |
| guest | `/terms` | 200 | 200 | pass |
| respondent | `/dashboard` | 307 | 307 | pass |
