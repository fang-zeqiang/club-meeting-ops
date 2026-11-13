---
name: member-growth
description: Track one club member's Pathways progress from VPE Agenda meetings and plan their next growth step as a concrete meeting + role + Pathways project, then book it through MCP once the officer confirms the member agreed. Also reviews several members or the whole club at once, and gathers one member's verified activity over a semester or year for a growth report. Use for 会员进度、Pathways 进度、各个会员的进展、谁快可以提交、成长计划、下一步该讲什么、推荐他去哪期当什么角色、学期/年度成长回顾、成长报告、学期小票、这学期拿过什么奖、做过哪些角色.
---

# Member growth

Requires the `role-booking` skill for every write. If `role-booking` is not available in this conversation, stay read-only: give the plan and invitation draft, never call a write tool, and tell the user to install `role-booking` to enable booking.

## Read

1. Resolve one explicit member with `vpe_get_member_growth_plan` (`member_query` or `member_id`). On `MEMBER_AMBIGUOUS`, ask the user to pick from the candidates; never guess.
2. Answer in this order so the user sees progress first: **progress → gaps → opportunities → plan**. Keep every `#meeting`, `assignment_id`, `revision`, and `form_id` exactly as returned.
3. Always state the basis: `pathSource` (profile / roster / speeches / override), untagged speech count, and that this is an estimate — Base Camp is authoritative. Never say a Level is complete; at most "likely ready to submit, confirm in Base Camp". When the user asks for evidence, quote the 【依据】 lines (`#meeting「title」→ project`) as returned.
4. Count what the member still has to do in speeches, using "还需 N 篇演讲" from the level line, not the project count. Evaluation and Feedback is one project but two speeches.

## Several members at once

Use this when the user asks about the whole club or a group ("各个会员的进展", "谁快可以提交").

- Build the list first and say how: there is no roster tool. `vpe_search_members` needs at least 2 characters, returns at most 10 active members per query, and mixes in guests, so a query that returns exactly 10 may hide people; narrow it until it returns fewer. Start from names the user mentions and members seen in recent meetings before sweeping letter pairs. Members are those the growth plan accepts; `MEMBER_NOT_FOUND` means a guest or another club's member. Tell the user the list may be incomplete and ask them to name anyone missing.
- Call `vpe_get_member_growth_plan` once per member and report one row each: name, primary Path, target Level (baseline + 1), progress, evidence.
- Group by speeches left at the target Level ("likely ready to submit" = 0, then 1, then 2, …), not by gap count. Show the groups the user asked for; put everyone else on one "其他" line with their count, and members without a Path basis on another.
- Flag, don't settle, conflicts the server cannot see: a display-name suffix (for example "PM2", "MS5/EH2") that disagrees with `官网缩写` or with the baseline. Ask the VPE which is right, or suggest running Pathways sync, before grouping that member.
- Also flag, without relabeling: speeches delivered above the target Level (the baseline is probably out of date), and the same project delivered twice (probably a mis-tag).
- Ask every Path question (`pathSource: none`, `multipleActivePaths`, conflicts) in one numbered round, not one member at a time.
- Note booked future speeches without a Pathways project as open items: they may move a member to another group once filled in.

## What the server decides vs. what you decide

The server owns the rules: primary Path, completed baseline, gaps, and which vacant slots match. Do not recount Pathways requirements, re-rank gaps, or invent slots, IDs, or projects.

You own the conversation:

- **No Path basis** (`pathSource: none`, graduated-only, or `unmappedRosterCodes`): ask the officer which Path the member is on, then call again with `path` set to an exact catalog Path name.
- **`multipleActivePaths: true`**: ask which Path to push first, then call again with `path`.
- **Elective gaps** (`kind: elective`, Level 3+): help choose one project from `candidates` by asking about the member's interests, schedule, and skills they want to build. Explain why the pick fits. Then use `vpe_search_pathways_projects` for that project's exact `form_id` before booking.
- **Pacing**: turn opportunities into a short plan with breathing room (for example one speech every two to three weeks, evaluator duty in between). Flag `memberHasRoleThatMeeting` as a conflict to discuss, not a blocker.
- **Invitation draft**: write a short, warm message the officer can send. It is only a draft; never send it or claim it was sent.
- **Untagged upcoming speeches**: suggest filling in the Pathways project for that booking; it makes the next estimate accurate.

## Period review (semester or annual report)

Use this when the user asks what a member did over a period: a semester or annual growth report, the receipt-style long image, or "这学期拿过什么奖 / 讲过什么 / 给谁点评过".

1. Call `vpe_get_member_period_review` once with `member_query` or `member_id`, plus `start_date` / `end_date` when the user names a period. Without dates it uses the current half-year (Jan 1–Jun 30 or Jul 1–Dec 31). Do not stitch the same answer together from `vpe_get_role_booking_context(view=history)`: that view is capped at 20 meetings and does not dedupe duties or carry awards.
   If `vpe_get_member_period_review` is not in this server's tool list, tell the user this deployment does not support period reviews yet and stop.
2. Lay it out in the returned order: honors (only when there are any) → prepared speeches → evaluations given → MM / TME / TTM → role footprint → education next step. Give each member as much space as their real record warrants, and skip a section they have no record for instead of leaving it empty.
3. Always state the cutoff date and every coverage note the tool returns. When the period has not ended yet, say the report is a preview through that date, never "the whole semester" or "the whole year".
4. Write only what a record backs:
   - Meetings with a role record are not attendance. Never compute an attendance rate.
   - "First time this period" is not "first time ever": the system has no earlier history, so make no first-ever claims.
   - Keep ties (name the co-winners), label contest places as 模拟演讲赛, and leave speech-completion and participation certificates out of the award count.
   - A meeting marked "无可用投票数据" means the awards there are unknown, not that the member won nothing.
   - The MM crew list is scene context from that one meeting, not a complete collaborator list, and it does not mean the member evaluated or worked one-on-one with those people.
   - A Pathways project with a delivered speech is not a completed Level. For education progress, also call `vpe_get_member_growth_plan` and keep its "estimate, confirm in Base Camp" wording.
   - Subjective growth ("more confident", "stronger leadership") is for the member to add. Leave a placeholder for their own words instead of writing it for them.
5. The tool is read-only for business data. It may cache a finished meeting's award tally when it falls back to the live voting table; that is expected and needs no confirmation.

## Write (only with role-booking)

5. Book only after the officer says in this conversation that the member agreed. A plan, a draft, or your own inference is never consent.
6. Follow `role-booking` rules for `vpe_book_role`: fetch fresh context for that `meeting_number`, use its current `revision` and `assignmentId`, a stable idempotency key, and the returned `speech_details`. Set `allow_multiple_roles=true` only after the officer accepts the reported conflict.
7. To fill in an untagged upcoming speech, use the `role-booking` propose → explicit confirmation → apply flow with `action=update_speech_details`.
8. Report a booking as done only after the tool returns a verified revision.
