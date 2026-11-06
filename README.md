# Science Explorer

[![Made with pollinations.ai](https://raw.githubusercontent.com/pollinations/pollinations/main/packages/ui/src/brand/badge-made-with.svg)](https://pollinations.ai/?ref=badge)

Turn a science topic into something you can explore.

Type a topic, get a structured explainer, then click any part of it to go
deeper. A generated diagram rounds it off.

Live app: to be set when this folder is hosted (static site, see Run it).
Submission: quest #19181, see SUBMISSION.md.

## What it does

- One topic in, one structured explainer out:
  - Key ideas, 3 to 5.
  - A step by step mechanism, 3 to 6 steps, in order.
  - Common misconceptions, 2 to 3, each with the correction.
  - Exactly 3 open exploration questions.
- Every idea, step, misconception and question is clickable. A click makes
  a follow-up call with that part and the summary as context, and renders a
  deeper look under the item: a short body, one concrete example, and a
  check question with a hidden answer.
- A diagram button generates one illustration for the topic with an image
  model. The prompt comes from the explainer itself.
- Replies are parsed as strict JSON and validated field by field. A reply
  that fails parsing gets exactly one repair retry. A second failure shows
  an error. Nothing half parsed is rendered.
- Chat requests set reasoning_effort to "low" and a 6000 token budget, so
  reasoning models do not spend the whole budget on hidden reasoning.

## Bring your own Pollen (BYOP)

- Paste a Pollinations secret key (sk_...) in the page. Validate checks it
  live against GET /account/balance on gen.pollinations.ai.
- The key is stored only in the visitor's browser, in localStorage under
  `science_explorer_pollinations_key`. Clear removes it.
- Calls go only to gen.pollinations.ai:
  - POST /v1/chat/completions, key in the Authorization header.
  - GET /image/{prompt}, key in the Authorization header, never in the URL.
    The image is fetched as a blob and shown from a local object URL.
- Cost per use, on the visitor's own Pollen: one chat call per explainer,
  one per dive, one image call per diagram. Default text and image models
  are not paid-only, so a free tier key can run the whole app.
- No key set: demo mode. The app loads a built-in sample explainer on
  photosynthesis and sample dive text. Both are labelled as demo sample on
  screen at all times, never as a live answer. If a topic other than
  photosynthesis is typed in demo mode, the page says plainly that the
  sample is what is shown.

## Run it

Static site, no build step, no server code. Serve the folder:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Or host the folder as is on any static host, for example GitHub Pages.

Files:

- `index.html`, `styles.css` - page and styling.
- `core.js` - all testable logic: prompts, strict JSON parsing and
  validation, section targets, dive prompts, explorer state, demo data.
  Runs in the browser as `window.ScienceExplorer` and in node for tests.
- `app.js` - DOM wiring and fetch calls only.
- `tests/core.test.js` - node tests for the core logic.

## Tests

```sh
npm test
# or: node --test tests/core.test.js
```

19 tests cover: explainer parsing (bare, fenced, prose wrapped, object
style questions, step renumbering), every rejection path (missing fields,
short sections, wrong question count, broken JSON), explainer and dive
prompt building, dive parsing, explorer state (new topic clears dives,
history order, pending and error handling, expand toggle), key format
validation, chat request shape, chat response reading, image prompt and
URL building, the demo explainer passing the same validation as a live
reply, and the model catalog defaults not being paid-only.

## Quest

Built for Pollinations quest #19181: "An app that turns a science topic
into something you can explore" (10 Pollen, best submission wins).
The ready to file app submission text is in SUBMISSION.md.
