# Contributing

1. Fork the repository and create a focused branch.
2. Run `npm ci --ignore-scripts`.
3. Make the smallest complete change.
4. Run `npm run check:public`, `npm test`, and `npm run build`.
5. Open a pull request describing behavior, risk, and validation.

Never commit credentials, member rosters, contact details, real meeting exports,
internal links, local paths, QR codes, photos, or unreviewed binary files. Use
fictional `Demo Club` data in tests and screenshots.

Integration tests write temporary records. Run `npm run test:integration` only
against a dedicated test Base that you own.
