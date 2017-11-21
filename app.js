console.log('app.js loaded');

var fs = require('fs');
var wav = require('node-wav');
var _ = require('lodash');
var goertzel = require('goertzel')
var almostEqual = require('almost-equal')
var tzx = require('./tzx');

window.editor = ace.edit("editor");
editor.setTheme("ace/theme/monokai");
editor.getSession().setMode("ace/mode/properties"); // I guess

var renderer = require('electron').ipcRenderer;

var samples;
var samplesLength;
var zeroBitRunLength;
var oneBitRunLength;
var silenceRunLength; // expected # samples btw runs
var fileName;

renderer.on('inputFile', (event, inputFile) => {
    console.log(inputFile);
    fileName = inputFile;

    let buffer = fs.readFileSync(inputFile);
    let result = wav.decode(buffer);
    console.log('samplerate:', result.sampleRate);
    samples = result.channelData[0];
    console.log('total # of samples:', samples.length); // Float32Array
    //samples = samples.slice(0, 1000000); // limit sample while testing
    samplesLength = samples.length;

    // pulse is 300 µs
    var samplesPerPulse = result.sampleRate * 300 / 1000000;
    console.log('samples per pulse=', samplesPerPulse);

    var opts = {
        // 3.2 kHz 
        targetFrequency: 3200,
        // samples per second 
        sampleRate: result.sampleRate,
        // samples per frame 
        samplesPerFrame: 10,
        threshold: 0.1
    };
    var detect = goertzel(opts);

    console.log('detecting pulses');

    var frequencies = []; // TBD runs, not frequencies
    for (var idx = 0; idx < samples.length; idx++) {
        if (idx < 16 || idx > samples.length - 16) {
            frequencies.push(0);
            continue;
        }

        // pick buffer around point
        var slice = samples.slice(idx - 16, idx + 16);

        frequencies.push(detect(slice) ? 1 : 0);
    }

    var runs = [];
    var isUp = false;
    var lastUpIdx;
    var runLengthStats = {};
    for (var idx = 0; idx < frequencies.length; idx++) {
        if (!isUp && frequencies[idx] === 1) {
            lastUpIdx = idx;
            isUp = true;
        } else if (isUp && frequencies[idx] === 0) {
            var runLength = idx - lastUpIdx;
            runs.push({ index: lastUpIdx, runLength: runLength })
            runLengthStats[runLength] = runLengthStats[runLength] ? runLengthStats[runLength] + 1 : 1;
            isUp = false;
        }
    }
    console.log('runLengthStats:');
    for (var i = 0; i < 150; i++) {
        console.log(i, runLengthStats[i] ? runLengthStats[i] : 0);
    }

    // adjust for the fact that adjacent samples register as being part of run as well, i.e. the run lengths
    // measured will be longer than the length of the pulse
    var runLengthPad = 15; // experimental value

    zeroBitRunLength = Math.floor(4 * samplesPerPulse) + runLengthPad;
    oneBitRunLength = Math.floor(9 * samplesPerPulse) + runLengthPad;
    silenceRunLength = Math.floor(result.sampleRate * 1300 / 1000000) - runLengthPad; // 1300 microSecs

    console.log('zero bit run length', zeroBitRunLength);
    console.log('one bit run length', oneBitRunLength);
    console.log('silence periods', silenceRunLength);

    var linesForEdit = runs.map(function (run) {
        var bitAtString;
        if (run.runLength < 15) { // just disregard very short runs
            bitAsString = '-';
        } else if (almostEqual(run.runLength, zeroBitRunLength, 0.4)) {
            bitAsString = '0';
        } else if (almostEqual(run.runLength, oneBitRunLength, 0.4)) {
            bitAsString = '1';
        } else {
            bitAsString = '?';
        }
        return bitAsString + '\t' + run.index + ':' + run.runLength;
    });

    // scan for dubious pauses indicating possible loss of signal
    var firstBitIdx = _.findIndex(linesForEdit, val => val[0] == '0' || val[0] == '1')
    var idx = _.findLastIndex(linesForEdit, val => val[0] == '0' || val[0] == '1')
    while (idx > firstBitIdx) {
        var pauseBeforeRun = runs[idx].index - (runs[idx - 1].index + runs[idx - 1].runLength);
        if (pauseBeforeRun > 2*silenceRunLength) {
            linesForEdit[idx - 1] = linesForEdit[idx - 1] + ' # suspicious loss of signal?'
        }
        idx--;
    }


    document.title = fileName;

    editor.setValue(linesForEdit.join('\n'), -1);

    editor.getSession().on('change', function (e) {
        repaintCanvas();
    });

    editor.getSession().selection.on('changeCursor', function (e) {
        repaintCanvas();
    });

    editor.getSession().selection.on('changeSelection', function (e) {
        repaintCanvas();
    });

    repaintCanvas();
});

var canvasOffset = 0;
var canvasWidth;

function repaintCanvas() {
    var canvas = document.getElementById("Canvas");
    canvasWidth = window.innerWidth;
    canvas.width = canvasWidth;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    //var editorLines = editor.getValue().split('\n');

    var runDataCache = {};
    var cursorRow = editor.getSelection().getCursor().row;
    var currentLineRunData = getRunData(cursorRow, runDataCache);

    if (currentLineRunData) {
        canvasOffset = Math.floor(currentLineRunData.offset + currentLineRunData.length / 2 - canvasWidth / 2);
        canvasOffset = Math.max(canvasOffset, 0);
        if (samples) {
            canvasOffset = Math.min(canvasOffset, samplesLength - canvasWidth);
        }
    }

    // draw runs
    var row = cursorRow;
    while (row >= 0) {
        var inBounds = paintRun(ctx, getRunData(row, runDataCache), row === cursorRow)
        if (!inBounds) {
            break;
        }
        row--;
    }
    var row = cursorRow + 1;
    while (row < editor.session.getLength()) {
        var inBounds = paintRun(ctx, getRunData(row, runDataCache), row === cursorRow)
        if (!inBounds) {
            break;
        }
        row++;
    }

    // draw wave samples

    if (samples) {
        for (var idx = 0; idx < canvasWidth; idx++) {
            ctx.moveTo(idx, 50);
            ctx.lineTo(idx, 50 - 50 * samples[idx + canvasOffset]);
        }
        ctx.stroke()
    }

    ctx.font = "10px Lucida Console";
    ctx.fillStyle = "#aaa";
    ctx.fillRect(0, 0, 80, 12);
    ctx.fillStyle = "white";
    ctx.fillText("offset: " + canvasOffset, 4, 10);

    // update bytelen/bitlen stats
    var bitlen = getBits().length;

    var bytelen = Math.floor(bitlen / 8);
    var remainingBitlen = bitlen % 8;

    document.getElementById("ByteLen").innerHTML = bytelen + ' byte' + (bytelen !== 1 ? 's' : '');
    document.getElementById("BitLen").style.visibility = (remainingBitlen === 0 ? 'hidden' : 'visible');
    document.getElementById("BitLen").innerHTML = ' and ' + remainingBitlen + ' bit' + (remainingBitlen !== 1 ? 's': '');
}

function parseLine(str) {
    str = str.split('#')[0];
    var editorLineRegex = /^(.)\s*(\d*)?(?::(\d*))?\s*$/;
    return editorLineRegex.exec(str);
}


function getRunData(rowNumber, runDataCache) {
    if (runDataCache[rowNumber]) { // cache guards against O(n^2) for some corner cases
        return runDataCache[rowNumber];
    }

    var match = parseLine(editor.session.getLine(rowNumber));
    var result;
    if (match) {
        var bitValue = match[1];

        var offset = parseInt(match[2]);
        if (!offset) {
            if (rowNumber === 0) {
                offset = 0;
            } else {
                // place at expected position based upon previous neighbor
                var prevRowRunData;
                var searchBackIdx = rowNumber - 1;
                while (searchBackIdx >= 0 && !prevRowRunData) {
                    prevRowRunData = getRunData(searchBackIdx--, runDataCache); // recurse
                }

                if (prevRowRunData) {
                    offset = prevRowRunData.offset + prevRowRunData.length + silenceRunLength;
                } else {
                    offset = 0;
                }
            }
        }

        var length;
        if (match[3] && match[3] !== '') {
            length = parseInt(match[3]);
        } else if (bitValue === '0') {
            length = zeroBitRunLength;
        } else if (bitValue === '1') {
            length = oneBitRunLength;
        } else {
            length = 0;
        }

        var result = {
            bitValue: bitValue,
            offset: offset,
            length: length
        }
        runDataCache[rowNumber] = result;
        return result;
    }
}

function paintRun(ctx, runData, isCursorRow) { // returns true if painted, false if out of bounds
    if (runData) {
        if (isCursorRow) {
            ctx.fillStyle = "blue";
        } else {
            ctx.fillStyle = "#444";
        }

        // if we are off the drawing bounds, then return false
        if (runData.offset - canvasOffset + runData.length < 0) {
            //                console.log('too far left');
            return false;
        }
        if (runData.offset - canvasOffset > canvasWidth) {
            //                console.log('too far right');
            return false;
        }

        ctx.fillRect(runData.offset - canvasOffset, 100, runData.length, 20);

        ctx.font = "20px Georgia";
        ctx.fillStyle = "black";

        ctx.fillText(runData.bitValue, Math.floor(runData.offset - canvasOffset + runData.length / 2) - 5, 136);

    }
    return true;

}

function getBits() {
    var editorLines = editor.getValue().split('\n');
    
    var bits = [];
    for (idx = 0; idx < editorLines.length; idx++) {
        var editorLine = editorLines[idx];
        var match = parseLine(editorLine);
        if (match) {
            var bitValue = match[1];
            if (bitValue === '0' || bitValue === '1') {
                bits.push(bitValue);
            }
        }
    }

    return bits;        
}

function exportData() {
    var bits = getBits();
    var bitString = bits.join('');
    var rawData = [];
    while (bitString.length > 0) {
        var bitsForByte = bitString.slice(0, 8);
        var value = 0;
        for (var pos = 0; pos < 8; pos++) {
            value *= 2;
            if (bitsForByte.charAt(pos) === '1') {
                value++;
            }
        }
        rawData.push(value);
        bitString = bitString.slice(8);
    }

    var tzxEncodedBytes = tzx.encode(rawData);

    var byteArray = new Uint8Array(tzxEncodedBytes);
    var blob = new Blob([byteArray], { type: "application/octet-stream" });
    var outputFileName = fileName + ".tzx";
    saveAs(blob, outputFileName);
}
