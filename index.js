var fs = require('fs');
let wav = require('node-wav');
var goertzel = require('goertzel')
var almostEqual = require('almost-equal')

const {app, BrowserWindow} = require('electron')
const path = require('path')
const url = require('url')

var inputFile = process.argv[2];

let buffer = fs.readFileSync(inputFile);
let result = wav.decode(buffer);
console.log('samplerate:', result.sampleRate);
var samples = result.channelData[0];
console.log('total # of samples:', samples.length); // Float32Array
//samples = samples.slice(0, 1000000); // limit sample while testing


// pulse is 300 µs
var samplesPerPulse = result.sampleRate * 300/1000000;
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

var ProgressBar = require('progress');
console.log('detecting pulses');
var bar = new ProgressBar(':bar', { total: samples.length / 1000 });

var frequencies = [];
for (var idx = 0; idx < samples.length; idx++) {
    if ((idx % 1000) == 0) {
        bar.tick();
    }

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
var runLengthPad = 10; // experimental value

var zeroBitRunLength = Math.floor(4*samplesPerPulse) + runLengthPad;
var oneBitRunLength = Math.floor(9*samplesPerPulse) + runLengthPad;
var silenceRunLength = Math.floor(result.sampleRate * 1300/1000000) - runLengthPad; // 1300 microSecs

console.log('zero bit run length', zeroBitRunLength);
console.log('one bit run length', oneBitRunLength);
console.log('silence periods', silenceRunLength);

var runLengthsForEdit = runs.map(function(run) {
    var bitAtString;
    if (run.runLength < 5) { // just disregard very short runs
        bitAsString = '-';
    } else if (almostEqual(run.runLength, zeroBitRunLength, 0.4)) {
        bitAsString = '0';
    } else if (almostEqual(run.runLength, oneBitRunLength, 0.4)) {
        bitAsString = '1';
    } else {
        bitAsString = '?';
    }
    return bitAsString + '\t' + run.index + ':' + run.runLength;
}).join('\n');

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win

function createWindow () {
  // Create the browser window.
  win = new BrowserWindow({width: 2000, height: 600})

  // and load the index.html of the app.
  win.loadURL(url.format({
    pathname: path.join(__dirname, 'index.html'),
    protocol: 'file:',
    slashes: true
  }))

  // Open the DevTools.
 // win.webContents.openDevTools()

    win.webContents.on('did-finish-load', () => {
        win.webContents.send('config', {
            samples: samples,
            fileName: inputFile,
            zeroBitRunLength: zeroBitRunLength,
            oneBitRunLength: oneBitRunLength,
            runLengthsForEdit: runLengthsForEdit,
            silenceRunLength: silenceRunLength
        });
    })

  // Emitted when the window is closed.
  win.on('closed', () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    win = null
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow)

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (win === null) {
    createWindow()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
