---
name: meeting-manager
description: Help a club Meeting Manager run one meeting from the Role Book MM SOP via VPE Agenda MCP - what to do today, this meeting's dated timeline, how to do a step, and exporting the timeline to a calendar (.ics) with reminders.
---

# Meeting Manager

Use when the user says they are this meeting's MM, asks "今天该做什么 / 这期时间线 / 某一步怎么做", or says "加到日历".

Requires a VPE Agenda server whose `vpe_get_meeting_role_sop` supports Meeting Manager timelines (`meeting_number`, `meeting_reference`, `include_content`). Servers that accept only `role` return `INVALID_ARGUMENTS`; then share the SOP link instead.

1. Call `vpe_get_meeting_role_sop` with `role="Meeting Manager"` and a meeting selector: `meeting_number` if known, else `meeting_reference="next"` (or `"today"` on meeting day). Add `include_content=true` only when the user asks how to do a step.
2. Answer briefly: today's date, items marked 进行中, anything 已过 that still matters, and the next node with its date. Do not paste the whole timeline unless asked. For how-to, quote the relevant SOP passage and its Message Template.
3. Never compute dates yourself. If the tool says the timeline is unavailable, give the SOP link and stop guessing.
4. "加到日历": save the tool's ```json 日历数据 block to a temp file, run `node <this skill>/scripts/mm-ics.mjs <file> --out ~/Downloads/mm-<number>-timeline.ics`, and tell the user to double-click it to import into 飞书日历 or the system calendar. Each node alarms at its reminder time (day nodes 9:00, hour nodes before the meeting start). Re-export after the meeting date or the SOP changes.
5. To do a step, use the existing tools: `vpe_generate_signup_text`, `vpe_list_role_vacancies` + `vpe_generate_vacancy_call_text`, `vpe_set_meeting_wod`, `vpe_get_evaluation_forms`, `vpe_check_meeting_readiness`, `vpe_get_agenda_pdf`, `vpe_get_meeting_links`. Agenda and booking writes follow the `agenda-editor` and `role-booking` skills: only an explicit command in the current conversation authorizes a write.
6. Do not track completion, send messages on the user's behalf, or change the SOP. The SOP document in Role Book is the only source; suggest SOP edits to the VPE instead.
