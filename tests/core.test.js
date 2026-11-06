"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../core.js");

function validExplainer() {
  return {
    title: "Tides",
    summary: "The sea rises and falls twice a day in most places. Gravity from the Moon drives it, with the shape of the coast deciding how big it gets.",
    keyIdeas: [
      { title: "Gravity pulls unevenly", detail: "The Moon pulls harder on the near side of Earth than on the far side, stretching the oceans into two bulges." },
      { title: "Earth turns through the bulges", detail: "As a coast rotates into a bulge the water rises. Half a turn later it rotates into the second bulge." },
      { title: "The Sun adds or cancels", detail: "When Sun and Moon line up, their pulls add and tides run higher. At right angles they partly cancel." }
    ],
    mechanism: [
      { step: 1, title: "Moon pulls the near ocean", detail: "Water on the side facing the Moon is pulled toward it more than the solid Earth is." },
      { step: 2, title: "Two bulges form", detail: "One bulge faces the Moon and one faces away, where the pull is weakest and water is left behind." },
      { step: 3, title: "Coasts rotate through", detail: "Earth spins once a day, so most coasts pass through both bulges and see two high tides." }
    ],
    misconceptions: [
      { myth: "The Moon lifts water straight up under it.", fact: "The effect is a sideways stretching from uneven pull, not a single lift. That is why there are two bulges, not one." },
      { myth: "Tides only happen by the sea.", fact: "Lakes and even the solid ground move too, just by amounts too small to notice without instruments." }
    ],
    questions: [
      "Why do some places get only one high tide a day?",
      "What would tides do if the Moon were twice as close?",
      "Why is the tidal range huge in some bays and tiny in open ocean?"
    ],
    imagePrompt: "Earth and Moon with two ocean bulges, arrows showing the uneven pull"
  };
}

test("parseExplainer accepts a bare JSON object", () => {
  const out = C.parseExplainer(JSON.stringify(validExplainer()));
  assert.equal(out.ok, true);
  assert.equal(out.explainer.title, "Tides");
  assert.equal(out.explainer.keyIdeas.length, 3);
  assert.equal(out.explainer.mechanism[0].step, 1);
  assert.equal(out.explainer.mechanism[2].step, 3);
  assert.equal(out.explainer.questions.length, 3);
  assert.match(out.explainer.imagePrompt, /bulges/);
});

test("parseExplainer accepts a fenced object wrapped in prose", () => {
  const text = "Here is your explainer.\n```json\n" + JSON.stringify(validExplainer()) + "\n```\nHope that helps.";
  const out = C.parseExplainer(text);
  assert.equal(out.ok, true);
  assert.equal(out.explainer.title, "Tides");
});

test("parseExplainer renumbers mechanism steps in order", () => {
  const data = validExplainer();
  data.mechanism.forEach((s) => { s.step = 99; });
  const out = C.parseExplainer(JSON.stringify(data));
  assert.equal(out.ok, true);
  assert.deepEqual(out.explainer.mechanism.map((s) => s.step), [1, 2, 3]);
});

test("parseExplainer accepts questions given as objects", () => {
  const data = validExplainer();
  data.questions = data.questions.map((q) => ({ question: q }));
  const out = C.parseExplainer(JSON.stringify(data));
  assert.equal(out.ok, true);
  assert.equal(out.explainer.questions[0], validExplainer().questions[0]);
});

test("parseExplainer rejects non JSON and empty input", () => {
  assert.equal(C.parseExplainer("no json here").ok, false);
  assert.equal(C.parseExplainer("").ok, false);
  assert.equal(C.parseExplainer(null).ok, false);
  assert.equal(C.parseExplainer("{broken").ok, false);
});

test("parseExplainer rejects missing or short sections", () => {
  const noTitle = validExplainer(); delete noTitle.title;
  assert.equal(C.parseExplainer(JSON.stringify(noTitle)).ok, false);

  const fewIdeas = validExplainer(); fewIdeas.keyIdeas = fewIdeas.keyIdeas.slice(0, 2);
  assert.match(C.parseExplainer(JSON.stringify(fewIdeas)).error, /keyIdeas/);

  const fewSteps = validExplainer(); fewSteps.mechanism = fewSteps.mechanism.slice(0, 2);
  assert.match(C.parseExplainer(JSON.stringify(fewSteps)).error, /mechanism/);

  const oneMyth = validExplainer(); oneMyth.misconceptions = oneMyth.misconceptions.slice(0, 1);
  assert.match(C.parseExplainer(JSON.stringify(oneMyth)).error, /misconceptions/);

  const badPair = validExplainer(); badPair.keyIdeas[0] = { title: "x" };
  assert.equal(C.parseExplainer(JSON.stringify(badPair)).ok, false);
});

test("parseExplainer rejects anything but exactly 3 questions", () => {
  const two = validExplainer(); two.questions = two.questions.slice(0, 2);
  const outTwo = C.parseExplainer(JSON.stringify(two));
  assert.equal(outTwo.ok, false);
  assert.match(outTwo.error, /exactly 3/);

  const four = validExplainer(); four.questions.push("One more?");
  assert.equal(C.parseExplainer(JSON.stringify(four)).ok, false);
});

test("buildExplainerPrompt names the topic and every field", () => {
  const prompt = C.buildExplainerPrompt("  black   holes ");
  assert.match(prompt, /Topic: black holes/);
  for (const field of ["title", "summary", "keyIdeas", "mechanism", "misconceptions", "questions", "imagePrompt"]) {
    assert.ok(prompt.includes('"' + field + '"'), field);
  }
  assert.match(prompt, /strict JSON only/);
  assert.match(prompt, /exactly 3/);
});

test("buildRepairPrompt carries the error, the shape and the bad text", () => {
  const prompt = C.buildRepairPrompt("tides", "{oops", "questions must be exactly 3.", "explainer");
  assert.match(prompt, /exactly 3/);
  assert.match(prompt, /\{oops/);
  assert.match(prompt, /"keyIdeas"/);
  const divePrompt = C.buildRepairPrompt("tides", "x", "bad", "dive");
  assert.match(divePrompt, /"checkAnswer"/);
});

test("sectionsFor covers every item in every section", () => {
  const ex = C.parseExplainer(JSON.stringify(validExplainer())).explainer;
  const targets = C.sectionsFor(ex);
  assert.equal(targets.length, 3 + 3 + 2 + 3);
  const kinds = {};
  targets.forEach((t) => { kinds[t.kind] = (kinds[t.kind] || 0) + 1; });
  assert.deepEqual(kinds, { keyIdea: 3, mechanism: 3, misconception: 2, question: 3 });
  const ids = targets.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(C.getTarget(ex, "question-2"));
  assert.equal(C.getTarget(ex, "nope-9"), null);
  assert.match(C.getTarget(ex, "misconception-0").context, /Myth:/);
});

test("buildDivePrompt includes topic, summary, clicked part and its focus", () => {
  const ex = C.parseExplainer(JSON.stringify(validExplainer())).explainer;
  const target = C.getTarget(ex, "mechanism-1");
  const prompt = C.buildDivePrompt("tides", ex, target);
  assert.match(prompt, /Science topic: tides/);
  assert.match(prompt, /Overall summary: The sea rises/);
  assert.match(prompt, /Two bulges form/);
  assert.match(prompt, /Slow this step down/);
  assert.match(prompt, /strict JSON only/);
  assert.match(prompt, /"checkQuestion"/);

  const qTarget = C.getTarget(ex, "question-0");
  assert.match(C.buildDivePrompt("tides", ex, qTarget), /still unknown/);
  assert.equal(C.buildDivePrompt("tides", ex, null), "");
});

test("parseDive accepts a full dive and rejects partial ones", () => {
  const dive = {
    heading: "Why two bulges",
    body: "One body of text.",
    example: "A bay at full moon.",
    checkQuestion: "How many bulges are there?",
    checkAnswer: "Two."
  };
  const out = C.parseDive("```json\n" + JSON.stringify(dive) + "\n```");
  assert.equal(out.ok, true);
  assert.equal(out.dive.checkAnswer, "Two.");

  const partial = { ...dive }; delete partial.example;
  assert.equal(C.parseDive(JSON.stringify(partial)).ok, false);
  assert.equal(C.parseDive("plain text").ok, false);
});

test("explorer state: a new topic clears dives, order is kept", () => {
  const state = C.createExplorerState();
  const ex = C.parseExplainer(JSON.stringify(validExplainer())).explainer;
  C.setExplainer(state, " tides ", ex, false);
  assert.equal(state.topic, "tides");
  assert.equal(C.diveCount(state), 0);

  const dive = { heading: "h", body: "b", example: "e", checkQuestion: "q", checkAnswer: "a" };
  C.startDive(state, "key-idea-0");
  assert.equal(state.pending["key-idea-0"], true);
  C.recordDive(state, "key-idea-0", dive);
  assert.equal(state.pending["key-idea-0"], undefined);
  assert.equal(state.expanded["key-idea-0"], true);
  assert.equal(C.getDive(state, "key-idea-0"), dive);

  C.recordDive(state, "question-1", dive);
  C.recordDive(state, "key-idea-0", dive);
  assert.deepEqual(state.history, ["key-idea-0", "question-1"]);
  assert.equal(C.diveCount(state), 2);

  C.toggleExpanded(state, "key-idea-0");
  assert.equal(state.expanded["key-idea-0"], false);

  C.startDive(state, "mechanism-0");
  C.failDive(state, "mechanism-0", "boom");
  assert.equal(state.errors["mechanism-0"], "boom");
  assert.equal(state.pending["mechanism-0"], undefined);

  C.setExplainer(state, "volcanoes", ex, false);
  assert.equal(state.topic, "volcanoes");
  assert.equal(C.diveCount(state), 0);
  assert.deepEqual(state.dives, {});
  assert.deepEqual(state.errors, {});
});

test("validateKey checks format only", () => {
  assert.equal(C.validateKey("sk_" + "a".repeat(24)).ok, true);
  assert.equal(C.validateKey("  pk_" + "b".repeat(24) + " ").ok, true);
  assert.equal(C.validateKey("").ok, false);
  assert.equal(C.validateKey("hello-world-key-123456").ok, false);
  assert.equal(C.validateKey("sk_short").ok, false);
  assert.equal(C.validateKey("sk_has space in it 123456").ok, false);
  assert.equal(C.validateKey(42).ok, false);
});

test("buildChatRequest sets low reasoning effort and a large token budget", () => {
  const req = C.buildChatRequest("z-ai/glm-5.3-flash", "hello");
  assert.equal(req.model, "z-ai/glm-5.3-flash");
  assert.equal(req.reasoning_effort, "low");
  assert.ok(req.max_tokens >= 4000);
  assert.equal(req.messages[0].content, "hello");
  assert.equal(C.buildChatRequest("", "x").model, C.DEFAULT_TEXT_MODEL);
});

test("extractChatText reads string and part based content, surfaces errors", () => {
  const plain = { choices: [{ message: { content: " hi " }, finish_reason: "stop" }] };
  assert.deepEqual(C.extractChatText(plain), { ok: true, text: "hi" });
  const parts = { choices: [{ message: { content: [{ text: "a" }, { text: "b" }, "c"] } }] };
  assert.equal(C.extractChatText(parts).text, "abc");
  assert.equal(C.extractChatText({ error: { message: "nope" } }).error, "nope");
  assert.equal(C.extractChatText(null).ok, false);
  assert.equal(C.extractChatText({ choices: [{ message: { content: "  " } }] }).ok, false);
});

test("buildImagePrompt and buildImageUrl stay on gen.pollinations.ai with no key", () => {
  const ex = C.parseExplainer(JSON.stringify(validExplainer())).explainer;
  const prompt = C.buildImagePrompt("tides", ex);
  assert.match(prompt, /educational science diagram/);
  assert.match(prompt, /ocean bulges/);

  const fallback = C.buildImagePrompt("volcanoes", { imagePrompt: "" });
  assert.match(fallback, /how volcanoes works/);

  const url = C.buildImageUrl(prompt, "black-forest-labs/flux.1-schnell");
  assert.ok(url.startsWith("https://gen.pollinations.ai/image/"));
  assert.ok(url.includes("model=black-forest-labs%2Fflux.1-schnell"));
  assert.ok(!url.includes("sk_"));
  assert.ok(!/\s/.test(url));
});

test("demo explainer passes the same strict validation as a live reply", () => {
  const demo = C.getDemoExplainer();
  const out = C.parseExplainer(JSON.stringify(demo));
  assert.equal(out.ok, true);
  assert.match(out.explainer.title, /Photosynthesis/);
  assert.equal(out.explainer.questions.length, 3);
  // Demo dives are labelled as sample text, never as a live answer.
  const target = C.getTarget(demo, "key-idea-0");
  const dive = C.getDemoDive(target);
  assert.match(dive.body, /built-in sample text, not a live answer/);
  assert.match(dive.heading, /Sample dive/);
});

test("catalog defaults are not paid only, so a free tier key can run the app", () => {
  for (const m of C.TEXT_MODELS) assert.equal(m.paidOnly, false, m.id);
  for (const m of C.IMAGE_MODELS) assert.equal(m.paidOnly, false, m.id);
  assert.ok(C.TEXT_MODELS.some((m) => m.id === C.DEFAULT_TEXT_MODEL));
  assert.ok(C.IMAGE_MODELS.some((m) => m.id === C.DEFAULT_IMAGE_MODEL));
});
