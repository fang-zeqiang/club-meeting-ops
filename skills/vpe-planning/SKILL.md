---
name: vpe-planning
description: Help the VPE plan the next several meetings as a whole through VPE Agenda MCP - confirm each meeting's theme and format, external guest, Sharing Master / workshop lead, and Meeting Manager, rotate MMs fairly, and spot template leftovers before they reach members. Use for 未来几期规划、排期、主题确认、MM 轮换、谁来当 MM、嘉宾和 Sharing 人选. For running one meeting, use meeting-manager instead.
---

# VPE planning

Scope: several meetings at once. One meeting's dated MM timeline and SOP steps belong to `meeting-manager`; one member's Pathways plan belongs to `member-growth`.

## Read

1. List the window with `vpe_list_meetings` (`date_from` today, `status="active"`), then `vpe_get_meeting_overview` per meeting. Default window: the next 6–8 meetings or until the term ends, whichever is first.
2. If the VPE keeps an earlier plan (CSV, doc), compare it with what is live and show the difference: topics dropped or moved, guests never booked. Live Agenda wins when they disagree; say so.
3. Show one table: `# · date · theme/format · guest · Sharing/workshop lead · MM · status`. Use 已定 / 待定 / 缺人, not long prose.

## Decide together, one round at a time

4. Ask in numbered inline questions, a few meetings per round. Lead with meetings that are closest or have the most blanks. Record every answer before asking the next round.
5. Per meeting, settle in this order: theme and format → whether it needs a guest or Sharing at all → who leads → MM. A meeting does not have to be a talk; interactive formats (PechaKucha, Debate, Table Topics specials, holiday nights) are first-class options.
6. Recommend, don't just list. For each open slot give a first pick with one reason and one fallback.

## Rules for recommendations

- Club calendar: ask the VPE once which weeks the club skips (for example, the first week of each month). Do not propose meetings in those weeks, and do not flag the resulting gaps as a problem.
- Fixed ceremonies (Election, Installation) keep their theme; their MM comes from the current officer team.
- MM rotation: prefer active members who have never been MM, then whoever was MM longest ago. Read past MMs from earlier meetings, not memory.
- Skip anyone the VPE has said is unwilling, for this whole planning session. Do not re-suggest them.
- Avoid stacking: someone leading Sharing in one meeting should not also be MM in the next one or two.
- Before suggesting a member, check they are active. If dues look expired, still allow the suggestion but flag it for the VPE to verify.
- Never invent guests. External guests are names the VPE gives you; otherwise write 待邀请.

## Hygiene to flag

- Future meetings copied from a template often carry stale session titles (an old Sharing title, an old Pathways project). List them per meeting so they get cleared before the agenda is shared.
- Another planner or agent may be editing the same meetings. Re-read right before any write.

## Write

7. Keep a working note of decisions per round (date, meeting, what changed, what's still open). This is a draft, not the source of truth.
8. Writing to Agenda follows `agenda-editor`: only an explicit command in this conversation authorizes `vpe_change_agenda`. Theme and MM go through `set_meeting_field` (`theme`, `meetingManager`); session titles and leads through `set_item_field`. A plan, a recorded decision, or your own suggestion is never write authorization.
9. After writing, read back with `vpe_get_meeting_overview` and report the meetings that match the plan and any that don't.

Do not message members, confirm invitations on anyone's behalf, or copy SOP content into the plan.
