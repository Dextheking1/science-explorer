"use strict";

// Core logic for Science Explorer.
// Runs in the browser as window.ScienceExplorer and in node for tests.
// The page turns one science topic into a structured explainer, and every
// part of that explainer can be opened up with a second, deeper call.

var API_BASE = "https://gen.pollinations.ai";
var STORAGE_KEY = "science_explorer_pollinations_key";
var DEFAULT_TEXT_MODEL = "openai/gpt-5.4-nano";
var DEFAULT_IMAGE_MODEL = "black-forest-labs/flux.1-schnell";

var TEXT_MODELS = [
  { id: "openai/gpt-5.4-nano", title: "GPT-5.4 Nano", paidOnly: false },
  { id: "deepseek/deepseek-v4.1-flash", title: "DeepSeek V4.1 Flash", paidOnly: false },
  { id: "z-ai/glm-5.3-flash", title: "GLM 5.3 Flash", paidOnly: false },
  { id: "moonshotai/kimi-k2.6", title: "Kimi K2.6", paidOnly: false },
  { id: "mistralai/mistral-large-3", title: "Mistral Large 3", paidOnly: false },
  { id: "meta/llama-3.3-70b-instruct", title: "Llama 3.3 70B", paidOnly: false }
];

var IMAGE_MODELS = [
  { id: "black-forest-labs/flux.1-schnell", title: "Flux 1 Schnell", paidOnly: false },
  { id: "tongyi-mai/z-image-turbo", title: "Z-Image Turbo", paidOnly: false }
];

// Local format check only. The live check happens in the page against
// /account/balance. Keys are secret (sk_) or publishable (pk_).
function validateKey(key) {
  if (typeof key !== "string") return { ok: false, error: "Key must be text." };
  var trimmed = key.trim();
  if (trimmed.length === 0) return { ok: false, error: "No key entered." };
  if (/\s/.test(trimmed)) return { ok: false, error: "Key contains spaces." };
  if (!/^(sk_|pk_)/.test(trimmed)) return { ok: false, error: "Key should start with sk_ or pk_." };
  if (trimmed.length < 20) return { ok: false, error: "Key looks too short." };
  return { ok: true, key: trimmed };
}

// Reasoning models need reasoning_effort low and a generous max_tokens,
// or they spend the whole budget on hidden reasoning and fail.
function buildChatRequest(modelId, prompt) {
  return {
    model: modelId || DEFAULT_TEXT_MODEL,
    messages: [{ role: "user", content: String(prompt || "") }],
    reasoning_effort: "low",
    max_tokens: 6000
  };
}

// Read the text out of an OpenAI style chat completion response.
function extractChatText(data) {
  if (!data || typeof data !== "object") return { ok: false, error: "Empty response from the API." };
  if (data.error) {
    var msg = (data.error && data.error.message) || "API error.";
    return { ok: false, error: String(msg) };
  }
  var choice = (data.choices || [])[0];
  if (!choice || !choice.message) return { ok: false, error: "Response had no answer." };
  var content = choice.message.content;
  var text = "";
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content.map(function (part) {
      if (typeof part === "string") return part;
      return part && typeof part.text === "string" ? part.text : "";
    }).join("");
  }
  text = text.trim();
  if (!text) return { ok: false, error: "Model returned an empty answer." };
  return { ok: true, text: text };
}

var EXPLAINER_SHAPE = [
  "{",
  '  "title": "short title for the topic",',
  '  "summary": "2 to 3 plain sentences that frame the whole topic",',
  '  "keyIdeas": [{"title": "idea name", "detail": "1 to 2 sentences"}],',
  '  "mechanism": [{"step": 1, "title": "step name", "detail": "what happens in this step"}],',
  '  "misconceptions": [{"myth": "what people wrongly think", "fact": "what is actually true"}],',
  '  "questions": ["an open question worth exploring", "a second question", "a third question"],',
  '  "imagePrompt": "one sentence describing a clear labelled diagram of the topic"',
  "}"
].join("\n");

function cleanTopic(topic) {
  return String(topic || "").trim().replace(/\s+/g, " ").slice(0, 200);
}

function buildExplainerPrompt(topic) {
  var t = cleanTopic(topic);
  return [
    "Turn this science topic into something a curious reader can explore.",
    "Topic: " + t,
    "",
    "Reply with strict JSON only. No code fence, no prose before or after, no comments.",
    "Use exactly this shape:",
    EXPLAINER_SHAPE,
    "",
    "Rules:",
    "- keyIdeas: 3 to 5 ideas, the ones everything else hangs on.",
    "- mechanism: 3 to 6 steps, in order, each step caused by or following from the one before.",
    "- misconceptions: 2 to 3 real, common ones, each with a short correction.",
    "- questions: exactly 3, open ended, each one pointing at a different part of the topic.",
    "- Plain words first, technical terms only where they are needed, and explain those inline.",
    "- Keep every detail under 40 words. Accuracy over flair."
  ].join("\n");
}

// Pull one JSON object out of a model reply. Accepts a bare object, a
// fenced block, or an object wrapped in prose. Returns null if there is
// no object shaped span at all.
function extractJsonObject(text) {
  if (typeof text !== "string") return null;
  var raw = text.trim();
  if (!raw) return null;
  var fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  var candidate = fence ? fence[1].trim() : raw;
  var start = candidate.indexOf("{");
  var end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function asText(v) {
  return isNonEmptyString(v) ? v.trim() : null;
}

function normalisePairs(list, fieldA, fieldB) {
  if (!Array.isArray(list)) return null;
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    if (!item || typeof item !== "object") return null;
    var a = asText(item[fieldA]);
    var b = asText(item[fieldB]);
    if (!a || !b) return null;
    var pair = {};
    pair[fieldA] = a;
    pair[fieldB] = b;
    out.push(pair);
  }
  return out;
}

// Strict parse and validation of the explainer JSON. Anything missing,
// mistyped or out of range is an error, so the caller can use its one
// retry instead of rendering half a topic.
function parseExplainer(text) {
  var candidate = extractJsonObject(text);
  if (!candidate) return { ok: false, error: "Reply contained no JSON object." };
  var data;
  try {
    data = JSON.parse(candidate);
  } catch (e) {
    return { ok: false, error: "Reply was not valid JSON: " + e.message };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "JSON was not an object." };
  }
  var title = asText(data.title);
  var summary = asText(data.summary);
  if (!title) return { ok: false, error: "Missing title." };
  if (!summary) return { ok: false, error: "Missing summary." };

  var keyIdeas = normalisePairs(data.keyIdeas, "title", "detail");
  if (!keyIdeas || keyIdeas.length < 3 || keyIdeas.length > 5) {
    return { ok: false, error: "keyIdeas must be 3 to 5 title and detail pairs." };
  }

  if (!Array.isArray(data.mechanism) || data.mechanism.length < 3 || data.mechanism.length > 6) {
    return { ok: false, error: "mechanism must be 3 to 6 steps." };
  }
  var mechanism = [];
  for (var i = 0; i < data.mechanism.length; i++) {
    var step = data.mechanism[i];
    if (!step || typeof step !== "object") return { ok: false, error: "mechanism step " + (i + 1) + " was not an object." };
    var stepTitle = asText(step.title);
    var stepDetail = asText(step.detail);
    if (!stepTitle || !stepDetail) return { ok: false, error: "mechanism step " + (i + 1) + " needs a title and a detail." };
    mechanism.push({ step: i + 1, title: stepTitle, detail: stepDetail });
  }

  var misconceptions = normalisePairs(data.misconceptions, "myth", "fact");
  if (!misconceptions || misconceptions.length < 2 || misconceptions.length > 3) {
    return { ok: false, error: "misconceptions must be 2 to 3 myth and fact pairs." };
  }

  if (!Array.isArray(data.questions)) return { ok: false, error: "questions must be a list." };
  var questions = [];
  for (var q = 0; q < data.questions.length; q++) {
    var raw = data.questions[q];
    var question = typeof raw === "string" ? asText(raw) : (raw && typeof raw === "object" ? asText(raw.question) : null);
    if (!question) return { ok: false, error: "question " + (q + 1) + " was empty." };
    questions.push(question);
  }
  if (questions.length !== 3) return { ok: false, error: "questions must be exactly 3." };

  return {
    ok: true,
    explainer: {
      title: title,
      summary: summary,
      keyIdeas: keyIdeas,
      mechanism: mechanism,
      misconceptions: misconceptions,
      questions: questions,
      imagePrompt: asText(data.imagePrompt) || ""
    }
  };
}

// One repair prompt, used for the single retry after a failed parse.
function buildRepairPrompt(topic, badText, error, kind) {
  var shape = kind === "dive" ? DIVE_SHAPE : EXPLAINER_SHAPE;
  return [
    "Your last reply could not be read as JSON. Error: " + String(error || "unknown"),
    "Topic: " + cleanTopic(topic),
    "",
    "Reply again with strict JSON only. No code fence, no prose, no comments.",
    "Use exactly this shape:",
    shape,
    "",
    "Your last reply, for reference only:",
    String(badText || "").slice(0, 4000)
  ].join("\n");
}

// Clickable targets. Every item in every section gets one target, so any
// part of the explainer can be dived into, not just the section as a whole.
function sectionsFor(explainer) {
  if (!explainer) return [];
  var targets = [];
  (explainer.keyIdeas || []).forEach(function (idea, i) {
    targets.push({
      id: "key-idea-" + i,
      kind: "keyIdea",
      index: i,
      title: idea.title,
      context: idea.title + ": " + idea.detail
    });
  });
  (explainer.mechanism || []).forEach(function (step, i) {
    targets.push({
      id: "mechanism-" + i,
      kind: "mechanism",
      index: i,
      title: "Step " + step.step + ": " + step.title,
      context: step.title + ": " + step.detail
    });
  });
  (explainer.misconceptions || []).forEach(function (item, i) {
    targets.push({
      id: "misconception-" + i,
      kind: "misconception",
      index: i,
      title: item.myth,
      context: "Myth: " + item.myth + " Fact: " + item.fact
    });
  });
  (explainer.questions || []).forEach(function (question, i) {
    targets.push({
      id: "question-" + i,
      kind: "question",
      index: i,
      title: question,
      context: "Open exploration question: " + question
    });
  });
  return targets;
}

function getTarget(explainer, targetId) {
  var targets = sectionsFor(explainer);
  for (var i = 0; i < targets.length; i++) {
    if (targets[i].id === targetId) return targets[i];
  }
  return null;
}

var DIVE_SHAPE = [
  "{",
  '  "heading": "short heading for this deeper look",',
  '  "body": "3 to 5 plain sentences going one level deeper",',
  '  "example": "one concrete example or everyday case",',
  '  "checkQuestion": "one short question the reader can answer to check they got it",',
  '  "checkAnswer": "the short answer to that question"',
  "}"
].join("\n");

var DIVE_FOCUS = {
  keyIdea: "Explain why this idea matters, what it depends on, and what follows from it.",
  mechanism: "Slow this step down. Say what goes in, what changes, and what comes out, and what would break if this step stopped.",
  misconception: "Explain where this wrong idea comes from, why it feels right, and what evidence settles it.",
  question: "Answer this question as far as current science does, and name what is still unknown at the end of the body text."
};

function buildDivePrompt(topic, explainer, target) {
  if (!target) return "";
  var focus = DIVE_FOCUS[target.kind] || "Go one level deeper on this part.";
  var lines = [
    "Science topic: " + cleanTopic(topic),
    "Overall summary: " + (explainer && explainer.summary ? explainer.summary : ""),
    "",
    "The reader clicked this part and wants to dive deeper:",
    "Part: " + target.title,
    "What they have already read: " + target.context,
    "",
    focus,
    "",
    "Reply with strict JSON only. No code fence, no prose before or after.",
    "Use exactly this shape:",
    DIVE_SHAPE,
    "",
    "Plain words first. Keep the body under 120 words, the example under 40 words."
  ];
  return lines.join("\n");
}

function parseDive(text) {
  var candidate = extractJsonObject(text);
  if (!candidate) return { ok: false, error: "Reply contained no JSON object." };
  var data;
  try {
    data = JSON.parse(candidate);
  } catch (e) {
    return { ok: false, error: "Reply was not valid JSON: " + e.message };
  }
  var heading = data && asText(data.heading);
  var body = data && asText(data.body);
  var example = data && asText(data.example);
  var checkQuestion = data && asText(data.checkQuestion);
  var checkAnswer = data && asText(data.checkAnswer);
  if (!heading || !body || !example || !checkQuestion || !checkAnswer) {
    return { ok: false, error: "Dive reply was missing one of heading, body, example, checkQuestion, checkAnswer." };
  }
  return {
    ok: true,
    dive: {
      heading: heading,
      body: body,
      example: example,
      checkQuestion: checkQuestion,
      checkAnswer: checkAnswer
    }
  };
}

function buildImagePrompt(topic, explainer) {
  var base = explainer && explainer.imagePrompt ? explainer.imagePrompt : "";
  var subject = base || ("how " + cleanTopic(topic) + " works");
  return "Clear educational science diagram, " + subject +
    ". Flat clean illustration, labelled parts, arrows showing the order of events, " +
    "white background, no photo, no people, no extra text blocks.";
}

function buildImageUrl(prompt, modelId) {
  var model = modelId || DEFAULT_IMAGE_MODEL;
  return API_BASE + "/image/" + encodeURIComponent(String(prompt || "")) +
    "?model=" + encodeURIComponent(model) + "&width=1024&height=576";
}

// Explorer state. One topic at a time. Dives are stored by target id,
// the order they were opened is kept in history, and a new topic clears
// everything from the old one.
function createExplorerState() {
  return {
    topic: "",
    explainer: null,
    demo: false,
    dives: {},
    expanded: {},
    pending: {},
    errors: {},
    history: [],
    imageStatus: "none"
  };
}

function setExplainer(state, topic, explainer, demo) {
  state.topic = cleanTopic(topic);
  state.explainer = explainer;
  state.demo = !!demo;
  state.dives = {};
  state.expanded = {};
  state.pending = {};
  state.errors = {};
  state.history = [];
  state.imageStatus = "none";
  return state;
}

function startDive(state, targetId) {
  state.pending[targetId] = true;
  delete state.errors[targetId];
  return state;
}

function recordDive(state, targetId, dive) {
  state.dives[targetId] = dive;
  state.expanded[targetId] = true;
  delete state.pending[targetId];
  delete state.errors[targetId];
  if (state.history.indexOf(targetId) === -1) state.history.push(targetId);
  return state;
}

function failDive(state, targetId, error) {
  delete state.pending[targetId];
  state.errors[targetId] = String(error || "Dive failed.");
  return state;
}

function toggleExpanded(state, targetId) {
  state.expanded[targetId] = !state.expanded[targetId];
  return state;
}

function getDive(state, targetId) {
  return state && state.dives ? state.dives[targetId] || null : null;
}

function diveCount(state) {
  return state && state.history ? state.history.length : 0;
}

// Demo explainer. Shown only when no key is set, and always labelled as
// a built-in sample. It passes the same validation as a live reply.
function getDemoExplainer() {
  return {
    title: "Photosynthesis",
    summary: "Plants, algae and some bacteria turn light, water and carbon dioxide into sugar and oxygen. It is the entry point for almost all energy in the living world, and the source of the oxygen in the air.",
    keyIdeas: [
      { title: "Light is captured, not eaten", detail: "Chlorophyll in chloroplasts absorbs mainly blue and red light. The energy splits water and drives the making of energy carrier molecules." },
      { title: "Carbon gets fixed into sugar", detail: "Carbon dioxide from the air is attached to a five carbon molecule and built, step by step, into sugars the plant can store or burn." },
      { title: "Oxygen is a waste product", detail: "The oxygen released comes from the water that was split, not from the carbon dioxide. It leaves through pores in the leaf." },
      { title: "Inputs and outputs balance", detail: "Six carbon dioxide and six water molecules, plus light, give one glucose and six oxygen molecules. Respiration runs the same ledger in reverse." }
    ],
    mechanism: [
      { step: 1, title: "Light hits the leaf", detail: "Photons reach chlorophyll inside chloroplasts in leaf cells. Green light is mostly reflected, which is why leaves look green." },
      { step: 2, title: "Water is split", detail: "Light energy splits water taken up from the roots. Oxygen is released, and hydrogen and electrons are kept for the next stage." },
      { step: 3, title: "Energy carriers are charged", detail: "The electrons and hydrogen are loaded onto carrier molecules, ATP and NADPH. Think of them as small charged batteries." },
      { step: 4, title: "Carbon dioxide is fixed", detail: "In the Calvin cycle, the charged carriers power a loop that builds carbon dioxide into a three carbon sugar building block." },
      { step: 5, title: "Sugar is stored or used", detail: "The plant joins the building blocks into glucose and starch, or burns them in respiration to grow, repair and reproduce." }
    ],
    misconceptions: [
      { myth: "Plants get most of their mass from the soil.", fact: "Most of a plant's dry mass is carbon taken from the air. Soil gives water and minerals, only a small share of the weight." },
      { myth: "Photosynthesis is the opposite process done by a separate system.", fact: "Plants also respire, day and night. Photosynthesis stores energy when light is there, respiration spends it all the time." },
      { myth: "The oxygen we breathe comes from the ocean as a lucky side system.", fact: "Much of it does come from ocean plankton doing the same photosynthesis. Forests and plankton are one shared process, not two." }
    ],
    questions: [
      "What limits photosynthesis first on a hot, dry afternoon: light, water, or carbon dioxide?",
      "Why did oxygen only build up in the air long after photosynthesis first evolved?",
      "Could a leaf coloured black capture more energy, and what would it lose by doing so?"
    ],
    imagePrompt: "a leaf cross section showing sunlight arriving, water moving up from roots, carbon dioxide entering, and oxygen and sugar leaving, with the chloroplast steps numbered in order"
  };
}

function getDemoDive(target) {
  return {
    heading: "Sample dive: " + (target ? target.title : "this part"),
    body: "This is built-in sample text, not a live answer. With your own key set, this panel is written by the model for the exact part you clicked. It goes one level deeper, in plain words, using the summary and the part you read as context.",
    example: "Sample example. A houseplant by a window still photosynthesises on a cloudy day, just slower, because diffuse light still reaches its chlorophyll.",
    checkQuestion: "In demo mode, where does the oxygen released by a plant come from?",
    checkAnswer: "From the water split in the light stage, per the sample above."
  };
}

var api = {
  API_BASE: API_BASE,
  STORAGE_KEY: STORAGE_KEY,
  DEFAULT_TEXT_MODEL: DEFAULT_TEXT_MODEL,
  DEFAULT_IMAGE_MODEL: DEFAULT_IMAGE_MODEL,
  TEXT_MODELS: TEXT_MODELS,
  IMAGE_MODELS: IMAGE_MODELS,
  EXPLAINER_SHAPE: EXPLAINER_SHAPE,
  DIVE_SHAPE: DIVE_SHAPE,
  validateKey: validateKey,
  buildChatRequest: buildChatRequest,
  extractChatText: extractChatText,
  cleanTopic: cleanTopic,
  buildExplainerPrompt: buildExplainerPrompt,
  buildRepairPrompt: buildRepairPrompt,
  extractJsonObject: extractJsonObject,
  parseExplainer: parseExplainer,
  sectionsFor: sectionsFor,
  getTarget: getTarget,
  buildDivePrompt: buildDivePrompt,
  parseDive: parseDive,
  buildImagePrompt: buildImagePrompt,
  buildImageUrl: buildImageUrl,
  createExplorerState: createExplorerState,
  setExplainer: setExplainer,
  startDive: startDive,
  recordDive: recordDive,
  failDive: failDive,
  toggleExpanded: toggleExpanded,
  getDive: getDive,
  diveCount: diveCount,
  getDemoExplainer: getDemoExplainer,
  getDemoDive: getDemoDive
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}
if (typeof window !== "undefined") {
  window.ScienceExplorer = api;
}
