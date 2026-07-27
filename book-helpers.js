export function matchesMemberSearch(name, query) {
  const text = String(name).toLocaleLowerCase();
  return String(query).trim().toLocaleLowerCase().split(/[\s,@]+/).filter(Boolean).every((token) => {
    let cursor = 0;
    return [...token].every((character) => (cursor = text.indexOf(character, cursor) + 1) > 0);
  });
}

export function groupMemberOptions(members = [], query = "") {
  const groups = { members: [], guests: [] };
  members
    .filter((member) => member.active !== false && matchesMemberSearch(member.displayName, query))
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .forEach((member) => groups[String(member.memberType || "member").toLocaleLowerCase().includes("guest") ? "guests" : "members"].push(member));
  return groups;
}

export function guestDisplayNameLooksStandard(name) {
  return /^[^,\n]+,\s*(?:Guest|[^,@\n]+@[^@\n]+)$/i.test(String(name).trim());
}

const SPEECH_DETAIL_KEYS = ["session", "pathwaysMode", "pathwaysPath", "pathwaysLevel", "pathwaysProjectId", "pathwaysFormId", "speechObjective", "legacyProject"];

export function memberSpeechDefaults(details = {}, member = {}, catalog = null) {
  if (SPEECH_DETAIL_KEYS.some((key) => String(details[key] || "").trim()) || !catalog) return details;
  for (const profile of member.pathwayDefaults || []) {
    const path = catalog.paths.find((name) => (name.match(/[A-Za-z]+/g) || []).map((word) => word[0]).join("").toUpperCase() === profile.code);
    const available = path && catalog.projects.some((project) => project.level === profile.level
      && [...(project.requiredPaths || []), ...(project.electivePaths || [])].includes(path));
    if (available) return { pathwaysMode: "pathways", pathwaysPath: path, pathwaysLevel: profile.level };
  }
  return details;
}

function pairSpeakersAndEvaluators(assignments) {
  const evaluators = new Map();
  assignments.filter((assignment) => assignment.role === "Individual Evaluator" && assignment.speechPairId).forEach((assignment) => {
    const rows = evaluators.get(assignment.speechPairId) || [];
    rows.push(assignment);
    evaluators.set(assignment.speechPairId, rows);
  });
  const paired = new Set();
  const rows = [];
  for (const assignment of assignments) {
    if (assignment.role === "Individual Evaluator") continue;
    rows.push(assignment);
    if (assignment.role !== "Prepared Speaker") continue;
    for (const evaluator of evaluators.get(assignment.speechPairId) || []) {
      rows.push(evaluator);
      paired.add(evaluator.id);
    }
  }
  return rows.concat(assignments.filter((assignment) => assignment.role === "Individual Evaluator" && !paired.has(assignment.id)));
}

export function groupMeetingAssignments(assignments, roleCatalog) {
  const roles = new Map(roleCatalog.map((role, index) => [role.name, { ...role, index }]));
  const groups = new Map();
  for (const assignment of assignments) {
    const role = roles.get(assignment.role);
    const label = role?.group || "其他";
    const order = role?.sortOrder ?? role?.index ?? Number.MAX_SAFE_INTEGER;
    const group = groups.get(label) || { label, order, assignments: [] };
    group.order = Math.min(group.order, order);
    group.assignments.push(assignment);
    groups.set(label, group);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)).map((group) => ({
    label: group.label,
    assignments: pairSpeakersAndEvaluators(group.assignments.sort((a, b) => {
      const left = roles.get(a.role);
      const right = roles.get(b.role);
      return (left?.sortOrder ?? left?.index ?? Number.MAX_SAFE_INTEGER) - (right?.sortOrder ?? right?.index ?? Number.MAX_SAFE_INTEGER);
    })),
  }));
}
