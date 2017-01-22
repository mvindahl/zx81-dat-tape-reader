# Scan wav images of old tapes to detect binary data
Utility project for helping in the retrieval of old data tapes in ZX81 format. Takes input file in
.wav format. Saves file of binary data. Designed to be resistant towards the tapes having decayed over time.

For now it's work in progress. No guarantees given.

## The format in brief
Bits were stored as 3.2 kHz pulses of (ideally) square waves. A zero would be encoded as four consecutive pulses,
a one would be encoded as nine pulses. Pulses were separated by periods of no signal.
TBD: Reference

## The problem
Over the decades, the higher frequencies have diappeared from the tape, turning the square waves into
sinusiodal waves. What's worse, the signal has also been reduced and has drifted.
TBD: Horror gallery

Existing tools were based upon counting peaks.

## This project
Started off as an experiment and still is, I guess. The idea is to use an off-the-shelf algorithm to detect
the 3.2 KHz pulses to see if that would work better with the recordings.

The implementation is based upon node.js, electron.js and some nifty libraries that I found along the way.

## How to run
Check out the project from github
npm install
npm start <path to wav file>

On the first run, it will output a distribution of the lengths of the pulses that it found,
and prompt you to identify the length of pulses to look for when looking for zeroes and ones
(there will be a help text). Supply these numbers as additional CLI parameters and rerun.

When supplied with athe full set of parameters, the tool will launch a UI with a text editor and a formatted
representation of the pulses identified. Also, it will display the original wav data for reference
at the top. Search for "?" to find the parts of the tape where data could not be safely determined
and fix it in the text (the format is self explanatory I hope). Use the button at the
bottom to generate and save the ones and zeroes as a binary file.

## Code style and architecture
Not at this point, no. Mostly npm modules and duct tape. Indentation will probably offend.

## To be done
- support saving in tzx format
- clean up the code for readability

## Previous art
http://www.zx81stuff.org.uk/zx81/tapeutils/overview.html
There are probably other tools as well, dating back to the 1990s.
