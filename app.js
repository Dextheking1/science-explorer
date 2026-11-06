"use strict";

// Science Explorer page wiring. All logic that can be tested lives in
// core.js. This file only does DOM work and fetch calls.
// Calls go only to gen.pollinations.ai, with the visitor's own key.

(function () {
  var C = window.ScienceExplorer;
  var state = C.createExplorerState();

  var els = {};
  [
    "keyInput", "validateKeyBtn", "clearKeyBtn", "keyMessage", "keyStatus",
    "modeBadge", "modelSelect", "imageModelSelect", "topicInput",
    "exploreBtn", "demoBtn", "statusLine", "demoBanner", "explainer",
    "imagePanel"
  ].forEach(function (id) { els[id] = document.getElementById(id); });

  function getKey() {
    try { return localStorage.getItem(C.STORAGE_KEY) || ""; } catch (e) { return ""; }
  }
  function saveKey(key) {
    try {
      if (key) localStorage.setItem(C.STORAGE_KEY, key);
      else localStorage.removeItem(C.STORAGE_KEY);
    } catch (e) { /* storage off, key lives for this page only */ }
  }

  function setStatus(text) { els.statusLine.textContent = text || ""; }
  function setKeyMessage(text, ok) {
    els.keyMessage.textContent = text || "";
    els.keyMessage.className = "key-message" + (text ? (ok ? " ok" : " bad") : "");
  }

  function refreshMode() {
    var hasKey = !!getKey();
    els.modeBadge.textContent = hasKey ? "Live mode - your key, your Pollen" : "Demo mode - built-in sample only";
    els.modeBadge.className = "badge " + (hasKey ? "badge-live" : "badge-demo");
    els.keyStatus.textContent = hasKey ? "Key set in this browser" : "No key set";
    els.demoBanner.hidden = hasKey || !state.explainer;
  }

  async function callModel(prompt) {
    var key = getKey();
    var res = await fetch(C.API_BASE + "/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + key
      },
      body: JSON.stringify(C.buildChatRequest(els.modelSelect.value, prompt))
    });
    var data = await res.json().catch(function () { return null; });
    if (!res.ok) {
      var msg = data && data.error && data.error.message ? data.error.message : ("HTTP " + res.status);
      throw new Error(msg);
    }
    var out = C.extractChatText(data);
    if (!out.ok) throw new Error(out.error);
    return out.text;
  }

  // Strict JSON, one retry. First reply is parsed as is. If that fails,
  // the model gets one repair call with the error and its own bad text.
  // A second failure is shown to the reader, nothing is rendered half parsed.
  async function callForJson(prompt, topic, kind, parser) {
    var first = await callModel(prompt);
    var parsed = parser(first);
    if (parsed.ok) return parsed;
    var repair = C.buildRepairPrompt(topic, first, parsed.error, kind);
    var second = await callModel(repair);
    var retried = parser(second);
    if (!retried.ok) {
      throw new Error("Model did not return readable JSON after one retry: " + retried.error);
    }
    return retried;
  }

  async function validateKeyLive() {
    var check = C.validateKey(els.keyInput.value);
    if (!check.ok) { setKeyMessage(check.error, false); return; }
    setKeyMessage("Checking key...", true);
    try {
      var res = await fetch(C.API_BASE + "/account/balance", {
        headers: { "Authorization": "Bearer " + check.key }
      });
      if (res.status === 401 || res.status === 403) {
        setKeyMessage("Key was rejected by the API (" + res.status + "). Nothing was saved.", false);
        return;
      }
      if (!res.ok) {
        setKeyMessage("Key check failed with HTTP " + res.status + ". Nothing was saved.", false);
        return;
      }
      var data = await res.json().catch(function () { return null; });
      saveKey(check.key);
      var balance = data && data.accountBalance && typeof data.accountBalance.total === "number"
        ? " Balance: " + data.accountBalance.total.toFixed(4) + " Pollen."
        : "";
      setKeyMessage("Key works and is saved in this browser only." + balance, true);
      refreshMode();
    } catch (e) {
      setKeyMessage("Key check could not reach gen.pollinations.ai: " + e.message, false);
    }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function renderDive(target) {
    var slot = document.querySelector('[data-dive-for="' + target.id + '"]');
    if (!slot) return;
    slot.innerHTML = "";
    if (state.pending[target.id]) {
      slot.appendChild(el("p", "dive-status", "Diving deeper..."));
      return;
    }
    if (state.errors[target.id]) {
      slot.appendChild(el("p", "dive-status bad", state.errors[target.id]));
      return;
    }
    var dive = C.getDive(state, target.id);
    if (!dive) return;
    if (!state.expanded[target.id]) {
      var showBtn = el("button", "ghost small", "Show the deeper look");
      showBtn.type = "button";
      showBtn.addEventListener("click", function () {
        C.toggleExpanded(state, target.id);
        renderDive(target);
      });
      slot.appendChild(showBtn);
      return;
    }
    var box = el("div", "dive-box");
    box.appendChild(el("h4", "", dive.heading));
    box.appendChild(el("p", "", dive.body));
    box.appendChild(el("p", "dive-example", "Example: " + dive.example));
    box.appendChild(el("p", "dive-check", "Check yourself: " + dive.checkQuestion));
    var answer = el("p", "dive-answer", "Answer: " + dive.checkAnswer);
    answer.hidden = true;
    var reveal = el("button", "ghost small", "Reveal answer");
    reveal.type = "button";
    reveal.addEventListener("click", function () {
      answer.hidden = !answer.hidden;
      reveal.textContent = answer.hidden ? "Reveal answer" : "Hide answer";
    });
    var hide = el("button", "ghost small", "Hide");
    hide.type = "button";
    hide.addEventListener("click", function () {
      C.toggleExpanded(state, target.id);
      renderDive(target);
    });
    box.appendChild(reveal);
    box.appendChild(answer);
    box.appendChild(hide);
    slot.appendChild(box);
  }

  async function dive(target) {
    if (state.pending[target.id]) return;
    if (C.getDive(state, target.id)) {
      C.toggleExpanded(state, target.id);
      renderDive(target);
      return;
    }
    C.startDive(state, target.id);
    renderDive(target);
    if (state.demo || !getKey()) {
      C.recordDive(state, target.id, C.getDemoDive(target));
      renderDive(target);
      return;
    }
    try {
      var prompt = C.buildDivePrompt(state.topic, state.explainer, target);
      var parsed = await callForJson(prompt, state.topic, "dive", C.parseDive);
      C.recordDive(state, target.id, parsed.dive);
    } catch (e) {
      C.failDive(state, target.id, "Dive failed: " + e.message);
    }
    renderDive(target);
  }

  function itemCard(target, bodyText, metaText) {
    var card = el("article", "item-card");
    var head = el("button", "item-head");
    head.type = "button";
    head.setAttribute("aria-label", "Dive deeper into: " + target.title);
    head.appendChild(el("span", "item-title", target.title));
    head.appendChild(el("span", "item-action", "Dive deeper"));
    head.addEventListener("click", function () { dive(target); });
    card.appendChild(head);
    if (metaText) card.appendChild(el("p", "item-meta", metaText));
    card.appendChild(el("p", "item-body", bodyText));
    var slot = el("div", "dive-slot");
    slot.setAttribute("data-dive-for", target.id);
    card.appendChild(slot);
    return card;
  }

  function sectionBlock(heading, note, cards) {
    var block = el("section", "explainer-section");
    block.appendChild(el("h3", "", heading));
    if (note) block.appendChild(el("p", "section-note", note));
    var grid = el("div", "card-grid");
    cards.forEach(function (card) { grid.appendChild(card); });
    block.appendChild(grid);
    return block;
  }

  function renderExplainer() {
    els.explainer.innerHTML = "";
    els.imagePanel.innerHTML = "";
    refreshMode();
    var ex = state.explainer;
    if (!ex) {
      els.explainer.appendChild(el("p", "empty", "Enter a topic above. With a key you get a live explainer. Without one, the built-in photosynthesis sample loads so you can see the full layout."));
      return;
    }
    var targets = {};
    C.sectionsFor(ex).forEach(function (t) { targets[t.id] = t; });

    var head = el("div", "explainer-head");
    head.appendChild(el("h2", "", ex.title));
    if (state.demo) head.appendChild(el("span", "badge badge-demo", "Demo sample - not a live answer"));
    head.appendChild(el("p", "summary", ex.summary));
    els.explainer.appendChild(head);

    var byKind = { keyIdea: [], mechanism: [], misconception: [], question: [] };
    Object.keys(targets).forEach(function (id) { byKind[targets[id].kind].push(targets[id]); });

    els.explainer.appendChild(sectionBlock(
      "Key ideas",
      "Click any idea to dive deeper into it.",
      byKind.keyIdea.map(function (t) {
        var idea = ex.keyIdeas[t.index];
        return itemCard(t, idea.detail, null);
      })
    ));
    els.explainer.appendChild(sectionBlock(
      "How it works, step by step",
      "The mechanism in order. Click a step to slow it down.",
      byKind.mechanism.map(function (t) {
        var step = ex.mechanism[t.index];
        return itemCard(t, step.detail, "Step " + step.step + " of " + ex.mechanism.length);
      })
    ));
    els.explainer.appendChild(sectionBlock(
      "Common misconceptions",
      "Click one to see where the wrong idea comes from and what settles it.",
      byKind.misconception.map(function (t) {
        var item = ex.misconceptions[t.index];
        return itemCard(t, item.fact, "Myth: " + item.myth);
      })
    ));
    els.explainer.appendChild(sectionBlock(
      "Explore further",
      "Three open questions. Click one and the model takes it as far as current science does.",
      byKind.question.map(function (t) {
        return itemCard(t, "No short answer. That is the point of the question.", null);
      })
    ));

    var imageBox = el("div", "image-box");
    imageBox.appendChild(el("h3", "", "Diagram"));
    imageBox.appendChild(el("p", "section-note", "One generated illustration for this topic, made with the image model on your key."));
    var imgBtn = el("button", "primary", state.demo ? "Diagram unavailable in demo mode" : "Generate diagram");
    imgBtn.type = "button";
    imgBtn.disabled = !!state.demo;
    imgBtn.addEventListener("click", generateImage);
    imageBox.appendChild(imgBtn);
    var holder = el("div", "image-holder");
    holder.id = "imageHolder";
    imageBox.appendChild(holder);
    els.imagePanel.appendChild(imageBox);
  }

  async function generateImage() {
    var holder = document.getElementById("imageHolder");
    if (!holder || state.demo || !getKey()) return;
    holder.innerHTML = "";
    holder.appendChild(el("p", "dive-status", "Generating diagram..."));
    try {
      var prompt = C.buildImagePrompt(state.topic, state.explainer);
      var url = C.buildImageUrl(prompt, els.imageModelSelect.value);
      // The key goes in the header, never in the image URL.
      var res = await fetch(url, { headers: { "Authorization": "Bearer " + getKey() } });
      if (!res.ok) throw new Error("Image call failed with HTTP " + res.status);
      var blob = await res.blob();
      var img = document.createElement("img");
      img.src = URL.createObjectURL(blob);
      img.alt = "Generated diagram for " + state.topic;
      holder.innerHTML = "";
      holder.appendChild(img);
      holder.appendChild(el("p", "section-note", "Prompt: " + prompt));
      state.imageStatus = "done";
    } catch (e) {
      holder.innerHTML = "";
      holder.appendChild(el("p", "dive-status bad", "Diagram failed: " + e.message));
      state.imageStatus = "failed";
    }
  }

  function loadDemo(topic) {
    var useTopic = C.cleanTopic(topic);
    var ex = C.getDemoExplainer();
    // The sample is photosynthesis whatever was typed. Say so on screen.
    C.setExplainer(state, "photosynthesis", ex, true);
    renderExplainer();
    setStatus(useTopic && useTopic.toLowerCase() !== "photosynthesis"
      ? "Demo mode: showing the built-in photosynthesis sample, not a live answer about \"" + useTopic + "\". Add your key for a live explainer on any topic."
      : "Demo mode: built-in photosynthesis sample. Add your key for a live explainer on any topic.");
  }

  async function explore() {
    var topic = C.cleanTopic(els.topicInput.value);
    if (!topic) { setStatus("Enter a science topic first."); return; }
    if (!getKey()) { loadDemo(topic); return; }
    els.exploreBtn.disabled = true;
    setStatus("Building your explainer for \"" + topic + "\"...");
    try {
      var prompt = C.buildExplainerPrompt(topic);
      var parsed = await callForJson(prompt, topic, "explainer", C.parseExplainer);
      C.setExplainer(state, topic, parsed.explainer, false);
      renderExplainer();
      setStatus("Explainer ready. Click any part to dive deeper. Dives so far: " + C.diveCount(state) + ".");
    } catch (e) {
      setStatus("Explainer failed: " + e.message);
    } finally {
      els.exploreBtn.disabled = false;
    }
  }

  function fillSelect(select, models) {
    models.forEach(function (m) {
      var opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.title + " (" + m.id + ")" + (m.paidOnly ? " - paid only" : "");
      select.appendChild(opt);
    });
  }

  fillSelect(els.modelSelect, C.TEXT_MODELS);
  fillSelect(els.imageModelSelect, C.IMAGE_MODELS);
  els.modelSelect.value = C.DEFAULT_TEXT_MODEL;
  els.imageModelSelect.value = C.DEFAULT_IMAGE_MODEL;
  els.keyInput.value = getKey();

  els.validateKeyBtn.addEventListener("click", validateKeyLive);
  els.clearKeyBtn.addEventListener("click", function () {
    saveKey("");
    els.keyInput.value = "";
    setKeyMessage("Key cleared from this browser.", true);
    refreshMode();
  });
  els.exploreBtn.addEventListener("click", explore);
  els.demoBtn.addEventListener("click", function () { loadDemo("photosynthesis"); });
  els.topicInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") explore();
  });

  renderExplainer();
  refreshMode();
})();
