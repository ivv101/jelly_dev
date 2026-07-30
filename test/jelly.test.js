"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  LEVELS,
  Stage,
  rebuildStage,
  startGame,
} = require("../jelly.js");

class FakeElement {
  constructor(ownerDocument, tagName) {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.className = "";
    this.value = "";
    this.listeners = new Map();
  }

  get firstChild() {
    return this.children[0] || null;
  }

  set innerHTML(value) {
    if (value !== "") {
      throw new Error("The fake DOM only supports clearing innerHTML");
    }
    this.replaceChildren();
  }

  appendChild(child) {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index === -1) {
      throw new Error("Cannot remove a child that is not attached");
    }
    this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  replaceChildren(...children) {
    for (const child of this.children) {
      child.parentNode = null;
    }
    this.children = [];
    for (const child of children) {
      this.appendChild(child);
    }
  }

  addEventListener(type, handler, options = false) {
    const capture = options === true || Boolean(options && options.capture);
    const records = this.listeners.get(type) || [];
    records.push({ handler, capture });
    this.listeners.set(type, records);
  }

  removeEventListener(type, handler, options = false) {
    const capture = options === true || Boolean(options && options.capture);
    const records = this.listeners.get(type) || [];
    const index = records.findIndex(
      (record) => record.handler === handler && record.capture === capture,
    );
    if (index !== -1) {
      records.splice(index, 1);
    }
    if (records.length === 0) {
      this.listeners.delete(type);
    }
  }

  listenerCount(type, capture) {
    const records = this.listeners.get(type) || [];
    if (capture === undefined) {
      return records.length;
    }
    return records.filter((record) => record.capture === capture).length;
  }

  dispatch(type, properties = {}) {
    const event = {
      type,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.propagationStopped = true;
      },
      ...properties,
    };
    for (const record of [...(this.listeners.get(type) || [])]) {
      record.handler(event);
      if (event.propagationStopped) {
        break;
      }
    }
    return event;
  }
}

class FakeTextNode {
  constructor(ownerDocument, text) {
    this.ownerDocument = ownerDocument;
    this.textContent = text;
    this.parentNode = null;
  }
}

class FakeDocument {
  constructor() {
    this.elements = new Map();
    this.alerts = [];
    this.defaultView = {
      alert: (message) => this.alerts.push(message),
    };
  }

  createElement(tagName) {
    return new FakeElement(this, tagName);
  }

  createTextNode(text) {
    return new FakeTextNode(this, text);
  }

  getElementById(id) {
    return this.elements.get(id) || null;
  }

  addElement(id, tagName) {
    const element = this.createElement(tagName);
    this.elements.set(id, element);
    return element;
  }
}

function createStage(spec) {
  const document = new FakeDocument();
  const map = document.createElement("div");
  return { document, map, stage: new Stage(map, spec) };
}

function createApp() {
  const document = new FakeDocument();
  const map = document.addElement("map", "div");
  const level = document.addElement("level", "select");
  const reset = document.addElement("reset", "button");
  const undo = document.addElement("undo", "button");
  const location = { search: "" };
  const window = {};
  const app = startGame(document, location, window);
  return { document, map, level, reset, undo, location, window, app };
}

function withFakeClock(callback) {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let nextId = 1;
  const tasks = new Map();
  globalThis.setTimeout = (fn, delay = 0) => {
    const id = nextId;
    nextId += 1;
    tasks.set(id, { fn, delay });
    return id;
  };
  globalThis.clearTimeout = (id) => tasks.delete(id);

  const clock = {
    get pendingCount() {
      return tasks.size;
    },
    runNext() {
      const entry = tasks.entries().next().value;
      if (!entry) {
        return false;
      }
      const [id, task] = entry;
      tasks.delete(id);
      task.fn();
      return true;
    },
    runAll(limit = 100) {
      let count = 0;
      while (this.runNext()) {
        count += 1;
        if (count > limit) {
          throw new Error("Fake timer loop did not settle");
        }
      }
    },
  };

  try {
    return callback(clock);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
}

function settle(stage, map, clock) {
  let iterations = 0;
  while (stage.busy) {
    if (map.listenerCount("transitionend") > 0) {
      map.dispatch("transitionend");
    }
    clock.runAll();
    iterations += 1;
    if (iterations > 20) {
      throw new Error("Stage did not settle");
    }
  }
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sortByJson(left, right) {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function normalizeStage(stage, alerts) {
  return {
    map: stage.saveForUndoMap(),
    anchors: stage
      .saveForUndoAnchors()
      .map(({ x, y, dir, delayed }) => ({ x, y, dir, delayed: Boolean(delayed) }))
      .sort(sortByJson),
    growers: stage
      .saveForUndoGrowers()
      .map(({ x, y, dir, color }) => ({ x, y, dir, color }))
      .sort(sortByJson),
    jellies: stage.jellies
      .map((jelly) => ({
        immovable: jelly.immovable,
        cells: jelly
          .cellCoords()
          .map(([x, y, cell]) => [x, y, cell.color])
          .sort(),
      }))
      .sort(sortByJson),
    blocks: stage.num_monochromatic_blocks,
    colors: stage.num_colors,
    alerts,
  };
}

const SIMPLE_LEVEL = ["xxxxxx", "x r  x", "xxxxxx"];
const GROWER_LEVEL = [
  ["xxxxxx", "xxr  x", "xxxxxx"],
  [],
  [{ x: 1, y: 1, dir: "right", color: "red" }],
];
const ROOT_EVENTS = ["contextmenu", "click", "touchstart", "touchmove"];

test("plain JavaScript is the sole runtime source", () => {
  const projectRoot = path.join(__dirname, "..");
  assert.equal(existsSync(path.join(projectRoot, "jelly.coffee")), false);
  assert.doesNotMatch(
    readFileSync(path.join(projectRoot, "jelly.js"), "utf8"),
    /CoffeeScript/,
  );
});

test("standalone HTML embeds the runtime and omits the old footer", () => {
  const projectRoot = path.join(__dirname, "..");
  const index = readFileSync(path.join(projectRoot, "index.html"), "utf8");
  const standalone = readFileSync(
    path.join(projectRoot, "jelly-standalone.html"),
    "utf8",
  );

  for (const html of [index, standalone]) {
    assert.doesNotMatch(html, /Here's the source/);
    assert.doesNotMatch(html, /To be implemented/);
    assert.doesNotMatch(html, /Beautiful "you win" screen/);
  }
  assert.match(index, /<script\s+src=(['"])jelly\.js\1><\/script>/);
  assert.doesNotMatch(
    standalone,
    /<script\s+src=(['"])jelly\.js\1><\/script>/,
  );
  assert.match(standalone, /<script>\s*"use strict";/);
  assert.match(standalone, /const LEVELS = \[/);
});

test("level data is unchanged by the JavaScript migration", () => {
  assert.equal(LEVELS.length, 40);
  assert.equal(
    hash(LEVELS),
    "f13bef50d4d7c09f876a8f78d221c44d8dbdee896e6b7a5ac4ee71abfe33e90c",
  );
});

test("all level initial states match the legacy runtime", () => {
  const corpus = LEVELS.map((spec) => {
    const { document, stage } = createStage(spec);
    const normalized = normalizeStage(stage, document.alerts.length);
    stage.destroy();
    return normalized;
  });
  assert.equal(
    hash(corpus),
    "4370073674fe946cf077e48b4dfdb77e0cdc7abfcedd8bd892492859e448295b",
  );
});

test("destroy removes root, jelly, animation listeners, and timers", () => {
  withFakeClock((clock) => {
    const { map, stage } = createStage(SIMPLE_LEVEL);
    const jelly = stage.jellies[0];
    for (const type of ROOT_EVENTS) {
      assert.equal(map.listenerCount(type, true), 1);
      assert.equal(jelly.dom.listenerCount(type, false), 1);
    }

    stage.trySlide(jelly, 1);
    assert.equal(stage.busy, true);
    assert.equal(map.listenerCount("transitionend"), 1);
    assert.equal(map.listenerCount("webkitTransitionEnd"), 1);
    map.dispatch("transitionend");
    assert.equal(clock.pendingCount, 1);

    stage.destroy();
    stage.destroy();
    assert.equal(stage.destroyed, true);
    assert.equal(stage.busy, false);
    assert.equal(clock.pendingCount, 0);
    for (const type of ROOT_EVENTS) {
      assert.equal(map.listenerCount(type), 0);
      assert.equal(jelly.dom.listenerCount(type), 0);
    }
    assert.equal(map.listenerCount("transitionend"), 0);
    assert.equal(map.listenerCount("webkitTransitionEnd"), 0);
    clock.runAll();
  });
});

test("rebuilding fifty stages keeps root listener counts constant", () => {
  const { map, stage: firstStage } = createStage(SIMPLE_LEVEL);
  let stage = firstStage;
  for (let index = 0; index < 50; index += 1) {
    const oldStage = stage;
    stage = rebuildStage(stage, SIMPLE_LEVEL);
    assert.equal(oldStage.destroyed, true);
    for (const type of ROOT_EVENTS) {
      assert.equal(map.listenerCount(type, true), 1);
    }
    assert.equal(map.listenerCount("transitionend"), 0);
    assert.equal(map.listenerCount("webkitTransitionEnd"), 0);
  }
  stage.destroy();
});

test("reset during animation cannot leak old continuations into the new stage", () => {
  withFakeClock((clock) => {
    const { map, stage: firstStage } = createStage(SIMPLE_LEVEL);
    firstStage.trySlide(firstStage.jellies[0], 1);
    assert.equal(firstStage.busy, true);

    const nextStage = rebuildStage(firstStage, SIMPLE_LEVEL);
    assert.equal(firstStage.destroyed, true);
    assert.equal(clock.pendingCount, 0);
    assert.deepEqual(nextStage.saveForUndoMap(), SIMPLE_LEVEL);
    map.dispatch("transitionend");
    clock.runAll();
    assert.deepEqual(nextStage.saveForUndoMap(), SIMPLE_LEVEL);

    nextStage.trySlide(nextStage.jellies[0], 1);
    settle(nextStage, map, clock);
    assert.equal(nextStage.jellies[0].x, 3);
    assert.equal(nextStage.history.length, 1);
    nextStage.destroy();
  });
});

test("reset during a grow chain cancels its delayed continuation", () => {
  withFakeClock((clock) => {
    const { stage: firstStage } = createStage(GROWER_LEVEL);
    firstStage.checkForGrows();
    assert.equal(firstStage.growers.length, 0);
    assert.equal(clock.pendingCount, 1);

    const nextStage = rebuildStage(firstStage, GROWER_LEVEL);
    assert.equal(firstStage.destroyed, true);
    assert.equal(clock.pendingCount, 0);
    assert.equal(nextStage.growers.length, 1);
    clock.runAll();
    assert.equal(nextStage.growers.length, 1);
    nextStage.destroy();
  });
});

test("movement preserves pushing and gravity behavior", () => {
  withFakeClock((clock) => {
    const pushLevel = ["xxxxxxxx", "x rbg  x", "xxxxxxxx"];
    const pushed = createStage(pushLevel);
    pushed.stage.trySlide(pushed.stage.jellies[0], 1);
    settle(pushed.stage, pushed.map, clock);
    assert.deepEqual(pushed.stage.saveForUndoMap(), [
      "xxxxxxxx",
      "x  rbg x",
      "xxxxxxxx",
    ]);
    assert.deepEqual(
      pushed.stage.jellies.map((jelly) => [jelly.x, jelly.y]),
      [
        [3, 1],
        [4, 1],
        [5, 1],
      ],
    );
    pushed.stage.destroy();

    const gravityLevel = ["xxxxxx", "x r  x", "x    x", "x    x", "xxxxxx"];
    const fallen = createStage(gravityLevel);
    fallen.stage.trySlide(fallen.stage.jellies[0], 1);
    settle(fallen.stage, fallen.map, clock);
    assert.deepEqual(fallen.stage.saveForUndoMap(), [
      "xxxxxx",
      "x    x",
      "x    x",
      "x  r x",
      "xxxxxx",
    ]);
    assert.deepEqual([fallen.stage.jellies[0].x, fallen.stage.jellies[0].y], [3, 3]);
    fallen.stage.destroy();
  });
});

test("movement preserves merging and completion behavior", () => {
  withFakeClock((clock) => {
    const { document, map, stage } = createStage([
      "xxxxxxx",
      "x r r x",
      "xxxxxxx",
    ]);
    stage.trySlide(stage.jellies[0], 1);
    settle(stage, map, clock);
    assert.deepEqual(stage.saveForUndoMap(), ["xxxxxxx", "x  rr x", "xxxxxxx"]);
    assert.equal(stage.jellies.length, 1);
    assert.equal(stage.jellies[0].cells.length, 2);
    assert.equal(stage.num_monochromatic_blocks, 1);
    assert.equal(stage.num_colors, 1);
    assert.deepEqual(document.alerts, ["Congratulations! Level completed."]);
    stage.destroy();
  });
});

test("anchored jellies remain immovable", () => {
  const spec = [
    ["xxxxxx", "x r  x", "xxxxxx"],
    [{ x: 2, y: 1, dir: "up" }],
    [],
  ];
  const { stage } = createStage(spec);
  assert.equal(stage.jellies[0].immovable, true);
  stage.trySlide(stage.jellies[0], 1);
  assert.deepEqual(stage.saveForUndoMap(), spec[0]);
  assert.equal(stage.history.length, 0);
  assert.equal(stage.busy, false);
  stage.destroy();
});

test("growers and delayed anchors preserve their activation behavior", () => {
  withFakeClock((clock) => {
    const grown = createStage(GROWER_LEVEL);
    grown.stage.checkForGrows();
    clock.runAll();
    assert.deepEqual(grown.stage.saveForUndoMap(), ["xxxxxx", "xxrr x", "xxxxxx"]);
    assert.equal(grown.stage.growers.length, 0);
    assert.equal(grown.stage.jellies.length, 1);
    assert.equal(grown.stage.jellies[0].cells.length, 2);
    assert.equal(grown.stage.busy, false);
    grown.stage.destroy();

    const delayedSpec = [
      GROWER_LEVEL[0],
      [{ x: 2, y: 1, dir: "up", delayed: true }],
      GROWER_LEVEL[2],
    ];
    const anchored = createStage(delayedSpec);
    anchored.stage.checkForGrows();
    clock.runAll();
    assert.equal(anchored.stage.delayed_anchors.length, 0);
    assert.equal(anchored.stage.anchored_cells.length, 1);
    assert.equal(anchored.stage.jellies[0].immovable, true);
    assert.equal(anchored.stage.busy, false);
    anchored.stage.destroy();
  });
});

test("Reset and Undo replace the active stage without accumulating listeners", () => {
  withFakeClock((clock) => {
    const { map, reset, undo, window, app } = createApp();
    const initialStage = app.stage;
    reset.dispatch("click");
    assert.equal(initialStage.destroyed, true);
    assert.equal(window.stage, app.stage);
    for (const type of ROOT_EVENTS) {
      assert.equal(map.listenerCount(type, true), 1);
    }

    const movedStage = app.stage;
    movedStage.trySlide(movedStage.jellies[0], 1);
    settle(movedStage, map, clock);
    assert.equal(movedStage.history.length, 1);
    undo.dispatch("click");
    assert.equal(movedStage.destroyed, true);
    assert.equal(window.stage, app.stage);
    assert.deepEqual(app.stage.saveForUndoMap(), LEVELS[0]);
    for (const type of ROOT_EVENTS) {
      assert.equal(map.listenerCount(type, true), 1);
    }
    assert.equal(reset.listenerCount("click"), 1);
    assert.equal(undo.listenerCount("click"), 1);
    app.destroy();
  });
});
