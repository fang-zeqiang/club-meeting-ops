const SHANGHAI_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const DAY = 86_400_000;
const ACTIVE_OUTREACH = new Set(["copied", "contacted", "accepted", "declined", "no_response", "booked", "cancelled", "closed"]);
const GUEST_RECOMMENDATION_ROLES = new Set(["Grammarian", "Ah-Counter", "Timer", "Photographer"]);

export const OUTREACH_TRANSITIONS = Object.freeze({
  suggested: ["dismissed", "copied"],
  copied: ["contacted", "accepted", "declined", "no_response", "cancelled", "closed"],
  contacted: ["accepted", "declined", "no_response", "cancelled", "closed"],
  no_response: ["accepted", "declined", "closed"],
  accepted: ["booked", "cancelled", "closed"],
  declined: ["closed"],
  cancelled: ["closed"],
  dismissed: [],
  booked: [],
  closed: [],
});

export function canTransitionOutreach(from = "suggested", to) {
  return OUTREACH_TRANSITIONS[from]?.includes(to) || false;
}

export function hasOtherMeetingOutreach(outreach, { meetingId, assignmentId, memberId }) {
  return outreach.some((item) => item.meetingId === meetingId
    && item.memberId === memberId
    && item.assignmentId !== assignmentId
    && ACTIVE_OUTREACH.has(item.status));
}

function dateMs(value) {
  const result = Date.parse(`${String(value || "").slice(0, 10)}T00:00:00+08:00`);
  return Number.isFinite(result) ? result : 0;
}

function daysBetween(from, to) {
  return Math.round((dateMs(to) - dateMs(from)) / DAY);
}

function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join("\n");
  if (value && typeof value === "object") return text(value.text ?? value.name ?? value.value ?? "");
  return String(value ?? "").trim();
}

function list(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  try {
    const parsed = JSON.parse(text(value));
    if (Array.isArray(parsed)) return parsed.map(text).filter(Boolean);
  } catch {}
  return text(value).split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function isRegularMeeting(meeting) {
  const type = String(meeting?.meetingType || "regular_meeting").toLocaleLowerCase();
  return ["regular", "regular_meeting", "club_meeting"].includes(type);
}

function isGuestMember(member) {
  return String(member?.memberType || "").toLocaleLowerCase().includes("guest");
}

function hasUsableGuestName(member) {
  const name = String(member?.displayName || "").split(",")[0].trim().toLocaleLowerCase();
  return Boolean(name) && !/^(?:guest|tbd)(?:\s*\d+)?$|^(?:guest\s*\/\s*tbd|tbd\s*\/\s*guest)$/u.test(name);
}

function memberMatches(assignment, member) {
  if (assignment.memberId) return assignment.memberId === member.id;
  const clean = (value) => String(value || "").split(",")[0].trim().toLocaleLowerCase();
  return clean(assignment.memberName) === clean(member.displayName);
}

function validProfile(profile, targetDate) {
  return profile && (!profile.validUntil || profile.validUntil >= targetDate);
}

function pathwayFresh(member, targetDate) {
  if (!member.pathwaysVerifiedAt) return false;
  const age = daysBetween(String(member.pathwaysVerifiedAt).slice(0, 10), targetDate);
  return age >= 0 && age <= 90;
}

function exclusionApplies(exclusion, meetingId) {
  if (!exclusion.active) return false;
  if (exclusion.scope === "standing") return true;
  return exclusion.meetingIds.includes(meetingId);
}

function taskMemberIds(meeting, assignments) {
  const ids = new Set(assignments.filter((assignment) => assignment.status !== "vacant").map((assignment) => assignment.memberId).filter(Boolean));
  for (const item of meeting.blocks?.flatMap((block) => block.items || []) || []) {
    if (item.memberId) ids.add(item.memberId);
    if (item.evaluatorId) ids.add(item.evaluatorId);
  }
  if (meeting.meetingManagerMemberId) ids.add(meeting.meetingManagerMemberId);
  if (meeting.photographerMemberId) ids.add(meeting.photographerMemberId);
  return ids;
}

function memberHasCurrentTask(meeting, assignments, member, assignedIds) {
  if (assignedIds.has(member.id) || assignments.some((assignment) => assignment.status !== "vacant" && memberMatches(assignment, member))) return true;
  const items = meeting.blocks?.flatMap((block) => block.items || []) || [];
  if (items.some((item) => item.evaluatorId === member.id || memberMatches({ memberId: item.evaluatorId, memberName: item.evaluator }, member))) return true;
  return memberMatches({ memberId: meeting.meetingManagerMemberId, memberName: meeting.meetingManager }, member)
    || memberMatches({ memberId: meeting.photographerMemberId, memberName: meeting.photographer }, member);
}

function historyFor(member, role, meetings, assignmentsForMeeting, targetDate, relatedRoles) {
  const confirmed = [];
  const agendaRecords = [];
  const workload = [];
  for (const meeting of meetings) {
    if (!isRegularMeeting(meeting)) continue;
    const assignments = assignmentsForMeeting(meeting);
    for (const assignment of assignments) {
      if (!memberMatches(assignment, member) || assignment.status === "vacant") continue;
      const entry = { role: assignment.role, meetingNumber: meeting.meetingNumber, date: meeting.date };
      if (meeting.status === "archived") confirmed.push(entry);
      else if (meeting.status === "final" && meeting.date < targetDate) agendaRecords.push(entry);
      if (["draft", "final"].includes(meeting.status) && Math.abs(daysBetween(targetDate, meeting.date)) <= 30 && meeting.date !== targetDate) workload.push(entry);
    }
  }
  const recentMeetings = [...new Map(confirmed.sort((a, b) => b.date.localeCompare(a.date)).map((entry) => [entry.meetingNumber, entry])).values()].slice(0, 12);
  const sameRole = confirmed.filter((entry) => entry.role === role);
  const related = confirmed.filter((entry) => relatedRoles.includes(entry.role));
  const last = [...sameRole, ...related].sort((a, b) => b.date.localeCompare(a.date))[0] || null;
  return {
    sameRoleCount: sameRole.length,
    relatedRoleCount: related.length,
    relatedRoleNames: [...new Set(related.map((entry) => entry.role))],
    agendaRecordCount: agendaRecords.filter((entry) => entry.role === role).length,
    workloadCount: workload.length,
    recentTaskCount: recentMeetings.length,
    lastMeetingNumber: last?.meetingNumber || null,
    lastDate: last?.date || "",
  };
}

function recentGuestEntries(member, meetings, assignmentsForMeeting, targetDate) {
  const sourceMeetings = meetings.filter((meeting) => meeting.date < targetDate && ["final", "archived"].includes(meeting.status))
    .sort((a, b) => b.date.localeCompare(a.date) || Number(b.meetingNumber || 0) - Number(a.meetingNumber || 0))
    .slice(0, 2);
  return sourceMeetings.flatMap((meeting) => assignmentsForMeeting(meeting)
    .filter((assignment) => assignment.status === "confirmed" && memberMatches(assignment, member))
    .map((assignment) => ({ role: assignment.role, meetingNumber: meeting.meetingNumber, date: meeting.date })));
}

function guestCoolingApplies(memberId, outreach, meetings, assignmentsForMeeting, nowDate) {
  const meetingById = new Map(meetings.map((meeting) => [meeting.id, meeting]));
  return outreach.some((item) => {
    if (item.memberId !== memberId || !["declined", "no_response"].includes(item.status)) return false;
    const sourceMeeting = meetingById.get(item.meetingId);
    const role = sourceMeeting && assignmentsForMeeting(sourceMeeting).find((assignment) => assignment.id === item.assignmentId)?.role;
    if (!GUEST_RECOMMENDATION_ROLES.has(role)) return false;
    const eventDate = String(item.repliedAt || item.updatedAt || sourceMeeting?.date || "").slice(0, 10);
    const age = daysBetween(eventDate, nowDate);
    return age >= 0 && age <= 30;
  });
}

function roleMatch(profile, role) {
  if (!profile) return { interest: false, growth: false };
  const interest = profile.roleInterests.some((value) => value.toLocaleLowerCase() === role.toLocaleLowerCase());
  const growth = [profile.growthRoute, profile.nextAction].some((value) => String(value || "").toLocaleLowerCase().includes(role.toLocaleLowerCase()));
  return { interest, growth };
}

function isSpeakerReady(profile) {
  return Boolean(profile?.readyToContact || profile?.nextSpeechPlan || profile?.speechTargetWindow);
}

function candidateFor({ member, assignment, roleRule, profile, meeting, meetings, assignmentsForMeeting, exclusion, outreach, nowDate }) {
  const relatedRoles = roleRule.recommendedAfterRoles || [];
  const history = historyFor(member, assignment.role, meetings, assignmentsForMeeting, meeting.date, relatedRoles);
  const profileCurrent = validProfile(profile, meeting.date);
  const match = roleMatch(profileCurrent ? profile : null, assignment.role);
  const freshPathways = pathwayFresh(member, meeting.date);
  const firstTime = history.sameRoleCount === 0;
  const daysUntil = daysBetween(nowDate, meeting.date);
  const explicit = match.interest || match.growth || (assignment.role === "Prepared Speaker" && isSpeakerReady(profileCurrent ? profile : null));
  const experienced = history.sameRoleCount > 0 || history.relatedRoleCount > 0;
  const reasons = [];
  if (match.interest) reasons.push("曾明确表达想尝试这个角色");
  else if (match.growth) reasons.push("当前成长路线与这个角色匹配");
  else if (assignment.role === "Prepared Speaker" && isSpeakerReady(profile)) reasons.push("已有下一篇演讲的可联系信号");
  if (history.sameRoleCount) reasons.push(`有 ${history.sameRoleCount} 次已归档的 ${assignment.role} 经历`);
  else if (history.relatedRoleNames.length) reasons.push(`做过 ${history.relatedRoleNames.slice(0, 2).join("、")} 等相关角色`);
  if (reasons.length < 2 && history.workloadCount === 0) reasons.push("目标会期前后 30 天没有其他确认任务");
  if (reasons.length < 2) reasons.push("最近 12 场确认任务较少");
  let risk = "";
  if (firstTime && roleRule.firstTimeSupport?.length) risk = `首次承担，建议${roleRule.firstTimeSupport.join("、")}。`;
  else if (member.pathwaysLevel && !freshPathways) risk = "Pathways 已超过 90 天未核实，本次未参与排序。";
  const label = history.sameRoleCount ? "稳妥人选" : explicit ? "成长人选" : "备选人选";
  const near = daysUntil <= 7;
  const tuple = near
    ? [Number(explicit), history.sameRoleCount, history.relatedRoleCount, -history.workloadCount, Number(match.growth), Number(freshPathways)]
    : [Number(explicit), Number(match.growth), history.relatedRoleCount, -history.workloadCount, history.sameRoleCount, Number(freshPathways)];
  return {
    memberId: member.id,
    displayName: member.displayName,
    label,
    reasons: reasons.slice(0, 2),
    risk,
    outreachStatus: outreach?.status || "suggested",
    outreachUpdatedAt: outreach?.updatedAt || "",
    details: {
      relatedExperience: history.sameRoleCount
        ? `${assignment.role} ${history.sameRoleCount} 次${history.lastMeetingNumber ? `，最近 #${history.lastMeetingNumber}` : ""}`
        : history.relatedRoleNames.length ? history.relatedRoleNames.join("、") : "暂无已归档相关经历",
      workload: `前后 30 天 ${history.workloadCount} 项任务，最近 12 场 ${history.recentTaskCount} 项`,
      support: firstTime && roleRule.firstTimeSupport?.length ? roleRule.firstTimeSupport.join("、") : "无需额外支持",
      sources: profileCurrent ? [{ type: profile.sourceType || "人工维护", updatedAt: profile.updatedAt || profile.sourceDate || "" }] : [],
    },
    _tuple: tuple,
    _explicit: explicit,
    _recentTaskCount: history.recentTaskCount,
    _lastDate: history.lastDate,
    _memberId: member.id,
    _excluded: exclusion,
  };
}

function guestCandidateFor({ member, assignment, roleRule, entries, outreach, cooling }) {
  const relatedRoles = roleRule.recommendedAfterRoles || [];
  const sameRole = entries.filter((entry) => entry.role === assignment.role);
  const related = entries.filter((entry) => relatedRoles.includes(entry.role));
  const latest = [...entries].sort((a, b) => b.date.localeCompare(a.date))[0];
  const roles = [...new Set(entries.map((entry) => entry.role))];
  const reasons = [];
  if (sameRole.length) reasons.push(`最近做过 ${assignment.role}`);
  else if (related.length) reasons.push(`最近做过 ${related.map((entry) => entry.role).slice(0, 2).join("、")} 等相关角色`);
  else reasons.push(`最近参与 #${latest.meetingNumber} 并承担过角色`);
  reasons.push("适合借角色体验继续邀请");
  return {
    memberId: member.id,
    displayName: member.displayName,
    isGuest: true,
    guestRecentMeetingNumber: latest.meetingNumber,
    guestRoles: roles,
    label: sameRole.length ? "稳妥人选" : related.length ? "成长人选" : "备选人选",
    reasons,
    risk: cooling ? "近 30 天曾拒绝或无回复，本次不进入优先位。" : "",
    outreachStatus: outreach?.status || "suggested",
    outreachUpdatedAt: outreach?.updatedAt || "",
    details: {
      relatedExperience: `最近参与 #${latest.meetingNumber} · 做过 ${roles.join("、")}`,
      workload: "近期 Guest 回访候选",
      support: roleRule.firstTimeSupport?.join("、") || "会前说明角色流程",
      sources: [],
    },
    _tuple: [],
    _explicit: false,
    _recentTaskCount: 0,
    _lastDate: latest.date,
    _memberId: member.id,
    _guest: true,
    _guestCooling: cooling,
    _guestSameRole: sameRole.length,
    _guestRelatedRole: related.length,
  };
}

function compareCandidates(a, b) {
  const guestRank = (candidate) => candidate._guest ? candidate._guestCooling ? 2 : 0 : 1;
  const rankDifference = guestRank(a) - guestRank(b);
  if (rankDifference) return rankDifference;
  if (a._guest && b._guest) return b._guestSameRole - a._guestSameRole
    || b._guestRelatedRole - a._guestRelatedRole
    || String(b._lastDate || "").localeCompare(String(a._lastDate || ""))
    || a._memberId.localeCompare(b._memberId);
  for (let index = 0; index < Math.max(a._tuple.length, b._tuple.length); index += 1) {
    const difference = (b._tuple[index] || 0) - (a._tuple[index] || 0);
    if (difference) return difference;
  }
  return a._recentTaskCount - b._recentTaskCount
    || String(a._lastDate || "").localeCompare(String(b._lastDate || ""))
    || a._memberId.localeCompare(b._memberId);
}

function stripPrivate(candidate) {
  const { _tuple, _explicit, _recentTaskCount, _lastDate, _memberId, _excluded, _guest, _guestCooling, _guestSameRole, _guestRelatedRole, ...safe } = candidate;
  return safe;
}

export function normalizeRecommendationRecords({ profiles = [], exclusions = [], outreach = [] }) {
  return {
    profiles: profiles.map((record) => ({
      memberId: text(record.member_id),
      roleInterests: list(record.role_interests_json),
      attendanceFrequency: text(record.attendance_frequency),
      educationGoal: text(record.education_goal),
      supportNeeds: list(record.support_needs_json),
      growthRoute: text(record.growth_route),
      nextAction: text(record.next_action),
      nextSpeechPlan: text(record.next_speech_plan),
      speechTargetWindow: text(record.speech_target_window),
      readyToContact: record.ready_to_contact === true,
      sourceType: text(record.source_type),
      sourceDate: text(record.source_date).slice(0, 10),
      updatedAt: text(record.updated_at),
      validUntil: text(record.valid_until).slice(0, 10),
    })).filter((profile) => profile.memberId),
    exclusions: exclusions.map((record) => ({
      id: text(record.exclusion_id),
      memberId: text(record.member_id),
      scope: text(record.scope) || "meeting",
      meetingIds: list(record.meeting_ids_json),
      reason: text(record.reason),
      note: text(record.note),
      active: record.active !== false,
      updatedAt: text(record.updated_at),
    })).filter((exclusion) => exclusion.id && exclusion.memberId),
    outreach: outreach.map((record) => ({
      key: text(record.outreach_key),
      meetingId: text(record.meeting_id),
      assignmentId: text(record.assignment_id),
      memberId: text(record.member_id),
      status: text(record.status),
      updatedAt: text(record.updated_at),
      copiedAt: text(record.copied_at),
      contactedAt: text(record.contacted_at),
      repliedAt: text(record.replied_at),
      bookedAt: text(record.booked_at),
    })).filter((item) => item.key && item.memberId),
  };
}

export function recommendationAdvisorTask(recommendations = {}, { previewMode = false } = {}) {
  const { data = null, error = "" } = recommendations;
  const action = { stage: "preparation", task: "role-recommendations", focusKey: "" };
  if (previewMode) return {
    title: "Role recommendations",
    reason: "Available after this meeting is saved to the shared workspace.",
    source: "Build Agenda",
    urgency: "Unavailable in preview",
    tone: "loading",
    hideAdminAction: true,
    action: { ...action, title: "Recommendations unavailable", disabled: true },
  };
  if (!data && error) return {
    title: "Recommendations could not finish",
    reason: "Candidate data is temporarily unavailable. Try the request again.",
    source: "Build Agenda",
    urgency: "Needs retry",
    tone: "risk",
    hideAdminAction: true,
    action: { title: "Try again", task: "refresh-recommendations" },
  };
  if (!data) return {
    title: "Finding role candidates",
    reason: "Usually ready in a few seconds. Keep this page open while Agenda and member data are checked.",
    source: "Build Agenda",
    urgency: "Preparing",
    tone: "loading",
    hideAdminAction: true,
    action: { ...action, title: "Preparing recommendations", disabled: true, loading: true },
  };
  if (!data.available) return {
    title: "Role recommendations unavailable",
    reason: data.reason || "Open a future editable regular meeting to use recommendations.",
    source: "Build Agenda",
    urgency: "Check result",
    tone: "loading",
    hideAdminAction: true,
    action: { ...action, title: "View result" },
  };
  if (!data.summary?.vacancies) return {
    title: "No role recommendations needed",
    reason: "No open roles need candidate recommendations for this meeting.",
    source: "Build Agenda",
    urgency: "Complete",
    tone: "done",
    hideAdminAction: true,
    action: { ...action, title: "View result" },
  };
  return {
    title: `Contact ${data.summary.suggestedContacts} candidate${data.summary.suggestedContacts === 1 ? "" : "s"}`,
    reason: `${data.summary.vacancies} open role${data.summary.vacancies === 1 ? "" : "s"}. Contact count is deduplicated; candidates with a task this meeting are excluded.`,
    source: "Build Agenda",
    urgency: `${data.summary.vacancies} roles open`,
    tone: "next",
    action: { ...action, title: "Contact candidates" },
  };
}

export function buildRoleRecommendations({ meeting, meetings, members, catalog, profiles = [], exclusions = [], outreach = [], now = new Date(), assignmentsForMeeting }) {
  const nowDate = SHANGHAI_DATE.format(now);
  if (!meeting || !["draft", "final"].includes(meeting.status) || meeting.date < nowDate || !isRegularMeeting(meeting)) {
    return { available: false, reason: "Recommendations are only available for future editable regular meetings.", roles: [], exclusions: [], summary: { vacancies: 0, suggestedContacts: 0 } };
  }
  const getAssignments = assignmentsForMeeting || (() => []);
  const assignments = getAssignments(meeting);
  const assignedMembers = taskMemberIds(meeting, assignments);
  const profileByMember = new Map(profiles.map((profile) => [profile.memberId, profile]));
  const applicableExclusions = exclusions.filter((exclusion) => exclusionApplies(exclusion, meeting.id));
  const exclusionByMember = new Map(applicableExclusions.map((exclusion) => [exclusion.memberId, exclusion]));
  const outreachByKey = new Map(outreach.map((item) => [`${item.meetingId}:${item.assignmentId}:${item.memberId}`, item]));
  const contactedThisMeeting = new Map(outreach.filter((item) => item.meetingId === meeting.id && ACTIVE_OUTREACH.has(item.status)).map((item) => [item.memberId, item.assignmentId]));
  const roleRules = new Map(catalog.recommendationRoles.map((role) => [role.name, role]));
  const vacant = assignments.filter((assignment) => assignment.status === "vacant" && roleRules.has(assignment.role));
  const guestEntriesByMember = new Map(members.filter((member) => isGuestMember(member))
    .map((member) => [member.id, recentGuestEntries(member, meetings, getAssignments, meeting.date)]));
  const roles = vacant.map((assignment) => {
    const roleRule = roleRules.get(assignment.role);
    const waitingForSpeaker = assignment.role === "Individual Evaluator" && !assignment.speakerName;
    const targetOutreach = (memberId) => outreachByKey.get(`${meeting.id}:${assignment.id}:${memberId}`);
    const commonEligible = (member) => member.active !== false
      && member.id
      && member.displayName
      && !memberHasCurrentTask(meeting, assignments, member, assignedMembers)
      && !exclusionByMember.has(member.id)
      && !["declined", "no_response", "dismissed", "cancelled", "closed", "booked"].includes(targetOutreach(member.id)?.status)
      && (!contactedThisMeeting.has(member.id) || contactedThisMeeting.get(member.id) === assignment.id);
    const memberCandidates = waitingForSpeaker ? [] : members.filter((member) => !isGuestMember(member)
      && commonEligible(member)
      && (assignment.role !== "Prepared Speaker" || isSpeakerReady(validProfile(profileByMember.get(member.id), meeting.date) ? profileByMember.get(member.id) : null)))
      .map((member) => candidateFor({
        member,
        assignment,
        roleRule,
        profile: profileByMember.get(member.id),
        meeting,
        meetings,
        assignmentsForMeeting: getAssignments,
        exclusion: exclusionByMember.get(member.id),
        outreach: targetOutreach(member.id),
        nowDate,
      }));
    const guestCandidates = waitingForSpeaker || !GUEST_RECOMMENDATION_ROLES.has(assignment.role) ? [] : members.filter((member) => isGuestMember(member)
      && hasUsableGuestName(member)
      && commonEligible(member)
      && guestEntriesByMember.get(member.id)?.length)
      .map((member) => guestCandidateFor({
        member,
        assignment,
        roleRule,
        entries: guestEntriesByMember.get(member.id),
        outreach: targetOutreach(member.id),
        cooling: guestCoolingApplies(member.id, outreach, meetings, getAssignments, nowDate),
      }));
    const candidates = [...guestCandidates, ...memberCandidates].sort(compareCandidates);
    return {
      assignmentId: assignment.id,
      role: assignment.role,
      speakerName: assignment.speakerName || "",
      blockedReason: waitingForSpeaker ? "先确认 Speaker" : "",
      candidates,
      allCandidateCount: candidates.length,
      sortOrder: roleRule.sortOrder || 0,
      growthSkills: roleRule.growthSkills || [],
    };
  });

  const preferredRole = new Map();
  const memberRoles = new Map();
  for (const role of roles) for (const candidate of role.candidates) {
    const entries = memberRoles.get(candidate.memberId) || [];
    entries.push({ role, candidate });
    memberRoles.set(candidate.memberId, entries);
  }
  for (const [memberId, entries] of memberRoles) {
    entries.sort((a, b) => a.candidate._guest && b.candidate._guest
      ? b.candidate._guestSameRole - a.candidate._guestSameRole
        || b.candidate._guestRelatedRole - a.candidate._guestRelatedRole
        || a.role.candidates.length - b.role.candidates.length
        || a.role.sortOrder - b.role.sortOrder
        || a.role.assignmentId.localeCompare(b.role.assignmentId)
      : Number(b.candidate._explicit) - Number(a.candidate._explicit)
      || a.role.candidates.length - b.role.candidates.length
      || a.role.sortOrder - b.role.sortOrder
      || a.role.assignmentId.localeCompare(b.role.assignmentId));
    preferredRole.set(memberId, entries[0].role.assignmentId);
  }
  const used = new Set();
  for (const role of [...roles].sort((a, b) => a.candidates.length - b.candidates.length || a.sortOrder - b.sortOrder)) {
    role.topCandidates = role.candidates.filter((candidate) => !candidate._guestCooling && preferredRole.get(candidate.memberId) === role.assignmentId && !used.has(candidate.memberId)).slice(0, 3);
    role.topCandidates.forEach((candidate) => used.add(candidate.memberId));
  }
  for (const role of roles.filter((item) => GUEST_RECOMMENDATION_ROLES.has(item.role))) {
    role.topCandidates = [...role.topCandidates, ...role.candidates.filter((candidate) => candidate._guest && !candidate._guestCooling && !role.topCandidates.some((item) => item.memberId === candidate.memberId))]
      .sort(compareCandidates)
      .slice(0, 3);
  }
  used.clear();
  roles.flatMap((role) => role.topCandidates).forEach((candidate) => used.add(candidate.memberId));
  for (const role of roles) {
    if (role.topCandidates.length < 3) {
      const fill = role.candidates.filter((candidate) => !candidate._guestCooling && !used.has(candidate.memberId)).slice(0, 3 - role.topCandidates.length);
      role.topCandidates.push(...fill);
      fill.forEach((candidate) => used.add(candidate.memberId));
    }
  }
  for (const role of roles) {
    if (role.topCandidates.length < 3) {
      role.topCandidates.push(...role.candidates.filter((candidate) => !candidate._guestCooling && !role.topCandidates.some((item) => item.memberId === candidate.memberId)).slice(0, 3 - role.topCandidates.length));
    }
    const present = (candidate) => ({ ...stripPrivate(candidate), preferredAssignmentId: preferredRole.get(candidate.memberId) || role.assignmentId });
    role.candidates = role.candidates.map(present);
    role.topCandidates = role.topCandidates.map(present);
    delete role.sortOrder;
  }
  const visibleExclusions = applicableExclusions.map((exclusion) => ({ ...exclusion, displayName: members.find((member) => member.id === exclusion.memberId)?.displayName || exclusion.memberId }));
  const currentAssignments = assignments.filter((assignment) => assignment.status === "confirmed").map((assignment) => ({
    assignmentId: assignment.id,
    role: assignment.role,
    memberId: assignment.memberId,
    displayName: assignment.memberName,
  }));
  const topContacts = [...new Map(roles.flatMap((role) => role.topCandidates).map((candidate) => [candidate.memberId, candidate])).values()];
  return {
    available: true,
    developmentDataAvailable: true,
    roles,
    exclusions: visibleExclusions,
    currentAssignments,
    summary: {
      vacancies: roles.length,
      suggestedContacts: topContacts.length,
      waiting: topContacts.filter((candidate) => !["copied", "contacted", "accepted", "booked"].includes(candidate.outreachStatus)).length,
      contacted: topContacts.filter((candidate) => ["copied", "contacted"].includes(candidate.outreachStatus)).length,
      accepted: topContacts.filter((candidate) => candidate.outreachStatus === "accepted").length,
    },
  };
}

function englishReason(value) {
  const reason = String(value || "");
  if (reason === "曾明确表达想尝试这个角色") return "you previously expressed interest in trying this role";
  if (reason === "当前成长路线与这个角色匹配") return "the role matches your current development direction";
  if (reason === "已有下一篇演讲的可联系信号") return "you indicated that you may be ready to plan your next speech";
  if (reason === "目标会期前后 30 天没有其他确认任务") return "you have no other confirmed assignment within 30 days of this meeting";
  if (reason === "最近 12 场确认任务较少") return "you have had relatively few confirmed assignments in the last 12 meetings";
  const sameRole = /^有 (\d+) 次已归档的 (.+) 经历$/u.exec(reason);
  if (sameRole) return `you have ${sameRole[1]} archived ${sameRole[2]} assignment${sameRole[1] === "1" ? "" : "s"}`;
  const relatedRoles = /^做过 (.+) 等相关角色$/u.exec(reason);
  if (relatedRoles) return `you have experience in related roles such as ${relatedRoles[1].replaceAll("、", " and ")}`;
  return "your recent role history and workload make this a reasonable fit";
}

function englishSkill(value) {
  return ({
    公众表达: "public speaking",
    即兴表达: "impromptu speaking",
    主持引导: "facilitation",
    倾听观察: "active listening",
    反馈辅导: "feedback and coaching",
    时间管理: "time management",
    组织协调: "coordination",
    临场应变: "adaptability",
    会员连接: "member engagement",
    活动记录: "event documentation",
  })[value] || String(value || "meeting collaboration");
}

export function invitationDraft({ language = "zh-CN", meeting, role, candidate, speakerName = "", growthSkills = [] }) {
  const reason = candidate.reasons?.join("，") || "你近期没有其他任务";
  const skills = growthSkills.slice(0, 2).join("和") || "会议协作";
  if (language === "en") {
    if (candidate.isGuest) return `It was great seeing you last time! Meeting #${meeting.meetingNumber} on ${meeting.date} has an opportunity to try ${role}. We will explain the role beforehand.\nWould you like to join us and experience it? No worries if this meeting does not work for you.`;
    const englishReasons = (candidate.reasons || []).slice(0, 2).map(englishReason).join(", and ") || "your recent workload leaves room for this meeting";
    const englishSkills = growthSkills.slice(0, 2).map(englishSkill).join(" and ") || "meeting collaboration";
    if (role === "Prepared Speaker") return `Hi ${candidate.displayName}, Meeting #${meeting.meetingNumber} on ${meeting.date} still has a Prepared Speaker opening.\nI thought of you because ${englishReasons}.\nWould you be ready to plan your next speech? The project and title can be added after you accept.`;
    if (role === "Individual Evaluator") return `Hi ${candidate.displayName}, Meeting #${meeting.meetingNumber} on ${meeting.date} needs an Individual Evaluator for ${speakerName}.\nI thought of you because ${englishReasons}.\nWould you be open to taking it? We can review the evaluation focus together beforehand.`;
    return `Hi ${candidate.displayName}, Meeting #${meeting.meetingNumber} on ${meeting.date} still needs a ${role}.\nI thought of you because ${englishReasons}.\nThis role is a good way to practice ${englishSkills}.\nWould you be open to taking it? No worries if this meeting does not work for you.`;
  }
  if (candidate.isGuest) return `上次见到你很开心！我们 ${meeting.date} 的 #${meeting.meetingNumber} 还有 ${role} 的机会，这个角色会有人提前说明。\n你愿意再来体验一下吗？不方便也没关系～`;
  if (role === "Prepared Speaker") return `Hi ${candidate.displayName}，${meeting.date} 的 #${meeting.meetingNumber} 还有一个 Prepared Speaker 空缺。\n想到你，是因为${reason}。\n想问问你是否已经准备好安排下一篇演讲？如果愿意，Project 和题目可以接受后再补充。`;
  if (role === "Individual Evaluator") return `Hi ${candidate.displayName}，${meeting.date} 的 #${meeting.meetingNumber} 还需要一位 Individual Evaluator，点评 ${speakerName} 的演讲。\n想到你，是因为${reason}。\n你这期方便承担吗？需要的话，我们可以提前过一下点评重点。`;
  return `Hi ${candidate.displayName}，${meeting.date} 的 #${meeting.meetingNumber} 还缺 ${role}。\n想到你，是因为${reason}。\n这个角色主要可以练习${skills}。\n你这期方便尝试吗？不方便也没关系，我再找其他人～`;
}
