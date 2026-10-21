// Every detector, cheapest evidence first: single lines, then files, then the change as a whole, then the codebase.
import lines from './lines.mjs';
import simpler from './simpler.mjs';
import files from './files.mjs';
import change from './change.mjs';
import codebase from './codebase.mjs';
import platform from './platform.mjs';

export const DETECTORS = [...lines, ...simpler, ...files, ...change, ...codebase, ...platform];
