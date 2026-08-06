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
    startStopwatchBtn: $("startStopwatchBtn"),
    stopStopwatchBtn: $("stopStopwatchBtn"),
    resetStopwatchBtn: $("resetStopwatchBtn"),
    baudRate: $("baudRate"),
    channelCount: $("channelCount"),
    inputFormat: $("inputFormat"),
    outputMode: $("outputMode"),
    csvFilename: $("csvFilename"),
    windowSeconds: $("windowSeconds"),
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
    elapsedTime: $("elapsedTime"),
    lastRawLine: $("lastRawLine"),
    bufferPreview: $("bufferPreview"),
    lastInvalidReason: $("lastInvalidReason"),
    magnitudePlot: $("magnitudePlot"),
    phasePlot: $("phasePlot"),
    profileMagnitudePlot: $("profileMagnitudePlot"),
    profilePhasePlot: $("profilePhasePlot"),
    magnitudeAllChannels: $("magnitudeAllChannels"),
    phaseAllChannels: $("phaseAllChannels"),
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
    channelCount: null,
    inputFormat: "interleaved",
    outputMode: "both",
    windowSeconds: 10,
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
    logFilename: "",
    stopwatchRunning: false,
    stopwatchStartedAtMs: null,
    stopwatchElapsedMs: 0,
    logRows: [],
    magnitudePlot: null,
    phasePlot: null,
    profileMagnitudePlot: null,
    profilePhasePlot: null,
    formulaPlot: null,
    formulas: [],
    nextFormulaId: 1,
    channelVisibility: {
      mag: true,
      phase: true,
    },
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
    window.setInterval(refreshRuntimeStatus, 100);
    requestAnimationFrame(plotLoop);

    if (!("serial" in navigator)) {
      setNotice("Web Serial is not available. Use a recent Chrome or Edge browser over HTTPS or localhost.", "error");
      dom.serialSupport.textContent = "Not available";
    } else {
      dom.serialSupport.textContent = "Available";
      if (!hasChannelCount()) setNotice("Set Channel count before connecting.", "warn");
    }
  }

  function bindEvents() {
    dom.connectBtn.addEventListener("click", connectSerial);
    dom.disconnectBtn.addEventListener("click", disconnectSerial);
    dom.pauseBtn.addEventListener("click", togglePause);
    dom.clearBtn.addEventListener("click", () => clearRuntimeData());
    dom.startLoggingBtn.addEventListener("click", startLogging);
    dom.stopLoggingBtn.addEventListener("click", stopLogging);
    dom.startStopwatchBtn.addEventListener("click", startStopwatch);
    dom.stopStopwatchBtn.addEventListener("click", stopStopwatch);
    dom.resetStopwatchBtn.addEventListener("click", resetStopwatch);
    dom.addFormulaBtn.addEventListener("click", addFormula);
    dom.clearFormulaBtn.addEventListener("click", clearFormulas);
    dom.magnitudeAllChannels.addEventListener("change", () => toggleAllChannels("mag", dom.magnitudeAllChannels.checked));
    dom.phaseAllChannels.addEventListener("change", () => toggleAllChannels("phase", dom.phaseAllChannels.checked));
    dom.formulaExpression.addEventListener("keydown", (event) => {
      if (event.key === "Enter") addFormula();
    });

    for (const control of [dom.channelCount, dom.inputFormat, dom.outputMode]) {
      control.addEventListener("change", () => {
        applySettingsFromControls();
        clearRuntimeData();
        clearFormulas();
        setAllChannelsChecked(true);
        initPlots();
        syncFormulaSourceControls();
        setNotice(
          hasChannelCount()
            ? "Channel, input format, or output mode changed. Data and formulas were cleared."
            : "Set Channel count before connecting.",
          "warn"
        );
      });
    }

    for (const control of [dom.windowSeconds]) {
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
    if (!hasChannelCount()) {
      setNotice("Set Channel count before connecting.", "warn");
      updateControls();
      updateStatus();
      return;
    }

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

    if (expectedCount === null) {
      recordParseError("channel count is not set");
      return null;
    }

    if (!trimmed) {
      recordParseError("empty line");
      return null;
    }

    const fields = trimmed.split(",").map((field) => field.trim());
    if (fields.length !== expectedCount) {
      recordParseError(`value count mismatch: got ${fields.length}, expected ${expectedCount}`);
      return null;
    }

    if (fields.some((field) => field === "")) {
      recordParseError("line contains an empty value");
      return null;
    }

    const values = fields.map((field) => Number(field));
    if (!values.every(Number.isFinite)) {
      recordParseError("line contains text, NaN, Infinity, or -Infinity");
      return null;
    }

    const mags = new Array(state.channelCount).fill(null);
    const phases = new Array(state.channelCount).fill(null);

    if (state.outputMode === "mag") {
      for (let channel = 0; channel < state.channelCount; channel += 1) {
        mags[channel] = values[channel];
      }
      return { mags, phases };
    }

    if (state.outputMode === "phase") {
      for (let channel = 0; channel < state.channelCount; channel += 1) {
        phases[channel] = values[channel];
      }
      return { mags, phases };
    }

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
    if (!hasChannelCount()) {
      dom.formulaError.textContent = "Set Channel count before adding a formula.";
      return;
    }

    const source = dom.formulaSource.value === "phase" ? "phase" : "mag";
    if (!isSourceAvailable(source)) {
      dom.formulaError.textContent = source === "phase"
        ? "Phase data is not included in the current output mode."
        : "Magnitude data is not included in the current output mode.";
      return;
    }

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
    if (!hasChannelCount()) {
      setNotice("Set Channel count before logging.", "warn");
      updateControls();
      return;
    }

    state.logFilename = buildCsvFilename("bioimpedance");
    dom.csvFilename.value = state.logFilename;
    state.logging = true;
    state.logRows = [buildCsvHeader()];
    updateControls();
    updateStatus();
    setNotice("Logging started. Stop logging to save a CSV file.", "ok");
  }

  async function stopLogging() {
    if (!state.logging) return;

    state.logging = false;
    const content = state.logRows.join("\n") + "\n";
    const fileName = state.logFilename || buildCsvFilename("bioimpedance");
    updateControls();
    updateStatus();
    const saveResult = await saveCsvContent(content, fileName);

    updateControls();
    updateStatus();
    setNotice(
      saveResult === "saved"
        ? `Logging stopped. CSV saved as ${fileName}.`
        : `Logging stopped. CSV download started as ${fileName}.`,
      "ok"
    );
  }

  function startStopwatch() {
    if (state.stopwatchRunning) return;
    state.stopwatchStartedAtMs = performance.now();
    state.stopwatchRunning = true;
    updateControls();
    updateStatus();
    setNotice("Stopwatch started.", "ok");
  }

  function stopStopwatch() {
    if (!state.stopwatchRunning) return;
    state.stopwatchElapsedMs = getStopwatchElapsedMs();
    state.stopwatchStartedAtMs = null;
    state.stopwatchRunning = false;
    updateControls();
    updateStatus();
    setNotice("Stopwatch stopped.", "ok");
  }

  function resetStopwatch() {
    state.stopwatchElapsedMs = 0;
    state.stopwatchStartedAtMs = state.stopwatchRunning ? performance.now() : null;
    updateControls();
    updateStatus();
    setNotice("Stopwatch reset.", "ok");
  }

  function buildCsvHeader() {
    const columns = ["timestamp_ms"];
    for (let channel = 1; channel <= state.channelCount; channel += 1) {
      if (hasMagnitude()) columns.push(`ch${channel}_mag`);
      if (hasPhase()) columns.push(`ch${channel}_phase`);
    }
    return columns.join(",");
  }

  function formatCsvRow(sample) {
    const values = [sample.timestampMs];
    for (let channel = 0; channel < state.channelCount; channel += 1) {
      if (hasMagnitude()) values.push(sample.mags[channel]);
      if (hasPhase()) values.push(sample.phases[channel]);
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
    state.channelCount = readOptionalInteger(dom.channelCount.value, 1, 168);
    state.inputFormat = dom.inputFormat.value === "grouped" ? "grouped" : "interleaved";
    state.outputMode = ["both", "mag", "phase"].includes(dom.outputMode.value) ? dom.outputMode.value : "both";
    state.windowSeconds = readNumber(dom.windowSeconds.value, 10, 1, 600);

    dom.channelCount.value = state.channelCount === null ? "" : String(state.channelCount);
    dom.inputFormat.disabled = state.connected || state.outputMode !== "both";
    dom.windowSeconds.value = state.windowSeconds;
  }

  function readNumber(raw, fallback, min, max) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }

  function readOptionalInteger(raw, min, max) {
    if (String(raw).trim() === "") return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return Math.round(Math.min(max, Math.max(min, value)));
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
      dom.profileMagnitudePlot.innerHTML = "<div class=\"plot-empty\">uPlot CDN was not loaded. Check your network connection.</div>";
      dom.profilePhasePlot.innerHTML = "<div class=\"plot-empty\">uPlot CDN was not loaded. Check your network connection.</div>";
      dom.formulaPlot.innerHTML = "<div class=\"plot-empty\">uPlot CDN was not loaded. Check your network connection.</div>";
      updateAllChannelsControls();
      return;
    }

    if (!hasChannelCount()) {
      dom.magnitudePlot.innerHTML = "<div class=\"plot-empty\">Set Channel count to create channel traces.</div>";
      dom.phasePlot.innerHTML = "<div class=\"plot-empty\">Set Channel count to create channel traces.</div>";
      dom.profileMagnitudePlot.innerHTML = "<div class=\"plot-empty\">Set Channel count to create the channel profile.</div>";
      dom.profilePhasePlot.innerHTML = "<div class=\"plot-empty\">Set Channel count to create the channel profile.</div>";
      dom.formulaPlot.innerHTML = "<div class=\"plot-empty\">Set Channel count before adding formulas.</div>";
      updateAllChannelsControls();
      return;
    }

    if (hasMagnitude()) {
      state.magnitudePlot = createChannelPlot(dom.magnitudePlot, "mag");
      state.profileMagnitudePlot = createProfilePlot(dom.profileMagnitudePlot, "mag");
    } else {
      dom.magnitudePlot.innerHTML = "<div class=\"plot-empty\">Magnitude data is not included in the current output mode.</div>";
      dom.profileMagnitudePlot.innerHTML = "<div class=\"plot-empty\">Magnitude data is not included in the current output mode.</div>";
    }

    if (hasPhase()) {
      state.phasePlot = createChannelPlot(dom.phasePlot, "phase");
      state.profilePhasePlot = createProfilePlot(dom.profilePhasePlot, "phase");
    } else {
      dom.phasePlot.innerHTML = "<div class=\"plot-empty\">Phase data is not included in the current output mode.</div>";
      dom.profilePhasePlot.innerHTML = "<div class=\"plot-empty\">Phase data is not included in the current output mode.</div>";
    }

    renderFormulaPlot();
    applyAllChannelsVisibility();
    updateAllChannelsControls();
    requestPlotUpdate();
  }

  function destroyPlots() {
    if (state.magnitudePlot) state.magnitudePlot.destroy();
    if (state.phasePlot) state.phasePlot.destroy();
    if (state.profileMagnitudePlot) state.profileMagnitudePlot.destroy();
    if (state.profilePhasePlot) state.profilePhasePlot.destroy();
    if (state.formulaPlot) state.formulaPlot.destroy();
    state.magnitudePlot = null;
    state.phasePlot = null;
    state.profileMagnitudePlot = null;
    state.profilePhasePlot = null;
    state.formulaPlot = null;
    dom.magnitudePlot.textContent = "";
    dom.phasePlot.textContent = "";
    dom.profileMagnitudePlot.textContent = "";
    dom.profilePhasePlot.textContent = "";
    dom.formulaPlot.textContent = "";
    updateAllChannelsControls();
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

  function createProfilePlot(container, kind) {
    const size = getPlotSize(container);
    const isMagnitude = kind === "mag";
    const series = [
      { label: "channel" },
      {
        label: isMagnitude ? "magnitude" : "phase",
        stroke: isMagnitude ? "#0f6b57" : "#2563eb",
        width: 2.4,
        points: { show: true, size: 6, width: 1.5 },
      },
    ];

    return new uPlot(makeProfilePlotOptions(size, isMagnitude ? "magnitude" : "phase", series), buildProfileData(kind), container);
  }

  function renderFormulaPlot() {
    if (state.formulaPlot) state.formulaPlot.destroy();
    state.formulaPlot = null;
    dom.formulaPlot.textContent = "";

    if (!window.uPlot) return;

    if (!hasChannelCount()) {
      dom.formulaPlot.innerHTML = "<div class=\"plot-empty\">Set Channel count before adding formulas.</div>";
      return;
    }

    if (!hasMagnitude() && !hasPhase()) {
      dom.formulaPlot.innerHTML = "<div class=\"plot-empty\">Select an output mode with data before adding formulas.</div>";
      return;
    }

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

  function makeProfilePlotOptions(size, unit, series) {
    return {
      width: size.width,
      height: size.height,
      legend: { show: true },
      cursor: { drag: { x: false, y: false } },
      scales: {
        x: { time: false, min: 0.5, max: state.channelCount + 0.5 },
        y: { auto: true },
      },
      axes: [
        {
          label: "channel",
          values: (_u, values) => values.map(formatChannelTick),
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
    if (!hasChannelCount()) return;

    const nowSec = performance.now() / 1000;
    pruneOldData(nowSec);

    if (state.magnitudePlot) {
      state.magnitudePlot.setData(buildChannelData("mag", nowSec));
      state.magnitudePlot.setScale("x", { min: -state.windowSeconds, max: 0 });
    }

    if (state.phasePlot) {
      state.phasePlot.setData(buildChannelData("phase", nowSec));
      state.phasePlot.setScale("x", { min: -state.windowSeconds, max: 0 });
    }

    if (state.profileMagnitudePlot) {
      state.profileMagnitudePlot.setData(buildProfileData("mag"));
      state.profileMagnitudePlot.setScale("x", { min: 0.5, max: state.channelCount + 0.5 });
    }

    if (state.profilePhasePlot) {
      state.profilePhasePlot.setData(buildProfileData("phase"));
      state.profilePhasePlot.setScale("x", { min: 0.5, max: state.channelCount + 0.5 });
    }

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

  function buildProfileData(kind) {
    if (!hasChannelCount()) return [[], []];
    const channels = Array.from({ length: state.channelCount }, (_value, index) => index + 1);
    const values = state.latest
      ? (kind === "mag" ? state.latest.mags : state.latest.phases)
      : Array.from({ length: state.channelCount }, () => null);
    return [channels, values];
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
    if (state.profileMagnitudePlot) state.profileMagnitudePlot.setSize(getPlotSize(dom.profileMagnitudePlot));
    if (state.profilePhasePlot) state.profilePhasePlot.setSize(getPlotSize(dom.profilePhasePlot));
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

  function setAllChannelsChecked(checked) {
    dom.magnitudeAllChannels.checked = checked;
    dom.phaseAllChannels.checked = checked;
    state.channelVisibility.mag = checked;
    state.channelVisibility.phase = checked;
  }

  function toggleAllChannels(kind, visible) {
    state.channelVisibility[kind] = visible;
    const plot = kind === "mag" ? state.magnitudePlot : state.phasePlot;
    setPlotChannelsVisible(plot, visible);
  }

  function applyAllChannelsVisibility() {
    setPlotChannelsVisible(state.magnitudePlot, state.channelVisibility.mag);
    setPlotChannelsVisible(state.phasePlot, state.channelVisibility.phase);
  }

  function setPlotChannelsVisible(plot, visible) {
    if (!plot || !hasChannelCount()) return;
    for (let seriesIndex = 1; seriesIndex < plot.series.length; seriesIndex += 1) {
      plot.setSeries(seriesIndex, { show: visible });
    }
  }

  function updateAllChannelsControls() {
    dom.magnitudeAllChannels.disabled = !(hasChannelCount() && !!state.magnitudePlot && hasMagnitude());
    dom.phaseAllChannels.disabled = !(hasChannelCount() && !!state.phasePlot && hasPhase());
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
    const channelReady = hasChannelCount();
    dom.connectBtn.disabled = !serialSupported || state.connected || !channelReady;
    dom.disconnectBtn.disabled = !state.connected;
    dom.pauseBtn.disabled = !state.connected;
    dom.pauseBtn.textContent = state.paused ? "Resume" : "Pause";
    dom.startLoggingBtn.disabled = state.logging || !channelReady;
    dom.stopLoggingBtn.disabled = !state.logging;
    dom.startStopwatchBtn.disabled = state.stopwatchRunning;
    dom.stopStopwatchBtn.disabled = !state.stopwatchRunning;
    dom.resetStopwatchBtn.disabled = !state.stopwatchRunning && state.stopwatchElapsedMs === 0;
    dom.baudRate.disabled = state.connected;
    dom.inputFormat.disabled = state.connected || state.outputMode !== "both";
    dom.outputMode.disabled = state.connected;
    dom.csvFilename.disabled = state.logging;
    dom.addFormulaBtn.disabled = !channelReady;
    syncFormulaSourceControls();
    updateAllChannelsControls();
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
    const expectedValueCount = getExpectedValueCount();
    dom.expectedValues.textContent = expectedValueCount === null ? "-" : String(expectedValueCount);
    dom.lastValidTime.textContent = state.latest ? formatClockTime(state.latest.timestampMs) : "-";
    dom.lastByteTime.textContent = state.lastByteTimeMs ? formatClockTime(state.lastByteTimeMs) : "-";
    dom.loggingStatus.textContent = state.logging ? `${Math.max(0, state.logRows.length - 1)} rows` : "Stopped";
    dom.elapsedTime.textContent = formatElapsedTime(getStopwatchElapsedMs());
    dom.elapsedTime.classList.toggle("running", state.stopwatchRunning);
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
    if (!hasChannelCount()) return null;
    return state.channelCount * getValuesPerChannel();
  }

  function hasChannelCount() {
    return Number.isInteger(state.channelCount) && state.channelCount >= 1;
  }

  function getValuesPerChannel() {
    return state.outputMode === "both" ? 2 : 1;
  }

  function hasMagnitude() {
    return state.outputMode === "both" || state.outputMode === "mag";
  }

  function hasPhase() {
    return state.outputMode === "both" || state.outputMode === "phase";
  }

  function isSourceAvailable(source) {
    return source === "phase" ? hasPhase() : hasMagnitude();
  }

  function syncFormulaSourceControls() {
    const magnitudeOption = dom.formulaSource.querySelector("option[value=\"mag\"]");
    const phaseOption = dom.formulaSource.querySelector("option[value=\"phase\"]");
    if (magnitudeOption) magnitudeOption.disabled = !hasMagnitude();
    if (phaseOption) phaseOption.disabled = !hasPhase();

    if (!isSourceAvailable(dom.formulaSource.value)) {
      dom.formulaSource.value = hasMagnitude() ? "mag" : "phase";
    }
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

  function formatChannelTick(value) {
    return Number.isInteger(value) ? String(value) : "";
  }

  function getStopwatchElapsedMs() {
    if (state.stopwatchRunning && state.stopwatchStartedAtMs !== null) {
      return state.stopwatchElapsedMs + performance.now() - state.stopwatchStartedAtMs;
    }
    return state.stopwatchElapsedMs;
  }

  function formatElapsedTime(elapsedMs) {
    const totalSeconds = Math.max(0, elapsedMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const secondsText = seconds.toFixed(1).padStart(4, "0");
    const minutesText = String(minutes).padStart(2, "0");
    return hours > 0 ? `${hours}:${minutesText}:${secondsText}` : `${minutesText}:${secondsText}`;
  }

  function buildCsvFilename(defaultPrefix) {
    const rawName = sanitizeFilename(dom.csvFilename.value);
    const baseName = rawName.replace(/\.csv$/i, "") || `${defaultPrefix}-${formatTimestampForFilename(new Date())}`;
    return `${baseName}.csv`;
  }

  function sanitizeFilename(filename) {
    return String(filename)
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "")
      .slice(0, 120);
  }

  function formatTimestampForFilename(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
      "-",
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds()),
    ].join("");
  }

  async function saveCsvContent(content, fileName) {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });

    if ("showSaveFilePicker" in window) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: "CSV file", accept: { "text/csv": [".csv"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return "saved";
      } catch (error) {
        if (error && error.name !== "AbortError") console.error(error);
      }
    }

    downloadCsvBlob(blob, fileName);
    return "downloaded";
  }

  function downloadCsvBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  function formatAxisNumber(value) {
    if (!Number.isFinite(value)) return "";
    const abs = Math.abs(value);
    if (abs >= 100) return Math.round(value).toString();
    if (abs >= 1) return Number(value.toFixed(2)).toString();
    if (value === 0) return "0";
    return Number(value.toFixed(4)).toString();
  }

  function debounce(fn, delayMs) {
    let timer = null;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn(...args), delayMs);
    };
  }
})();
