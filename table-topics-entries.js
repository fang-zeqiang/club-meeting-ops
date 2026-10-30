function text(value) {
  return String(value ?? "").trim();
}

function legacyId(index, name) {
  const slug = tableTopicsNameKey(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "placeholder";
  return `legacy-${index + 1}-${slug}`;
}

export function tableTopicsNameKey(value) {
  return text(value).normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase();
}

export function normalizeTableTopicsDuration(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string" && /^\d+:\d{1,2}$/.test(value.trim())) {
    const [minutes, seconds] = value.trim().split(":").map(Number);
    return seconds < 60 ? (minutes * 60) + seconds : null;
  }
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= 0 ? seconds : null;
}

export function formatTableTopicsDuration(value) {
  const seconds = normalizeTableTopicsDuration(value);
  if (seconds == null) return "—";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function isTableTopicsWritableToday(meetingDate, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(meetingDate || "")) && String(meetingDate) >= today;
}

export function validateTableTopicsEntries(entries, currentEntryId = "") {
  const normalized = normalizeTableTopicsEntries(entries);
  const names = new Set();
  for (const entry of normalized.filter((item) => !item.placeholder)) {
    const key = tableTopicsNameKey(entry.name);
    if (names.has(key)) {
      const error = new Error("Table Topics Speaker names must be unique.");
      error.code = "DUPLICATE_TABLE_TOPICS_SPEAKER";
      throw error;
    }
    names.add(key);
  }
  if (currentEntryId && !normalized.some((entry) => entry.id === currentEntryId)) {
    const error = new Error("Current Table Topics Speaker is missing.");
    error.code = "INVALID_CURRENT_TABLE_TOPICS_ENTRY";
    throw error;
  }
  return normalized;
}

export function normalizeTableTopicsEntries(entries, legacySpeakers = []) {
  const source = Array.isArray(entries) && entries.length
    ? entries
    : (Array.isArray(legacySpeakers) ? legacySpeakers : []).map((name, index) => ({ id: legacyId(index, name), name, order: index + 1 }));

  return source
    .map((entry, index) => {
      const name = text(entry?.name);
      const placeholder = Boolean(entry?.placeholder) || !name;
      const visibleName = placeholder ? "待补录" : name;
      const aliases = [...new Set([...(Array.isArray(entry?.aliases) ? entry.aliases : []), ...(placeholder ? [] : [visibleName])]
        .map(text).filter(Boolean))];
      return {
        id: text(entry?.id) || legacyId(index, visibleName),
        name: visibleName,
        order: Number.isFinite(Number(entry?.order)) ? Number(entry.order) : index + 1,
        durationSeconds: normalizeTableTopicsDuration(entry?.durationSeconds),
        placeholder,
        aliases,
        _index: index,
      };
    })
    .sort((a, b) => a.order - b.order || a._index - b._index)
    .map(({ _index, ...entry }, index) => ({ ...entry, order: index + 1 }));
}
