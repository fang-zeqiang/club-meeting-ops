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
- a separate voting Base with disposable voting tables;
- `MCP Agenda Changes`: audit log with inverse operations for conversational
  Agenda and Role Booking writes. Required before enabling
  `MCP_AGENDA_WRITE_ENABLED` or `MCP_BOOKING_WRITE_ENABLED`;
- `MCP Tool Calls`: optional call log (`tool_name`, `status`, `error_code`,
  `duration_ms`, `principal_id`, `principal_name`, `client_info`,
  `args_digest`, `meeting_id`, `meeting_number`, `created_at`);
- `Table Topics`: topic bank per meeting (`meeting_id`, `topic_text`,
  `sort_order`, `created_by`, `created_at`);
- Word of the Day bank, which may live in another Base (`WOD_BASE_TOKEN`,
  `WOD_TABLE_ID`), with text fields `单词名`, `音标`, `词性`, `单词释义`, `单词例句`.

Fields added since the first public release:

- `Meetings`: `meeting_type`, `presentation_theme`, `off_agenda_roles_json`,
  `table_topics_entries_json`, `current_table_topics_entry_id`, and
  `wod_word`, `wod_pronunciation`, `wod_part_of_speech`, `wod_definition`,
  `wod_usage`, `wod_example`.
- `Items`: `presentation_phase`.

Store timestamps as ISO strings in text fields and counters as numbers.

`python3 scripts/create-bitable-tables.py` is a dry run. Add `--apply` only
after setting your own app credentials and reviewing the target Base. Existing
installations can use `--items-only` or `--optimize-lookups`.

The maintenance script adds support fields used by current code. Core tables
can be created from this list or copied from a clean schema-only Base. Never
copy records from a real club into a public demo.
