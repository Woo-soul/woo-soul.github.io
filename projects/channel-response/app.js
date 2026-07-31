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
    outputMode: $("outputMode"),
    csvFilename: $("csvFilename"),
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
    elapsedTime: $("elapsedTime"),
    lastRawLine: $("lastRawLine"),
    bufferPreview: $("bufferPreview"),
    lastInvalidReason: $("lastInvalidReason"),
    magnitudePlot: $("magnitudePlot"),
    phasePlot: $("phasePlot"),
  };

  const colors = {
    magnitude: "#0f6b57",
    phase: "#2563eb",
  };

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
    latest: null,
    receiveTimes: [],
    logging: false,
    logFilename: "",
    loggingStartedAtMs: null,
    loggingElapsedMs: 0,
    logRows: [],
    magnitudePlot: null,
    phasePlot: null,
    needsPlotUpdate: true,
    lastPlotUpdateMs: 0,
  };

  init();

  function init() {
    bindEvents();
    applySettingsFromControls();
    initPlots();
    updateControls();
    updateStatus();
    window.setInterval(refreshRuntimeStatus, 500);
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
    dom.clearBtn.addEventListener("click", clearRuntimeData);
    dom.startLoggingBtn.addEventListener("click", startLogging);
    dom.stopLoggingBtn.addEventListener("click", stopLogging);

    for (const control of [dom.channelCount, dom.inputFormat, dom.outputMode]) {
      control.addEventListener("change", () => {
        applySettingsFromControls();
        clearRuntimeData();
        initPlots();
        setNotice(
          hasChannelCount()
            ? "Channel, input format, or output mode changed. Profile data was cleared."
            : "Set Channel count before connecting.",
          "warn"
        );
      });
    }

    dom.expectedSampleRate.addEventListener("change", () => {
      applySettingsFromControls();
      updateStatus();
    });

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
      setNotice("Connected. Plotting the latest valid frame across channels.", "ok");

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

    const nowSec = performance.now() / 1000;
    const sample = {
      timestampMs: Date.now(),
      mags: parsed.mags,
      phases: parsed.phases,
    };

    state.latest = sample;
    state.frameCount += 1;
    state.receiveTimes.push(nowSec);
    pruneReceiveTimes(nowSec);

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

  function startLogging() {
    if (!hasChannelCount()) {
      setNotice("Set Channel count before logging.", "warn");
      updateControls();
      return;
    }

    state.logFilename = buildCsvFilename("channel-response");
    dom.csvFilename.value = state.logFilename;
    state.logging = true;
    state.loggingStartedAtMs = performance.now();
    state.loggingElapsedMs = 0;
    state.logRows = [buildCsvHeader()];
    updateControls();
    updateStatus();
    setNotice("Logging started. Stop logging to save a CSV file.", "ok");
  }

  async function stopLogging() {
    if (!state.logging) return;

    state.loggingElapsedMs = getLoggingElapsedMs();
    state.loggingStartedAtMs = null;
    state.logging = false;
    const content = state.logRows.join("\n") + "\n";
    const fileName = state.logFilename || buildCsvFilename("channel-response");
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
    state.latest = null;
    state.receiveTimes = [];
    state.frameCount = 0;
    state.byteCount = 0;
    state.rawLineCount = 0;
    state.bufferedChars = 0;
    state.parseErrorCount = 0;
    state.lastByteTimeMs = null;
    if (!state.logging) {
      state.loggingStartedAtMs = null;
      state.loggingElapsedMs = 0;
    }
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
    state.channelCount = readOptionalInteger(dom.channelCount.value, 1, 128);
    state.inputFormat = dom.inputFormat.value === "grouped" ? "grouped" : "interleaved";
    state.outputMode = ["both", "mag", "phase"].includes(dom.outputMode.value) ? dom.outputMode.value : "both";
    state.expectedSampleRate = readNumber(dom.expectedSampleRate.value, 5, 0.1, 1000);

    dom.channelCount.value = state.channelCount === null ? "" : String(state.channelCount);
    dom.inputFormat.disabled = state.connected || state.outputMode !== "both";
    dom.expectedSampleRate.value = state.expectedSampleRate;
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

  function initPlots() {
    destroyPlots();

    if (!window.uPlot) {
      dom.magnitudePlot.innerHTML = "<div class=\"plot-empty\">uPlot CDN was not loaded. Check your network connection.</div>";
      dom.phasePlot.innerHTML = "<div class=\"plot-empty\">uPlot CDN was not loaded. Check your network connection.</div>";
      return;
    }

    if (!hasChannelCount()) {
      dom.magnitudePlot.innerHTML = "<div class=\"plot-empty\">Set Channel count to create the channel profile.</div>";
      dom.phasePlot.innerHTML = "<div class=\"plot-empty\">Set Channel count to create the channel profile.</div>";
      return;
    }

    if (hasMagnitude()) {
      state.magnitudePlot = createProfilePlot(dom.magnitudePlot, "mag");
    } else {
      dom.magnitudePlot.innerHTML = "<div class=\"plot-empty\">Magnitude data is not included in the current output mode.</div>";
    }

    if (hasPhase()) {
      state.phasePlot = createProfilePlot(dom.phasePlot, "phase");
    } else {
      dom.phasePlot.innerHTML = "<div class=\"plot-empty\">Phase data is not included in the current output mode.</div>";
    }

    requestPlotUpdate();
  }

  function destroyPlots() {
    if (state.magnitudePlot) state.magnitudePlot.destroy();
    if (state.phasePlot) state.phasePlot.destroy();
    state.magnitudePlot = null;
    state.phasePlot = null;
    dom.magnitudePlot.textContent = "";
    dom.phasePlot.textContent = "";
  }

  function createProfilePlot(container, kind) {
    const size = getPlotSize(container);
    const isMagnitude = kind === "mag";
    const series = [
      { label: "channel" },
      {
        label: isMagnitude ? "magnitude" : "phase",
        stroke: isMagnitude ? colors.magnitude : colors.phase,
        width: 2.4,
        points: { show: true, size: 6, width: 1.5 },
      },
    ];

    return new uPlot(makePlotOptions(size, isMagnitude ? "magnitude" : "phase", series), buildProfileData(kind), container);
  }

  function makePlotOptions(size, unit, series) {
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

    if (state.needsPlotUpdate && nowMs - state.lastPlotUpdateMs >= intervalMs) {
      updatePlots();
      state.needsPlotUpdate = false;
      state.lastPlotUpdateMs = nowMs;
    }

    requestAnimationFrame(plotLoop);
  }

  function updatePlots() {
    if (!hasChannelCount()) return;

    if (state.magnitudePlot) {
      state.magnitudePlot.setData(buildProfileData("mag"));
      state.magnitudePlot.setScale("x", { min: 0.5, max: state.channelCount + 0.5 });
    }

    if (state.phasePlot) {
      state.phasePlot.setData(buildProfileData("phase"));
      state.phasePlot.setScale("x", { min: 0.5, max: state.channelCount + 0.5 });
    }
  }

  function buildProfileData(kind) {
    if (!hasChannelCount()) return [[], []];
    const channels = Array.from({ length: state.channelCount }, (_value, index) => index + 1);
    const values = state.latest
      ? (kind === "mag" ? state.latest.mags : state.latest.phases)
      : Array.from({ length: state.channelCount }, () => null);
    return [channels, values];
  }

  function resizePlots() {
    if (state.magnitudePlot) state.magnitudePlot.setSize(getPlotSize(dom.magnitudePlot));
    if (state.phasePlot) state.phasePlot.setSize(getPlotSize(dom.phasePlot));
  }

  function getPlotSize(container) {
    const rect = container.getBoundingClientRect();
    return {
      width: Math.max(320, Math.floor(rect.width - 20)),
      height: Math.max(260, Math.min(390, Math.floor(rect.height || 330))),
    };
  }

  function requestPlotUpdate() {
    state.needsPlotUpdate = true;
  }

  function pruneReceiveTimes(nowSec) {
    const rateWindowStart = nowSec - 5;
    while (state.receiveTimes.length && state.receiveTimes[0] < rateWindowStart) state.receiveTimes.shift();
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
    dom.baudRate.disabled = state.connected;
    dom.inputFormat.disabled = state.connected || state.outputMode !== "both";
    dom.outputMode.disabled = state.connected;
    dom.csvFilename.disabled = state.logging;
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
    dom.elapsedTime.textContent = formatElapsedTime(getLoggingElapsedMs());
    dom.elapsedTime.classList.toggle("running", state.logging);
    dom.lastRawLine.textContent = state.lastRawLine || "(none)";
    dom.bufferPreview.textContent = state.bufferPreview || "(empty)";
    dom.lastInvalidReason.textContent = state.lastInvalidReason || "(none)";
  }

  function refreshRuntimeStatus() {
    pruneReceiveTimes(performance.now() / 1000);
    updateStatus();
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

  function getLoggingElapsedMs() {
    if (state.logging && state.loggingStartedAtMs !== null) {
      return performance.now() - state.loggingStartedAtMs;
    }
    return state.loggingElapsedMs;
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

  function formatChannelTick(value) {
    return Number.isInteger(value) ? String(value) : "";
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
