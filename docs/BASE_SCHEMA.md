# Base schema

Use a new Base for each deployed club. Never point a fork at another club's
production data.

Required tables:

- `Meetings`: meeting metadata, state, revision, review, voting, awards.
- `Templates`: reusable serialized agenda structures.
- `Blocks`: ordered sections linked to a meeting.
- `Items`: ordered roles and speeches linked to blocks.
- `Members`: display name, member type, active state, officer roles, goals.
- `Assets`: `asset_key` and image attachment.
- `RoleCatalog`: canonical role name, aliases, description, active state, order.
- `MemberDevelopmentProfiles` (optional): member growth preferences and role-development context for recommendations.
- `RecommendationExclusions` (optional): member availability exclusions; does not change membership or manual assignments.
- `RoleOutreach` (optional): recommendation outreach status; acceptance is not a booking until the Agenda write succeeds.

Optional tables:

- learning-path projects and evaluation forms;
- MCP personal tokens;
- a separate voting Base with disposable voting tables.

`python3 scripts/create-bitable-tables.py` is a dry run. Add `--apply` only
after setting your own app credentials and reviewing the target Base. Existing
installations can use `--items-only` or `--optimize-lookups`.

The maintenance script adds support fields used by current code. Core tables
can be created from this list or copied from a clean schema-only Base. Never
copy records from a real club into a public demo.
