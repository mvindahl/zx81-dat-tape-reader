var fs = require('fs');
let wav = require('node-wav');
var goertzel = require('goertzel')
var almostEqual = require('almost-equal')

const {app, BrowserWindow} = require('electron')
const path = require('path')
const url = require('url')

var inputFile = process.argv[2];
var zeroBitRunLength = parseInt(process.argv[3] || '0');
var oneBitRunLength = parseInt(process.argv[4] || '0');

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
    threshold: 0.2
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
if (!zeroBitRunLength || !oneBitRunLength) {
    // In earlier impls I tried to be smart about this in the code but it's not worth the hassle.
    console.log('Please determine the zero bit run length and the one bit run length, using the run length');
    console.log('distribution above. It will be the two more or less distict "humps", probably around 70 and 130.');
    console.log('The rerun the command, using the run length as two additional args.')
    process.exit();    
}

console.log('zero bit run length', zeroBitRunLength);
console.log('one bit run length', oneBitRunLength);

var runLengthsForEdit = runs.map(function(run) {
    var bitAtString;
    if (run.runLength < 5) { // just disregard very short runs
        bitAsString = '-';
    } else if (almostEqual(run.runLength, zeroBitRunLength, 0.3)) {
        bitAsString = '0';
    } else if (almostEqual(run.runLength, oneBitRunLength, 0.3)) {
        bitAsString = '1';
    } else {
        bitAsString = '?';
    }
    return bitAsString + ' # ' + run.index + ':' + run.runLength;
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
//  win.webContents.openDevTools()

    win.webContents.on('did-finish-load', () => {
        win.webContents.send('samples', samples);
        win.webContents.send('runLengthsForEdit', runLengthsForEdit);
        win.webContents.send('fileName', inputFile);
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
