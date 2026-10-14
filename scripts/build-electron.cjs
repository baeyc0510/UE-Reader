// The CLI's argument parser detects Electron even in RUN_AS_NODE mode.
// It must use ordinary Node argument offsets for this build-only process.
delete process.versions.electron;
process.noAsar = true;
require('../node_modules/electron-builder/cli.js');
