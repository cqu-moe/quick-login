# Web Store CRX fixture

`webstore-test.crx` was produced by real Chrome using a disposable RSA-4096 key. No private key is retained. It contains only synthetic MV3 files at version 0.4.9 with sourceCommit `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`.

Public-key DER SPKI SHA-256: `0d1d30c24f6545ca8109db07f0771aac54c1cae6eaf9c37873a46687091286f7`.

The fixture tests signature verification without requiring Chrome. `test_real_chrome_signing_smoke` generates a fresh temporary key and tests the complete signing path when Chrome is installed.
