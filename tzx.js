// Attach TZX header for encoded zx81 tape.
// Ref: http://www.worldofspectrum.org/TZXformat.html

function ascii(str) {
  let arr = [];

  for (let idx in str) {
    arr.push(str.charCodeAt(idx));
  }

  return arr;
}

function word(value) {
  let arr = [];

  const lobyte = value % 0x100;
  arr.push(lobyte);
  arr.push((value - lobyte) / 0x100);

  return arr;
}

function dword(value) {
  let arr = [];

  for (var b = 0; b < 4; b++) {
    const lobyte = value % 0x100;
    arr.push(lobyte);
    value = (value - lobyte) / 0x100;
  }

  return arr;
}

function encode(rawData) {
  const headerBlock = [ascii("ZXTape!"), 0x1a, 1, 20];

  const text = ascii("github.com/mvindahl/zx81-dat-tape-reader");
  const textBlock = [0x30, text.length, text];

  // The generic data block header is the most complicated part. It's reverse engineered from
  // similar tools and spcified according to the spec.
  const dataBlockContents = _.flatten([
    word(0), // Pause after this block (ms)
    dword(0), // Total number of symbols in pilot/sync block (can be 0)
    0, // Maximum number of pulses per pilot/sync symbol NPP
    0, // Number of pilot/sync symbols in the alphabet table (0=256)
    dword(8 * rawData.length), // Total number of symbols in data stream (can be 0)
    0x12, // Maximum number of pulses per data symbol NPD
    2, // Number of data symbols in the alphabet table (0=256) ASD
    // Zero bit pulse:
    3, // 0b11: force high level
    // Durations: top state, bottom state, top state etc.
    // The numbers are in z80 clock cycles (it runs at 3.5 Mhz)
    word(0x0212),
    word(0x0208),
    word(0x0212),
    word(0x0208),
    word(0x0212),
    word(0x0208),
    word(0x0212),
    word(0x1251),
    word(0x0000),
    word(0x0000),
    word(0x0000),
    word(0x0000), // zero length terminated sequence
    word(0x0000),
    word(0x0000),
    word(0x0000),
    word(0x0000),
    word(0x0000),
    word(0x0000),
    // One bit pulse:
    3, // 0b11: force high level
    word(0x0212),
    word(0x0208),
    word(0x0212),
    word(0x0208),
    word(0x0212),
    word(0x0208),
    word(0x0212),
    word(0x0208),
    word(0x0212),
    word(0x0208),
    word(0x0212),
    word(0x0208),
    word(0x0212),
    word(0x0208),
    word(0x0212),
    word(0x0208),
    word(0x0212),
    word(0x1251),
    // The actual data now follows
    rawData,
  ]);
  const dataBlock = [0x19, dword(dataBlockContents.length), dataBlockContents];

  const tzxEncodedBytes = _.flattenDeep([headerBlock, textBlock, dataBlock]);

  return tzxEncodedBytes;
}

module.exports = {
  encode: encode,
};
