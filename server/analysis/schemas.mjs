// Response contracts shared by every agent. Strict form (all properties required,
// no additional properties) so Codex --output-schema and Claude --json-schema accept it.
import { diagramsSchema } from './diagrams.mjs';

const range = { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' } }, required: ['path', 'start', 'end'] };
const detail = { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, text: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' } }, required: ['title', 'text', 'start', 'end'] };
const section = { type: 'object', additionalProperties: false,
  properties: { path: { type: 'string' }, title: { type: 'string' }, overview: { type: 'string' }, body: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' }, details: { type: 'array', items: detail }, evidence: { type: 'array', items: range } },
  required: ['path', 'title', 'overview', 'body', 'start', 'end', 'details', 'evidence'] };

// sections: empty for ordinary questions; filled when the user asks in chat for code explanations
// (the agent chooses the files). Saved as notes linked to the answer.
export const questionSchema = { type: 'object', additionalProperties: false, properties: {
  title: { type: 'string' }, summary: { type: 'string' }, diagrams: diagramsSchema, sections: { type: 'array', items: section },
  suggestedFiles: { type: 'array', items: { ...range, properties: { ...range.properties, reason: { type: 'string' } }, required: [...range.required, 'reason'] } },
  webSources: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, url: { type: 'string' } }, required: ['title', 'url'] } },
}, required: ['title', 'summary', 'suggestedFiles', 'webSources', 'diagrams', 'sections'] };

export const explanationSchema = { type: 'object', additionalProperties: false, properties: {
  title: { type: 'string' }, summary: { type: 'string' }, diagrams: diagramsSchema, sections: { type: 'array', items: section },
}, required: ['title', 'summary', 'sections', 'diagrams'] };

// Extended thinking, research pass: findings for the writing agent. references are ranges read with read_file.
export const researchSchema = { type: 'object', additionalProperties: false, properties: {
  summary: { type: 'string' },
  findings: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { topic: { type: 'string' }, detail: { type: 'string' }, references: { type: 'array', items: range } }, required: ['topic', 'detail', 'references'] } },
  openQuestions: { type: 'array', items: { type: 'string' } },
}, required: ['summary', 'findings', 'openQuestions'] };

// Refinement of saved explanations (also the extended-thinking review of a draft: noteId "draft-N"): changed or added sections only (noteId = existing id or "new-N"),
// removals, and the full teaching order per file. Unlisted notes stay as they are.
const refinedSection = { ...section, properties: { noteId: { type: 'string' }, ...section.properties }, required: ['noteId', ...section.required] };
export const refineSchema = { type: 'object', additionalProperties: false, properties: {
  summary: { type: 'string' }, sections: { type: 'array', items: refinedSection },
  removed: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { noteId: { type: 'string' }, reason: { type: 'string' } }, required: ['noteId', 'reason'] } },
  order: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, noteIds: { type: 'array', items: { type: 'string' } } }, required: ['path', 'noteIds'] } },
}, required: ['summary', 'sections', 'removed', 'order'] };
