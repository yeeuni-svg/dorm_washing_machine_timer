# 율곡관 세탁실 연결 테스트

The existing dashboard now has a private SmartThings connection dialog. The Site remains owner-only. Samsung read-only access is tested against washer 5; the other nine devices are unconnected.

## Runtime configuration

`LAUNDRY_SESSION_KEY` is a 32-byte encryption key represented as 64 lowercase hex characters. Configure it as a secret using Sites runtime settings. Never put a Samsung PAT in source, runtime configuration files, browser storage, logs, or a chat message. The owner enters the PAT in the connection dialog instead.

## Session and request behavior

- The Worker requires the authenticated identity supplied by Sites for every laundry API request. POST endpoints require the same Origin and JSON content type.
- A successful connection verifies the fixed washer with read-only Samsung GET requests. It encrypts the PAT and user-bound session using AES-GCM in an HttpOnly, Secure, SameSite=Strict `__Host-` cookie. The original PAT is not returned in the JSON response.
- The session is scoped to this browser for at most 24 hours. The PAT still expires 24 hours after its original issuance, which may happen earlier. API 401 clears the cookie.
- Visible pages poll every 10 seconds. The Worker coalesces/cache-reuses status reads for 8 seconds per session. Hidden pages stop polling. Missing or unavailable data is never converted into a countdown or a zero-minute estimate.
- Device health is read when available. A reported offline device suppresses remaining time. This prototype does not infer laundry collection or diagnose faults.
- The timestamps distinguish when this service checked Samsung from when Samsung last recorded the device attribute. Polling cannot increase the washer's own reporting frequency.
- The disconnect button removes only this browser's session, never Samsung device registration.

## Checks

`node --test tests/laundry-server.test.mjs` covers identity, CSRF, encryption, isolation, expiration, real-value normalization, missing data, offline and pause states, upstream rate limits, and disconnect behavior using a mock Samsung response. A real end-to-end Samsung check requires the owner to enter their PAT on the deployed site.

## Production follow-up

This is a temporary, owner-private test, not a shared dorm service. Institution-owned Samsung access, persistent OAuth credentials, centralized event delivery/cache, and hosting ownership must be established before student rollout. Do not make this Site public as a substitute for implementing administrator authorization. The static design's artificial examples are clearly marked and hidden while a live session is connected.
