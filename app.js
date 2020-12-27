console.log("app.js loaded");

const fs = require("fs");
const wav = require("node-wav");
const _ = require("lodash");
const goertzel = require("goertzel");
const almostEqual = require("almost-equal");
const tzx = require("./tzx");

window.editor = ace.edit("editor");
editor.setTheme("ace/theme/monokai");
editor.getSession().setMode("ace/mode/properties"); // I guess

const { ipcRenderer } = require("electron");

let samples;
let samplesLength;
let zeroBitRunLength;
let oneBitRunLength;
let silenceRunLength; // expected # samples btw runs
let fileName;

ipcRenderer.on("inputFile", (event, inputFile) => {
  console.log(inputFile);
  fileName = inputFile;

  let buffer = fs.readFileSync(inputFile);
  let decodedWav = wav.decode(buffer);
  console.log("samplerate:", decodedWav.sampleRate);
  samples = decodedWav.channelData[0];
  console.log("total # of samples:", samples.length); // Float32Array
  //samples = samples.slice(0, 1000000); // limit sample while testing
  samplesLength = samples.length;

  // pulse is 300 µs
  const samplesPerPulse = (decodedWav.sampleRate * 300) / 1000000;
  console.log("samples per pulse=", samplesPerPulse);

  // configure frequency detection library
  const targetFrequency = 3200; // 3.2 Khz
  const samplesPerPulseRounded = 2 * Math.round(samplesPerPulse / 2);
  const opts = {
    targetFrequency,
    // samples per second
    sampleRate: decodedWav.sampleRate,
    // samples per frame
    samplesPerFrame: samplesPerPulseRounded,
    threshold: 0.01,
  };
  const detect = goertzel(opts);

  console.log("detecting pulses");

  // for each sample, include adjacent samples and detect
  // the pulse frequency. This creates an array of zeroes and one
  // to indicate the location of pulses.

  let detections = [];
  for (var idx = 0; idx < samples.length; idx++) {
    if (
      idx < samplesPerPulseRounded / 2 ||
      idx > samples.length - samplesPerPulseRounded / 2
    ) {
      detections.push(0);
      continue;
    }

    // pick buffer around point
    const slice = samples.slice(
      idx - samplesPerPulseRounded / 2,
      idx + samplesPerPulseRounded / 2
    );

    detections.push(detect(slice) ? 1 : 0);
  }

  // identify all runs of contiguous ones. Each one will be registered
  // with an index and a length.

  let runs = [];
  let isUp = false;
  let lastUpIdx;
  let runLengthStats = {};
  for (let idx = 0; idx < detections.length; idx++) {
    if (!isUp && detections[idx] === 1) {
      lastUpIdx = idx;
      isUp = true;
    } else if (isUp && detections[idx] === 0) {
      const runLength = idx - lastUpIdx;
      runs.push({ index: lastUpIdx, runLength: runLength });
      runLengthStats[runLength] = runLengthStats[runLength]
        ? runLengthStats[runLength] + 1
        : 1;
      isUp = false;
    }
  }
  console.log("runLengthStats:");
  for (let i = 0; i < 150; i++) {
    console.log(i, runLengthStats[i] ? runLengthStats[i] : 0);
  }

  // adjust for the fact that adjacent samples register as being part
  // of run as well, i.e. the run lengths measured will be longer than
  // the length of the pulse
  const runLengthPad = 15; // experimental value

  const zeroBitRunLength = Math.floor(4 * samplesPerPulse) + runLengthPad;
  const oneBitRunLength = Math.floor(9 * samplesPerPulse) + runLengthPad;
  const silenceRunLength =
    Math.floor((decodedWav.sampleRate * 1300) / 1000000) - runLengthPad; // 1300 microSecs

  console.log("zero bit run length", zeroBitRunLength);
  console.log("one bit run length", oneBitRunLength);
  console.log("silence periods", silenceRunLength);

  // map run lengths to guesses about whether its a zero pulse,
  // a one pulse, or just noise. This outpus the lines that go
  // into the editor

  const linesForEdit = runs.map((run) => {
    var bitAtString;
    if (run.runLength < 15) {
      // disregard very short runs as noise
      bitAsString = "-";
    } else if (almostEqual(run.runLength, zeroBitRunLength, 0.4)) {
      bitAsString = "0";
    } else if (almostEqual(run.runLength, oneBitRunLength, 0.4)) {
      bitAsString = "1";
    } else {
      // mark for human processing
      bitAsString = "?";
    }
    return bitAsString + "\t" + run.index + ":" + run.runLength;
  });

  // scan for dubious pauses indicating possible loss of signal

  var firstBitIdx = _.findIndex(
    linesForEdit,
    (val) => val[0] == "0" || val[0] == "1"
  );
  var idx = _.findLastIndex(
    linesForEdit,
    (val) => val[0] == "0" || val[0] == "1"
  );
  while (idx > firstBitIdx) {
    var pauseBeforeRun =
      runs[idx].index - (runs[idx - 1].index + runs[idx - 1].runLength);
    if (pauseBeforeRun > 2 * silenceRunLength) {
      linesForEdit[idx - 1] =
        linesForEdit[idx - 1] + " # suspicious loss of signal?";
    }
    idx--;
  }

  document.title = fileName;

  editor.setValue(linesForEdit.join("\n"), -1);

  editor.getSession().on("change", function (e) {
    repaintCanvas();
  });

  editor.getSession().selection.on("changeCursor", function (e) {
    repaintCanvas();
  });

  editor.getSession().selection.on("changeSelection", function (e) {
    repaintCanvas();
  });

  repaintCanvas();
});

let canvasOffset = 0;
let canvasWidth;

// the canvas paints the original waveform and a representation
// of the runs in the editor

function repaintCanvas() {
  const canvas = document.getElementById("Canvas");
  canvasWidth = window.innerWidth;
  canvas.width = canvasWidth;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let runDataCache = {};
  const cursorRow = editor.getSelection().getCursor().row;
  const currentLineRunData = getRunData(cursorRow, runDataCache);

  if (currentLineRunData) {
    canvasOffset = Math.floor(
      currentLineRunData.offset +
        currentLineRunData.length / 2 -
        canvasWidth / 2
    );
    canvasOffset = Math.max(canvasOffset, 0);
    if (samples) {
      canvasOffset = Math.min(canvasOffset, samplesLength - canvasWidth);
    }
  }

  // draw runs
  let row = cursorRow;
  while (row >= 0) {
    const inBounds = paintRun(
      ctx,
      getRunData(row, runDataCache),
      row === cursorRow
    );
    if (!inBounds) {
      // any rows below will also be outside the visible area
      break;
    }
    row--;
  }

  row = cursorRow + 1;
  while (row < editor.session.getLength()) {
    var inBounds = paintRun(
      ctx,
      getRunData(row, runDataCache),
      row === cursorRow
    );
    if (!inBounds) {
      break;
    }
    row++;
  }

  // draw wave samples

  if (samples) {
    for (let idx = 0; idx < canvasWidth; idx++) {
      ctx.moveTo(idx, 50);
      ctx.lineTo(idx, 50 - 50 * samples[idx + canvasOffset]);
    }
    ctx.stroke();
  }

  ctx.font = "10px Lucida Console";
  ctx.fillStyle = "#aaa";
  ctx.fillRect(0, 0, 80, 12);
  ctx.fillStyle = "white";
  ctx.fillText("offset: " + canvasOffset, 4, 10);

  // update bytelen/bitlen stats
  const bitlen = getBits().length;

  const bytelen = Math.floor(bitlen / 8);
  const remainingBitlen = bitlen % 8;

  document.getElementById("ByteLen").innerHTML =
    bytelen + " byte" + (bytelen !== 1 ? "s" : "");
  document.getElementById("BitLen").style.visibility =
    remainingBitlen === 0 ? "hidden" : "visible";
  document.getElementById("BitLen").innerHTML =
    " and " + remainingBitlen + " bit" + (remainingBitlen !== 1 ? "s" : "");
}

function parseLine(str) {
  str = str.split("#")[0];
  const editorLineRegex = /^(.)\s*(\d*)?(?::(\d*))?\s*$/;
  return editorLineRegex.exec(str);
}

function getRunData(rowNumber, runDataCache) {
  if (runDataCache[rowNumber]) {
    // cache guards against O(n^2) for some corner cases
    return runDataCache[rowNumber];
  }

  const match = parseLine(editor.session.getLine(rowNumber));
  if (match) {
    const bitValue = match[1];

    let offset = parseInt(match[2]);
    if (!offset) {
      if (rowNumber === 0) {
        offset = 0;
      } else {
        // place at expected position based upon previous neighbor
        let prevRowRunData;
        let searchBackIdx = rowNumber - 1;
        while (searchBackIdx >= 0 && !prevRowRunData) {
          prevRowRunData = getRunData(searchBackIdx--, runDataCache); // recurse
        }

        if (prevRowRunData) {
          offset =
            prevRowRunData.offset + prevRowRunData.length + silenceRunLength;
        } else {
          offset = 0;
        }
      }
    }

    let length;
    if (match[3] && match[3] !== "") {
      length = parseInt(match[3]);
    } else if (bitValue === "0") {
      length = zeroBitRunLength;
    } else if (bitValue === "1") {
      length = oneBitRunLength;
    } else {
      length = 0;
    }

    const result = {
      bitValue: bitValue,
      offset: offset,
      length: length,
    };
    runDataCache[rowNumber] = result;
    return result;
  }
}

function paintRun(ctx, runData, isCursorRow) {
  // returns true if painted, false if out of bounds
  if (runData) {
    if (isCursorRow) {
      ctx.fillStyle = "blue";
    } else {
      ctx.fillStyle = "#444";
    }

    // if we are off the drawing bounds, then return false
    if (runData.offset - canvasOffset + runData.length < 0) {
      return false;
    }
    if (runData.offset - canvasOffset > canvasWidth) {
      return false;
    }

    ctx.fillRect(runData.offset - canvasOffset, 100, runData.length, 20);

    ctx.font = "20px Georgia";
    ctx.fillStyle = "black";

    ctx.fillText(
      runData.bitValue,
      Math.floor(runData.offset - canvasOffset + runData.length / 2) - 5,
      136
    );
  }
  return true;
}

function getBits() {
  const editorLines = editor.getValue().split("\n");

  let bits = [];
  for (let idx = 0; idx < editorLines.length; idx++) {
    const editorLine = editorLines[idx];
    const match = parseLine(editorLine);
    if (match) {
      const bitValue = match[1];
      if (bitValue === "0" || bitValue === "1") {
        bits.push(bitValue);
      }
    }
  }

  return bits;
}

function exportData() {
  const bits = getBits();
  const bitString = bits.join("");
  let rawData = [];
  while (bitString.length > 0) {
    const bitsForByte = bitString.slice(0, 8);
    const value = 0;
    for (var pos = 0; pos < 8; pos++) {
      value *= 2;
      if (bitsForByte.charAt(pos) === "1") {
        value++;
      }
    }
    rawData.push(value);
    bitString = bitString.slice(8);
  }

  const tzxEncodedBytes = tzx.encode(rawData);

  const byteArray = new Uint8Array(tzxEncodedBytes);
  const blob = new Blob([byteArray], { type: "application/octet-stream" });
  const outputFileName = fileName + ".tzx";
  saveAs(blob, outputFileName);
}
