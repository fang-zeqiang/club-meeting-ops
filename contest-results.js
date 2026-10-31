export const CONTEST_PLACES = Object.freeze([
  { key: "first", label: "1st Place" },
  { key: "second", label: "2nd Place" },
  { key: "third", label: "3rd Place" },
]);

export function contestants(meeting) {
  const seen = new Set();
  return (meeting.blocks || [])
    .flatMap((block) => block.items || [])
    .filter((item) => item.kind === "speech" && String(item.member || "").trim())
    .map((item) => ({ memberId: String(item.memberId || ""), name: String(item.member).trim() }))
    .filter((entry) => {
      const identity = entry.memberId || entry.name.toLocaleLowerCase();
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
}

// 同一选手只能占一个名次：选入新名次时清掉他原来的名次
export function setContestPlace(results, place, contestant) {
  const identity = (entry) => entry?.memberId || String(entry?.name || "").toLocaleLowerCase();
  const next = Object.fromEntries(Object.entries(results || {}).filter(([key, entry]) => key !== place && (!contestant || identity(entry) !== identity(contestant))));
  return contestant ? { ...next, [place]: { memberId: contestant.memberId || "", name: contestant.name } } : next;
}
