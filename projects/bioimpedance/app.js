(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const dom = {
    connectBtn: $("connectBtn"),
    disconnectBtn: $("disconnectBtn"),
    pauseBtn: $("pauseBtn"),
    clearBtn: $("clearBtn"),
    startLoggingBtn: $("startLoggingBtn"),
    stopLoggingBtn: $("stopLoggingBtn"),
    baudRate: $("baudRate"),
    channelCount: $("channelCount"),
    inputFormat: $("inputFormat"),
    windowSeconds: $("windowSeconds"),
    expectedSampleRate: $("expectedSampleRate"),
    notice: $("notice"),
    statusDot: $("statusDot"),
    connectionStatus: $("connectionStatus"),
    serialSupport: $("serialSupport"),
    selectedBaud: $("selectedBaud"),
    frameCount: $("frameCount"),
    byteCount: $("byteCount"),
    rawLineCount: $("rawLineCount"),
    bufferedChars: $("bufferedChars"),
    parseErrorCount: $("parseErrorCount"),
    actualRate: $("actualRate"),
    expectedValues: $("expectedValues"),
    lastValidTime: $("lastValidTime"),
    lastByteTime: $("lastByteTime"),
    loggingStatus: $("loggingStatus"),
    lastRawLine: $("lastRawLine"),
    bufferPreview: $("bufferPreview"),
    lastInvalidReason: $("lastInvalidReason"),
    magnitudePlot: $("magnitudePlot"),
    phasePlot: $("phasePlot"),
    formulaSource: $("formulaSource"),
    formulaExpression: $("formulaExpression"),
    formulaLabel: $("formulaLabel"),
    addFormulaBtn: $("addFormulaBtn"),
    clearFormulaBtn: $("clearFormulaBtn"),
    formulaError: $("formulaError"),
    formulaList: $("formulaList"),
    formulaPlot: $("formulaPlot"),
  };

  const colors = [
    "#0f6b57", "#2563eb", "#c2410c", "#7c3aed", "#0891b2", "#b91c1c",
    "#4d7c0f", "#be185d", "#4338ca", "#0f766e", "#a16207", "#475569",
    "#16a34a", "#ea580c", "#0284c7", "#9333ea", "#dc2626", "#64748b",
  ];

  const formulaColors = ["#111827", "#e11d48", "#7c3aed", "#0ea5e9", "#f97316", "#16a34a"];

  const state = {
    port: null,
    reader: null,
    keepReading: false,
    connected: false,
    paused: false,
    baudRate: 115200,
    channelCount: 12,
    inputFormat: "interleaved",
    windowSeconds: 10,
    expectedSampleRate: 5,
    frameCount: 0,
    byteCount: 0,
    rawLineCount: 0,
    bufferedChars: 0,
    parseErrorCount: 0,
    lastByteTimeMs: null,
    lastRawLine: "",
    bufferPreview: "",
    lastInvalidReason: "",
    samples: [],
    receiveTimes: [],
    latest: null,
    logging: false,
    logRows: [],
    magnitudePlot: null,
    phasePlot: null,
    formulaPlot: null,
    formulas: [],
    nextFormulaId: 1,
    needsPlotUpdate: true,
    lastPlotUpdateMs: 0,
  };

  init();

  function init() {
    bindEvents();
    applySettingsFromControls();
    initPlots();
    renderFormulaList();
    updateControls();
    updateStatus();
    window.setInterval(refreshRuntimeStatus, 500);
    requestAnimationFrame(plotLoop);

    if (!("serial" in navigator)) {
      setNotice("Web Serial is not available. Use a recent Chrome or Edge browser over HTTPS or localhost.", "error");
      dom.serialSupport.textContent = "Not available";
    } else {
      dom.serialSupport.textContent = "Available";
    }
  }

  function bindEvents() {
    dom.connectBtn.addEventListener("click", connectSerial);
    dom.disconnectBtn.addEventListener("click", disconnectSerial);
    dom.pauseBtn.addEventListener("click", togglePause);
    dom.clearBtn.addEventListener("click", () => clearRuntimeData());
    dom.startLoggingBtn.addEventListener("click", startLogging);
    dom.stopLoggingBtn.addEventListener("click", stopLogging);
    dom.addFormulaBtn.addEventListener("click", addFormula);
    dom.clearFormulaBtn.addEventListener("click", clearFormulas);
    dom.formulaExpression.addEventListener("keydown", (event) => {
      if (event.key === "Enter") addFormula();
    });

    for (const control of [dom.channelCount, dom.inputFormat]) {
      control.addEventListener("change", () => {
        applySettingsFromControls();
        clearRuntimeData();
        clearFormulas();
        initPlots();
        setNotice("Channel or input format changed. Data and formulas were cleared.", "warn");
      });
    }

    for (const control of [dom.windowSeconds, dom.expectedSampleRate]) {
      control.addEventListener("change", () => {
        applySettingsFromControls();
        resizePlots();
        updateStatus();
        requestPlotUpdate();
      });
    }

    dom.baudRate.addEventListener("change", () => {
      applySettingsFromControls();
      updateStatus();
    });

    window.addEventListener("resize", debounce(() => {
      resizePlots();
      requestPlotUpdate();
    }, 150));
  }

  async function connectSerial() {
    if (!("serial" in navigator)) {
      setNotice("navigator.serial is undefined. Open this page in Chrome or Edge over HTTPS or localhost.", "error");
      return;
    }

    applySettingsFromControls();

    try {
      setNotice("Select the MCU serial port in the browser prompt.", "warn");
      state.port = await navigator.serial.requestPort();
      await state.port.open({ baudRate: state.baudRate });

      state.connected = true;
      state.keepReading = true;
      state.paused = false;
      updateControls();
      updateStatus();
      setNotice("Connected. Reading CSV lines from the selected local serial port.", "ok");

      readSerialLoop();
    } catch (error) {
      state.port = null;
      state.connected = false;
      state.keepReading = false;
      updateControls();
      updateStatus();
      setNotice(`Could not open serial port. The COM port may be busy or permission was canceled. (${error.message})`, "error");
    }
  }

  async function disconnectSerial() {
    state.keepReading = false;

    try {
      if (state.reader) await state.reader.cancel();
    } catch {
      // Disconnect should continue even if the reader was already released.
    }

    try {
      if (state.port) await state.port.close();
    } catch (error) {
      setNotice(`Serial port close warning: ${error.message}`, "warn");
    } finally {
      state.port = null;
      state.reader = null;
      state.connected = false;
      state.paused = false;
      updateControls();
      updateStatus();
      setNotice("Disconnected.", "ok");
    }
  }

  async function readSerialLoop() {
    const decoder = new TextDecoder();
    let buffer = "";

    while (state.keepReading && state.port && state.port.readable) {
      const reader = state.port.readable.getReader();
      state.reader = reader;

      try {
        while (state.keepReading) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;

          state.byteCount += value.byteLength || value.length || 0;
          state.lastByteTimeMs = Date.now();

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r\n|\n|\r/g);
          buffer = lines.pop() || "";
          state.bufferPreview = buffer.slice(-240);
          state.bufferedChars = buffer.length;

          for (const rawLine of lines) {
            state.rawLineCount += 1;
            state.lastRawLine = rawLine.slice(0, 240);
            handleLine(rawLine);
          }

          updateStatus();
        }
      } catch (error) {
        if (state.keepReading) setNotice(`Serial read error: ${error.message}`, "error");
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // Safe to ignore after cancel().
        }
        if (state.reader === reader) state.reader = null;
      }
    }
  }

  function handleLine(line) {
    if (state.paused) return;

    const parsed = parseCsvLine(line);
    if (!parsed) return;

    const nowPerfSec = performance.now() / 1000;
    const timestampMs = Date.now();
    const sample = {
      tSec: nowPerfSec,
      timestampMs,
      mags: parsed.mags,
      phases: parsed.phases,
    };

    state.samples.push(sample);
    state.latest = sample;
    state.frameCount += 1;
    state.receiveTimes.push(nowPerfSec);
    pruneOldData(nowPerfSec);

    if (state.logging) state.logRows.push(formatCsvRow(sample));

    updateControls();
    updateStatus();
    requestPlotUpdate();
  }

  function parseCsvLine(line) {
    const trimmed = line.trim();
    const expectedCount = getExpectedValueCount();

    if (!trimmed) {
      recordParseError("empty line");
      return null;
    }

    const fields = trimmed.split(",").map((field) => field.trim());
    if (fields.length !== expectedCount) {
      recordParseError(`value count mismatch: got ${fields.length}, expected ${expectedCount}`);
      return null;
    }

    const values = fields.map((field) => Number(field));
    if (!values.every(Number.isFinite)) {
      recordParseError("line contains text, NaN, Infinity, or -Infinity");
      return null;
    }

    const mags = new Array(state.channelCount);
    const phases = new Array(state.channelCount);

    if (state.inputFormat === "grouped") {
      for (let channel = 0; channel < state.channelCount; channel += 1) {
        mags[channel] = values[channel];
        phases[channel] = values[channel + state.channelCount];
      }
    } else {
      for (let channel = 0; channel < state.channelCount; channel += 1) {
        mags[channel] = values[channel * 2];
        phases[channel] = values[channel * 2 + 1];
      }
    }

    return { mags, phases };
  }

  function recordParseError(reason) {
    state.parseErrorCount += 1;
    state.lastInvalidReason = reason;
    updateStatus();
    setNotice(`Invalid serial line skipped: ${reason}.`, "warn");
  }

  function addFormula() {
    const source = dom.formulaSource.value === "phase" ? "phase" : "mag";
    const expression = dom.formulaExpression.value.trim();
    const label = dom.formulaLabel.value.trim() || `${source}:${expression}`;

    try {
      const rpn = compileFormula(expression, state.channelCount);
      state.formulas.push({
        id: state.nextFormulaId,
        source,
        expression,
        label,
        rpn,
        color: formulaColors[(state.nextFormulaId - 1) % formulaColors.length],
      });
      state.nextFormulaId += 1;
      dom.formulaLabel.value = "";
      dom.formulaError.textContent = "";
      renderFormulaList();
      renderFormulaPlot();
      requestPlotUpdate();
    } catch (error) {
      dom.formulaError.textContent = error.message;
    }
  }

  function clearFormulas() {
    state.formulas = [];
    dom.formulaError.textContent = "";
    renderFormulaList();
    renderFormulaPlot();
    requestPlotUpdate();
  }

  function removeFormula(id) {
    state.formulas = state.formulas.filter((formula) => formula.id !== id);
    renderFormulaList();
    renderFormulaPlot();
    requestPlotUpdate();
  }

  function renderFormulaList() {
    dom.formulaList.textContent = "";

    for (const formula of state.formulas) {
      const chip = document.createElement("span");
      chip.className = "formula-chip";

      const text = document.createElement("span");
      text.textContent = `${formula.label} = ${formula.expression}`;

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "x";
      button.addEventListener("click", () => removeFormula(formula.id));

      chip.append(text, button);
      dom.formulaList.appendChild(chip);
    }
  }

  function startLogging() {
    state.logging = true;
    state.logRows = [buildCsvHeader()];
    updateControls();
    updateStatus();
    setNotice("Logging started. Stop logging to download a CSV file.", "ok");
  }

  function stopLogging() {
    if (!state.logging) return;

    state.logging = false;
    const content = state.logRows.join("\n") + "\n";
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bioimpedance-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    updateControls();
    updateStatus();
    setNotice("Logging stopped. CSV download was triggered by the browser.", "ok");
  }

  function buildCsvHeader() {
    const columns = ["timestamp_ms"];
    for (let channel = 1; channel <= state.channelCount; channel += 1) {
      columns.push(`ch${channel}_mag`, `ch${channel}_phase`);
    }
    return columns.join(",");
  }

  function formatCsvRow(sample) {
    const values = [sample.timestampMs];
    for (let channel = 0; channel < state.channelCount; channel += 1) {
      values.push(sample.mags[channel], sample.phases[channel]);
    }
    return values.join(",");
  }

  function clearRuntimeData() {
    state.samples = [];
    state.receiveTimes = [];
    state.latest = null;
    state.frameCount = 0;
    state.byteCount = 0;
    state.rawLineCount = 0;
    state.bufferedChars = 0;
    state.parseErrorCount = 0;
    state.lastByteTimeMs = null;
    state.lastRawLine = "";
    state.bufferPreview = "";
    state.lastInvalidReason = "";
    updateControls();
    updateStatus();
    requestPlotUpdate();
  }

  function togglePause() {
    state.paused = !state.paused;
    updateControls();
    updateStatus();
    setNotice(
      state.paused
        ? "Paused. Serial bytes are drained, but incoming frames are not plotted or logged."
        : "Resumed.",
      state.paused ? "warn" : "ok"
    );
  }

  function applySettingsFromControls() {
    state.baudRate = readNumber(dom.baudRate.value, 115200, 1, 4000000);
    state.channelCount = Math.round(readNumber(dom.channelCount.value, 12, 1, 128));
    state.inputFormat = dom.inputFormat.value === "grouped" ? "grouped" : "interleaved";
    state.windowSeconds = readNumber(dom.windowSeconds.value, 10, 1, 600);
    state.expectedSampleRate = readNumber(dom.expectedSampleRate.value, 5, 0.1, 1000);

    dom.channelCount.value = state.channelCount;
    dom.windowSeconds.value = state.windowSeconds;
    dom.expectedSampleRate.value = state.expectedSampleRate;
  }

  function readNumber(raw, fallback, min, max) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }

  function pruneOldData(nowSec) {
    const oldest = nowSec - Math.max(state.windowSeconds * 1.25, state.windowSeconds + 2);
    while (state.samples.length && state.samples[0].tSec < oldest) state.samples.shift();

    const rateWindowStart = nowSec - 5;
    while (state.receiveTimes.length && state.receiveTimes[0] < rateWindowStart) state.receiveTimes.shift();
  }

  function initPlots() {
    destroyPlots();

    if (!window.uPlot) {
      dom.magnitudePlot.innerHTML = "<div class=\"plot-empty\">uPlot CDN was not loaded. Check your network connection.</div>";
      dom.phasePlot.innerHTML = "<div class=\"plot-empty\">uPlot CDN was not loaded. Check your network connection.</div>";
      dom.formulaPlot.innerHTML = "<div class=\"plot-empty\">uPlot CDN was not loaded. Check your network connection.</div>";
      return;
    }

    state.magnitudePlot = createChannelPlot(dom.magnitudePlot, "mag");
    state.phasePlot = createChannelPlot(dom.phasePlot, "phase");
    renderFormulaPlot();
    requestPlotUpdate();
  }

  function destroyPlots() {
    if (state.magnitudePlot) state.magnitudePlot.destroy();
    if (state.phasePlot) state.phasePlot.destroy();
    if (state.formulaPlot) state.formulaPlot.destroy();
    state.magnitudePlot = null;
    state.phasePlot = null;
    state.formulaPlot = null;
    dom.magnitudePlot.textContent = "";
    dom.phasePlot.textContent = "";
    dom.formulaPlot.textContent = "";
  }

  function createChannelPlot(container, kind) {
    const size = getPlotSize(container);
    const suffix = kind === "mag" ? "mag" : "phase";
    const unit = kind === "mag" ? "magnitude" : "phase";
    const series = [{ label: "seconds" }];

    for (let channel = 1; channel <= state.channelCount; channel += 1) {
      series.push({
        label: `ch${channel}_${suffix}`,
        stroke: colors[(channel - 1) % colors.length],
        width: 1.8,
        points: { show: false },
      });
    }

    return new uPlot(makePlotOptions(size, unit, series), buildChannelData(kind), container);
  }

  function renderFormulaPlot() {
    if (state.formulaPlot) state.formulaPlot.destroy();
    state.formulaPlot = null;
    dom.formulaPlot.textContent = "";

    if (!window.uPlot) return;

    if (state.formulas.length === 0) {
      dom.formulaPlot.innerHTML = "<div class=\"plot-empty\">Add a formula such as ch1 - ch2 to plot a derived trace.</div>";
      return;
    }

    const size = getPlotSize(dom.formulaPlot, 300);
    const series = [{ label: "seconds" }];
    for (const formula of state.formulas) {
      series.push({
        label: formula.label,
        stroke: formula.color,
        width: 2.2,
        points: { show: false },
      });
    }

    state.formulaPlot = new uPlot(makePlotOptions(size, "formula", series), buildFormulaData(), dom.formulaPlot);
  }

  function makePlotOptions(size, unit, series) {
    return {
      width: size.width,
      height: size.height,
      legend: { show: true },
      cursor: { drag: { x: true, y: false } },
      scales: {
        x: { time: false, min: -state.windowSeconds, max: 0 },
        y: { auto: true },
      },
      axes: [
        {
          label: "seconds ago",
          values: (_u, values) => values.map((value) => value.toFixed(1)),
        },
        {
          label: unit,
          values: (_u, values) => values.map(formatAxisNumber),
        },
      ],
      series,
    };
  }

  function plotLoop(nowMs) {
    const maxPlotHz = 15;
    const intervalMs = 1000 / maxPlotHz;
    const shouldUpdateSlidingWindow = state.samples.length > 0 && !state.paused;

    if ((state.needsPlotUpdate || shouldUpdateSlidingWindow) && nowMs - state.lastPlotUpdateMs >= intervalMs) {
      updatePlots();
      state.needsPlotUpdate = false;
      state.lastPlotUpdateMs = nowMs;
    }

    requestAnimationFrame(plotLoop);
  }

  function updatePlots() {
    if (!state.magnitudePlot || !state.phasePlot) return;

    const nowSec = performance.now() / 1000;
    pruneOldData(nowSec);

    state.magnitudePlot.setData(buildChannelData("mag", nowSec));
    state.phasePlot.setData(buildChannelData("phase", nowSec));
    state.magnitudePlot.setScale("x", { min: -state.windowSeconds, max: 0 });
    state.phasePlot.setScale("x", { min: -state.windowSeconds, max: 0 });

    if (state.formulaPlot) {
      state.formulaPlot.setData(buildFormulaData(nowSec));
      state.formulaPlot.setScale("x", { min: -state.windowSeconds, max: 0 });
    }
  }

  function buildChannelData(kind, nowSec = performance.now() / 1000) {
    const visible = getVisibleSamples(nowSec);
    const x = visible.map((sample) => sample.tSec - nowSec);
    const data = [x];

    for (let channel = 0; channel < state.channelCount; channel += 1) {
      data.push(visible.map((sample) => (kind === "mag" ? sample.mags[channel] : sample.phases[channel])));
    }

    return data;
  }

  function buildFormulaData(nowSec = performance.now() / 1000) {
    const visible = getVisibleSamples(nowSec);
    const x = visible.map((sample) => sample.tSec - nowSec);
    const data = [x];

    for (const formula of state.formulas) {
      data.push(visible.map((sample) => {
        const values = formula.source === "phase" ? sample.phases : sample.mags;
        const value = evaluateFormula(formula.rpn, values);
        return Number.isFinite(value) ? value : null;
      }));
    }

    return data;
  }

  function getVisibleSamples(nowSec) {
    return state.samples.filter((sample) => nowSec - sample.tSec <= state.windowSeconds);
  }

  function resizePlots() {
    if (state.magnitudePlot) state.magnitudePlot.setSize(getPlotSize(dom.magnitudePlot));
    if (state.phasePlot) state.phasePlot.setSize(getPlotSize(dom.phasePlot));
    if (state.formulaPlot) state.formulaPlot.setSize(getPlotSize(dom.formulaPlot, 300));
  }

  function getPlotSize(container, fallbackHeight = 330) {
    const rect = container.getBoundingClientRect();
    return {
      width: Math.max(320, Math.floor(rect.width - 20)),
      height: Math.max(260, Math.min(390, Math.floor(rect.height || fallbackHeight))),
    };
  }

  function requestPlotUpdate() {
    state.needsPlotUpdate = true;
  }

  function compileFormula(expression, channelCount) {
    const tokens = tokenizeFormula(expression, channelCount);
    return toRpn(tokens);
  }

  function tokenizeFormula(expression, channelCount) {
    const input = expression.replace(/\s+/g, "");
    if (!input) throw new Error("Formula is empty.");

    const tokens = [];
    let index = 0;
    let previous = "start";

    while (index < input.length) {
      const rest = input.slice(index);
      const channelMatch = /^ch(\d+)/i.exec(rest);
      const numberMatch = /^(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i.exec(rest);
      const char = input[index];

      if (channelMatch) {
        ensureCanReadValue(previous);
        const channel = Number(channelMatch[1]);
        if (channel < 1 || channel > channelCount) {
          throw new Error(`ch${channel} is outside the current channel count (${channelCount}).`);
        }
        tokens.push({ type: "channel", index: channel - 1 });
        index += channelMatch[0].length;
        previous = "value";
        continue;
      }

      if (numberMatch) {
        ensureCanReadValue(previous);
        tokens.push({ type: "number", value: Number(numberMatch[0]) });
        index += numberMatch[0].length;
        previous = "value";
        continue;
      }

      if (char === "(") {
        ensureCanReadValue(previous);
        tokens.push({ type: "leftParen" });
        index += 1;
        previous = "leftParen";
        continue;
      }

      if (char === ")") {
        if (previous !== "value" && previous !== "rightParen") throw new Error("Unexpected closing parenthesis.");
        tokens.push({ type: "rightParen" });
        index += 1;
        previous = "rightParen";
        continue;
      }

      if ("+-*/".includes(char)) {
        let operator = char;
        if (char === "-" && (previous === "start" || previous === "operator" || previous === "leftParen")) {
          operator = "neg";
        } else if (previous !== "value" && previous !== "rightParen") {
          throw new Error(`Operator '${char}' needs a value before it.`);
        }
        tokens.push({ type: "operator", value: operator });
        index += 1;
        previous = "operator";
        continue;
      }

      throw new Error(`Unsupported token near '${rest.slice(0, 12)}'. Use ch1, numbers, parentheses, +, -, *, /.`);
    }

    if (previous === "operator" || previous === "leftParen") throw new Error("Formula is incomplete.");
    return tokens;
  }

  function ensureCanReadValue(previous) {
    if (previous === "value" || previous === "rightParen") {
      throw new Error("Missing operator between values.");
    }
  }

  function toRpn(tokens) {
    const output = [];
    const operators = [];

    for (const token of tokens) {
      if (token.type === "number" || token.type === "channel") {
        output.push(token);
        continue;
      }

      if (token.type === "operator") {
        const currentPrecedence = precedence(token.value);
        const currentRightAssoc = token.value === "neg";
        while (operators.length) {
          const top = operators[operators.length - 1];
          if (top.type !== "operator") break;
          const topPrecedence = precedence(top.value);
          if (
            (!currentRightAssoc && currentPrecedence <= topPrecedence)
            || (currentRightAssoc && currentPrecedence < topPrecedence)
          ) {
            output.push(operators.pop());
          } else {
            break;
          }
        }
        operators.push(token);
        continue;
      }

      if (token.type === "leftParen") {
        operators.push(token);
        continue;
      }

      if (token.type === "rightParen") {
        let foundLeftParen = false;
        while (operators.length) {
          const top = operators.pop();
          if (top.type === "leftParen") {
            foundLeftParen = true;
            break;
          }
          output.push(top);
        }
        if (!foundLeftParen) throw new Error("Unmatched closing parenthesis.");
      }
    }

    while (operators.length) {
      const top = operators.pop();
      if (top.type === "leftParen") throw new Error("Unmatched opening parenthesis.");
      output.push(top);
    }

    return output;
  }

  function precedence(operator) {
    if (operator === "neg") return 3;
    if (operator === "*" || operator === "/") return 2;
    return 1;
  }

  function evaluateFormula(rpn, values) {
    const stack = [];

    for (const token of rpn) {
      if (token.type === "number") {
        stack.push(token.value);
      } else if (token.type === "channel") {
        stack.push(values[token.index]);
      } else if (token.value === "neg") {
        const value = stack.pop();
        stack.push(-value);
      } else {
        const right = stack.pop();
        const left = stack.pop();
        if (token.value === "+") stack.push(left + right);
        if (token.value === "-") stack.push(left - right);
        if (token.value === "*") stack.push(left * right);
        if (token.value === "/") stack.push(left / right);
      }
    }

    return stack.length === 1 ? stack[0] : NaN;
  }

  function updateControls() {
    const serialSupported = "serial" in navigator;
    dom.connectBtn.disabled = !serialSupported || state.connected;
    dom.disconnectBtn.disabled = !state.connected;
    dom.pauseBtn.disabled = !state.connected;
    dom.pauseBtn.textContent = state.paused ? "Resume" : "Pause";
    dom.startLoggingBtn.disabled = state.logging;
    dom.stopLoggingBtn.disabled = !state.logging;
    dom.baudRate.disabled = state.connected;
  }

  function updateStatus() {
    const rateHz = calculateActualRate();
    const connectedLabel = state.connected ? (state.paused ? "Paused" : "Connected") : "Disconnected";

    dom.connectionStatus.textContent = connectedLabel;
    dom.statusDot.classList.toggle("connected", state.connected && !state.paused);
    dom.statusDot.classList.toggle("paused", state.connected && state.paused);
    dom.selectedBaud.textContent = String(state.baudRate);
    dom.frameCount.textContent = String(state.frameCount);
    dom.byteCount.textContent = String(state.byteCount);
    dom.rawLineCount.textContent = String(state.rawLineCount);
    dom.bufferedChars.textContent = String(state.bufferedChars);
    dom.parseErrorCount.textContent = String(state.parseErrorCount);
    dom.actualRate.textContent = `${rateHz.toFixed(2)} Hz`;
    dom.expectedValues.textContent = String(getExpectedValueCount());
    dom.lastValidTime.textContent = state.latest ? formatClockTime(state.latest.timestampMs) : "-";
    dom.lastByteTime.textContent = state.lastByteTimeMs ? formatClockTime(state.lastByteTimeMs) : "-";
    dom.loggingStatus.textContent = state.logging ? `${Math.max(0, state.logRows.length - 1)} rows` : "Stopped";
    dom.lastRawLine.textContent = state.lastRawLine || "(none)";
    dom.bufferPreview.textContent = state.bufferPreview || "(empty)";
    dom.lastInvalidReason.textContent = state.lastInvalidReason || "(none)";
  }

  function refreshRuntimeStatus() {
    pruneOldData(performance.now() / 1000);
    updateStatus();
    if (state.samples.length > 0 && !state.paused) requestPlotUpdate();
  }

  function calculateActualRate() {
    if (state.receiveTimes.length < 2) return 0;
    const first = state.receiveTimes[0];
    const last = state.receiveTimes[state.receiveTimes.length - 1];
    const elapsed = last - first;
    if (elapsed <= 0) return 0;
    return (state.receiveTimes.length - 1) / elapsed;
  }

  function getExpectedValueCount() {
    return state.channelCount * 2;
  }

  function setNotice(message, type = "ok") {
    dom.notice.textContent = message;
    dom.notice.classList.toggle("warn", type === "warn");
    dom.notice.classList.toggle("error", type === "error");
  }

  function formatClockTime(timestampMs) {
    return new Date(timestampMs).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function formatAxisNumber(value) {
    if (!Number.isFinite(value)) return "";
    if (Math.abs(value) >= 1000 || (Math.abs(value) < 0.01 && value !== 0)) return value.toExponential(2);
    return Number(value.toFixed(3)).toString();
  }

  function debounce(fn, delayMs) {
    let timer = null;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn(...args), delayMs);
    };
  }
})();
