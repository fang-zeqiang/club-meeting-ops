import assert from "node:assert/strict";
import test from "node:test";

import { pathwaysCatalogFromRecords, publicPathwaysCatalog, resolveSpeechDetails } from "../server/pathways-repository.js";

const projectRecord = {
  record_id: "record-project",
  fields: {
    project_id: "project-active-listening-l3",
    name: "Active Listening",
    level: "3",
    required_paths: [],
    elective_paths: ["Presentation Mastery"],
    official_purpose: "Practice listening and responding.",
    source_url: "https://www.network.org/pathways-overview/pathways-presentation-mastery-path",
    catalog_version: "2026-07-17",
    active: true,
    sort_order: 1,
  },
};
const formRecord = {
  record_id: "record-form",
  fields: {
    form_id: "form-active-listening-l3",
    project: [{ id: "record-project" }],
    variant: "Standard speech",
    speech_purpose: "Practice listening and responding.",
    official_resource_url: "https://www.network.org/resources/active-listening-evaluation-resource",
    pdf_url: "https://content.network.org/image/upload/active-listening.pdf",
    catalog_version: "2026-07-17",
    active: true,
    sort_order: 1,
  },
};

test("catalog derives the public Path and form graph from Base records", () => {
  const catalog = pathwaysCatalogFromRecords([projectRecord], [formRecord]);
  assert.deepEqual(publicPathwaysCatalog(catalog).paths, ["Presentation Mastery"]);
  assert.equal(publicPathwaysCatalog(catalog).projects[0].recordId, undefined);
  assert.equal(publicPathwaysCatalog(catalog).forms[0].projectId, "project-active-listening-l3");
});

test("server resolves authoritative level, purpose, and PDF selection IDs", () => {
  const catalog = pathwaysCatalogFromRecords([projectRecord], [formRecord]);
  assert.deepEqual(resolveSpeechDetails(catalog, {
    pathwaysMode: "pathways",
    pathwaysPath: "Presentation Mastery",
    pathwaysLevel: "5",
    pathwaysProjectId: "project-active-listening-l3",
    pathwaysFormId: "form-active-listening-l3",
    speechObjective: "forged",
  }), {
    pathwaysMode: "pathways",
    pathwaysPath: "Presentation Mastery",
    pathwaysLevel: "3",
    pathwaysProjectId: "project-active-listening-l3",
    pathwaysFormId: "form-active-listening-l3",
    speechObjective: "Practice listening and responding.",
  });
  assert.throws(() => resolveSpeechDetails(catalog, {
    pathwaysMode: "pathways",
    pathwaysPath: "Dynamic Leadership",
    pathwaysProjectId: "project-active-listening-l3",
    pathwaysFormId: "form-active-listening-l3",
  }), { code: "INVALID_PATHWAYS_PATH" });
});

test("custom and decide-later modes clear Pathways identifiers", () => {
  assert.deepEqual(resolveSpeechDetails(null, { pathwaysMode: "custom", pathwaysProjectId: "forged", speechObjective: "A custom objective." }), {
    pathwaysMode: "custom",
    pathwaysPath: "",
    pathwaysLevel: "",
    pathwaysProjectId: "",
    pathwaysFormId: "",
    speechObjective: "A custom objective.",
  });
  assert.equal(resolveSpeechDetails(null, {}).speechObjective, "");
});
