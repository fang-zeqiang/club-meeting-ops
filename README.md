# Club Meeting Ops

One meeting record powers role booking, preparation, agenda, presentation,
voting, awards, and review. The goal: stop repeating the same agenda change
across pages, tables, and files.

This is an independent open-source project. It is not affiliated with or
endorsed by any speaking-club organization or employer.

[中文说明](README.zh-CN.md)

![Club Meeting Ops fictional preview](docs/demo-preview.png)

## Preview in five minutes

Requirements: Node.js 22+ and npm.

```bash
npm ci --ignore-scripts
npm run dev
```

Open the printed URL with `?preview=1`, usually:

```text
http://localhost:5173/?preview=1
```

Preview mode uses fictional data, skips sign-in, and performs no Base writes.

## Capabilities

- Book future meeting roles against personal goals.
- Edit meeting details, blocks, roles, speeches, and learning paths.
- Render two-page A4 agenda and live presentation views.
- Prepare voting, confirm awards, and present certificates.
- Review meeting readiness, risks, and post-meeting quality.
- Read meeting state through MCP; poster upload is the only write-oriented MCP tool.

## Architecture

```text
Browser
  │ same-origin /api
  ▼
Node.js functions ── server-only credentials ── Feishu/Lark Base
  │
  ├─ Meetings / Blocks / Items / Members
  ├─ Templates / RoleCatalog / Assets
  └─ separate Voting Base
```

The browser bundle never receives Base credentials. Each club deploys its own
instance, Base, session secret, and passcodes.

## Configure your club

Edit [`club-profile.js`](club-profile.js). It contains only public instance
information: club name, number, district, tagline, original logo, website,
agenda footer, award name, public MCP URL, and introduction copy.

Do not put credentials or member data in this file.

## Full local stack

1. Create your own Feishu/Lark app and an empty Base.
2. Review [`docs/BASE_SCHEMA.md`](docs/BASE_SCHEMA.md).
3. Copy `.env.example` to `.env.local`.
4. Fill required variables using only your own test resources.
5. Generate passcode hashes:

```bash
node -e 'const c=require("node:crypto"),s=c.randomBytes(16).toString("hex");process.stdout.write("scrypt$"+s+"$"+c.scryptSync(process.argv[1],s,32).toString("hex")+"\n")' 'choose-a-passcode'
```

Run it separately for `AGENDA_EDIT_PASSCODE_HASH` and
`BOOKING_PASSCODE_HASH`.

6. Generate `AGENDA_SESSION_SECRET`:

```bash
node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
```

7. Check credentials without printing their values:

```bash
set -a
. ./.env.local
set +a
python3 scripts/diagnose-env.py
```

8. Start:

```bash
npm run dev
```

9. Verify:

```text
http://localhost:5173/api/health
```

`persistence: "bitable-ready"` means required Base variables are present.

## Base schema and demo data

[`docs/demo-data.json`](docs/demo-data.json) contains only fictional examples.
Do not import a production roster or meeting export.

The schema helper is dry-run by default:

```bash
python3 scripts/create-bitable-tables.py
python3 scripts/create-bitable-tables.py --apply
```

`--apply` changes the Base selected by your environment. Review the target
first. Existing installations may add `--items-only` or `--optimize-lookups`.

## Voting Base

Use a separate Base for voting responses and set
`BITABLE_VOTING_APP_TOKEN`. Pool provisioning is also dry-run by default:

```bash
npm run provision:voting-pool
npm run provision:voting-pool -- --apply
```

Never share a voting Base between unrelated clubs.

## Integration test

```bash
npm run test:integration
```

This command creates, updates, and removes temporary records. Run it only
against a dedicated test Base, never production.

## Deploy to Vercel

1. Fork this repository.
2. Import the fork as a new Vercel project.
3. Keep the Vite defaults: build `npm run build`, output `dist`.
4. Add `.env.example` variables to the server environment. Set
   `PUBLIC_APP_ORIGIN` to the deployment's public HTTPS origin, with no path.
5. Use a new Base and new secrets for this deployment.
6. Deploy and verify `/api/health`.

Preview deployments should use isolated test resources or no persistence.
Never inject production secrets into fork pull requests.

## Validation

```bash
npm ci --ignore-scripts
npm run check:public
npm test
npm run build
npm audit --omit=dev --audit-level=high
git diff --check
```

Pull requests, pushes to `main`, and `v*` tags run the same quality and safety
gates. Integration tests are intentionally excluded from untrusted CI.

## Security

- `.env*`, `.vercel/`, private data, artifacts, and temporary output are ignored.
- `scripts/check-public-safety.mjs` rejects credentials, personal paths,
  identifiers, restricted instance names, and unreviewed media.
- GitHub Actions use read-only permissions and immutable action SHAs.
- Report vulnerabilities through GitHub private vulnerability reporting.

See [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md),
[PUBLIC_FILES.md](PUBLIC_FILES.md), and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

MIT. See [LICENSE](LICENSE).
