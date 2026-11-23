# RFID Attendance – Vercel connection package

## Files
- `UENR_SMART_ATTENDANCE_WIFI_INTEGRATED_VERCEL.ino`: your friend's integrated ESP32 sketch with the Vercel HTTPS connection and JSON request corrected.
- `BACKEND_API_NOTES.txt`: the existing GitHub `index.js` API contract this sketch is designed to call.

## Before uploading to the ESP32
Open the `.ino` file and replace these placeholders locally:
- `YOUR_WIFI_NAME`
- `YOUR_WIFI_PASSWORD`
- `YOUR_SCAN_KEY` (must exactly match the Production `SCAN_KEY` value in Vercel)

The Vercel scan URL is already set to:
`https://rfid-attendance-cloud.vercel.app/api/scan`

Do not commit your real Wi-Fi password or scan key to a public GitHub repository.
Use a private local copy or a separate secrets header excluded by `.gitignore`.

## Important hardware/data checks
1. This sketch retains your friend's pin assignments, including `RFID_RST_PIN 4`.
   Confirm your physical wiring matches these pins before uploading.
2. The friend's local student allow-list is checked before the web upload is attempted.
   The UID must match one of the entries in `students[]` exactly.
3. Your previously shown Serial Monitor UID was `D6 E1 31 03` (hex string `D6E13103`).
   The uploaded friend's file contains `D5 E1 31 03` (`D5E13103`) for the YAA BABY entry.
   Confirm which UID is actually on the card and correct the local entry if necessary.
4. The backend also looks up the UID in the Neon `students.uid` column. The same UID must exist there.
5. `WiFiClientSecure.setInsecure()` is included as a temporary connectivity test. It does not validate Vercel's TLS certificate. For production, replace it with certificate validation using the appropriate root CA.
6. The sketch uses the ESP32 Arduino core's `WiFiClientSecure` and `HTTPClient` libraries.

## Backend contract verified from the current GitHub `rfid-vercel/index.js`
- Route: `POST /api/scan`
- Header: `x-scan-key` must equal the Vercel `SCAN_KEY`
- JSON body: `{"uid":"D6E13103","device":"UENR-ATTENDANCE-01"}`
- Success response: HTTP 201 with JSON containing `ok: true`
- Unknown UID: HTTP 404
- Already marked present today: HTTP 409

The existing `index.js` already implements this route and does not need a change for the request format above.
