---
name: member-growth
description: Track one club member's Pathways progress from VPE Agenda meetings and plan their next growth step as a concrete meeting + role + Pathways project, then book it through MCP once the officer confirms the member agreed. Use for 会员进度、Pathways 进度、成长计划、下一步该讲什么、推荐他去哪期当什么角色.
---

# Member growth

Requires the `role-booking` skill for every write. If `role-booking` is not available in this conversation, stay read-only: give the plan and invitation draft, never call a write tool, and tell the user to install `role-booking` to enable booking.

## Read

1. Resolve one explicit member with `vpe_get_member_growth_plan` (`member_query` or `member_id`). On `MEMBER_AMBIGUOUS`, ask the user to pick from the candidates; never guess.
2. Answer in this order so the user sees progress first: **progress → gaps → opportunities → plan**. Keep every `#meeting`, `assignment_id`, `revision`, and `form_id` exactly as returned.
3. Always state the basis: `pathSource` (profile / roster / speeches / override), untagged speech count, and that this is an estimate — Base Camp is authoritative. Never say a Level is complete; at most "likely ready to submit, confirm in Base Camp".

## What the server decides vs. what you decide

The server owns the rules: primary Path, completed baseline, gaps, and which vacant slots match. Do not recount Pathways requirements, re-rank gaps, or invent slots, IDs, or projects.

You own the conversation:

- **No Path basis** (`pathSource: none`, graduated-only, or `unmappedRosterCodes`): ask the officer which Path the member is on, then call again with `path` set to an exact catalog Path name.
- **`multipleActivePaths: true`**: ask which Path to push first, then call again with `path`.
- **Elective gaps** (`kind: elective`, Level 3+): help choose one project from `candidates` by asking about the member's interests, schedule, and skills they want to build. Explain why the pick fits. Then use `vpe_search_pathways_projects` for that project's exact `form_id` before booking.
- **Pacing**: turn opportunities into a short plan with breathing room (for example one speech every two to three weeks, evaluator duty in between). Flag `memberHasRoleThatMeeting` as a conflict to discuss, not a blocker.
- **Invitation draft**: write a short, warm message the officer can send. It is only a draft; never send it or claim it was sent.
- **Untagged upcoming speeches**: suggest filling in the Pathways project for that booking; it makes the next estimate accurate.

## Write (only with role-booking)

4. Book only after the officer says in this conversation that the member agreed. A plan, a draft, or your own inference is never consent.
5. Follow `role-booking` rules for `vpe_book_role`: fetch fresh context for that `meeting_number`, use its current `revision` and `assignmentId`, a stable idempotency key, and the returned `speech_details`. Set `allow_multiple_roles=true` only after the officer accepts the reported conflict.
6. To fill in an untagged upcoming speech, use the `role-booking` propose → explicit confirmation → apply flow with `action=update_speech_details`.
7. Report a booking as done only after the tool returns a verified revision.
