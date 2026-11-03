// The touch preload: what a test file's process was seen to touch, as kinds only.
//
// Loaded as `--import=<dir>/touch.mjs?out=<record file>.touch`, so its output path rides its
// import address and no environment variable reaches a test. It watches child_process's
// starting functions, net.Socket's connect (which fetch also goes through) and the timer
// functions, a timer counted only when the call comes from the process's own code: neither
// straight from Node's own internals nor from code under node_modules. It appends a line to its
// output file the moment it first sees each kind, with waits_ms null, and one more at the
// process's exit holding every kind seen and the waits total, each line
//   {"pid","ppid","file","kinds","waits_ms"}
// It adds no signal listener, so a process killed by a signal dies as it would have, having
// said its kinds and leaving its waits unknown. `file` is the process's main module. The
// runner's own process marks itself with {"pid","ppid","runner":true} and writes nothing after.
// Each line stays under 4 KiB, so lines appended at the same moment by several processes never
// interleave. It never writes a host, address,
// port or argument: a connection becomes `local-service` or `network`, nothing more.
//
// Imported with no `out` in its address, it installs nothing and only answers its exports.

import cp from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import timers from 'node:timers';
import timersPromises from 'node:timers/promises';

const MARK = Symbol.for('dazzer.test-times.touch'); // record.mjs TOUCH_MARK
const ORDER = ['process', 'local-service', 'network'];

// The output path as written in the import address. Each well-formed %XX run is decoded; a
// raw % that starts none is kept as it is, so no path makes the preload or a reporter throw.
export function decodeOut(s) {
  return String(s).replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try { return decodeURIComponent(run); } catch { return run; }
  });
}

export function outOf(url) {
  const m = /[?&]out=([^&]*)/.exec(new URL(url).search);
  return m ? decodeOut(m[1]) : null;
}

export function isLoopback(host) {
  if (host === undefined || host === null || host === '') return true; // net's default is localhost
  let h = String(host).toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.startsWith('::ffff:')) h = h.slice(7);
  if (net.isIPv4(h)) return h.startsWith('127.') || h === '0.0.0.0';
  if (net.isIPv6(h)) {
    const c = new URL(`http://[${h}]`).hostname; // the address's one written form
    return c === '[::1]' || c === '[::]' || c.startsWith('[::ffff:7f');
  }
  return false;
}

// The kind a call to net.Socket.prototype.connect opens, from its arguments: `local-service`,
// `network`, or null when its host is a name only a lookup can place.
export function connectKind(args) {
  let a0 = args[0];
  if (Array.isArray(a0)) a0 = a0[0]; // net.connect hands connect its normalised arguments
  if (a0 && typeof a0 === 'object') {
    if (a0.path !== undefined && a0.path !== null) return 'local-service';
    return hostKind(a0.host);
  }
  if (typeof a0 === 'string' && !/^\d+$/.test(a0)) return 'local-service'; // a socket file or pipe
  return hostKind(typeof args[1] === 'string' ? args[1] : undefined);
}

function hostKind(host) {
  if (isLoopback(host)) return 'local-service';
  if (net.isIP(String(host).replace(/^\[|\]$/g, ''))) return 'network';
  return null;
}

function delayOf(d) {
  const n = Number(d);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Whether the call into `fn` came from someone else's code: straight from Node's own
// internals, such as the test harness's keep-alive interval on its way out
// (node:internal/test_runner/harness), or from code under node_modules, such as vitest's own
// test and hook timeouts. Those are the runner's, never the file's.
export function notOwnCaller(frame) {
  return /^\s*at (?:.*\()?node:/.test(frame) || /[\\/]node_modules[\\/]/.test(frame);
}

function fromElsewhere(fn) {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 1;
  const o = {};
  Error.captureStackTrace(o, fn);
  Error.stackTraceLimit = limit;
  return notOwnCaller(String(o.stack).split('\n')[1] ?? '');
}

function wrap(orig, before) {
  const w = function (...args) {
    try { before(args, w); } catch { /* watching never changes what the call does */ }
    return new.target ? Reflect.construct(orig, args, new.target) : Reflect.apply(orig, this, args);
  };
  for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(orig))) {
    if (k === 'prototype') continue;
    try { Object.defineProperty(w, k, d); } catch { /* keep what cannot be copied as it was */ }
  }
  for (const s of Object.getOwnPropertySymbols(orig)) {
    try { Object.defineProperty(w, s, Object.getOwnPropertyDescriptor(orig, s)); } catch { /* as above */ }
  }
  return w;
}

function install(out) {
  const state = { runner: false, kinds: new Set(), waits: 0, unplaced: 0, written: false };
  globalThis[MARK] = state;

  const append = (line) => {
    let text = JSON.stringify(line) + '\n';
    if (Buffer.byteLength(text) >= 4000) text = JSON.stringify({ ...line, file: null }) + '\n';
    try { fs.appendFileSync(out, text); } catch { /* a lost line leaves the file's kinds empty */ }
  };
  const head = () => ({ pid: process.pid, ppid: process.ppid, file: process.argv[1] ? path.resolve(process.argv[1]) : null });
  state.markRunner = () => append({ pid: process.pid, ppid: process.ppid, runner: true });
  const seen = (k) => {
    if (state.kinds.has(k)) return;
    state.kinds.add(k);
    if (!state.runner) append({ ...head(), kinds: [k], waits_ms: null });
  };

  const started = () => seen('process');
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    if (typeof cp[name] === 'function') cp[name] = wrap(cp[name], started);
  }
  if (cp.ChildProcess?.prototype?.spawn) {
    cp.ChildProcess.prototype.spawn = wrap(cp.ChildProcess.prototype.spawn, started);
  }

  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    try {
      const k = connectKind(args);
      if (k) seen(k);
      else {
        state.unplaced++;
        this.once('lookup', (err, address) => {
          state.unplaced--;
          seen(!err && isLoopback(address) ? 'local-service' : 'network');
        });
      }
    } catch { /* watching never changes what the call does */ }
    return Reflect.apply(connect, this, args);
  };

  const waited = (args, w) => { if (!fromElsewhere(w)) state.waits += delayOf(args[1]); };
  const waitedFirst = (args, w) => { if (!fromElsewhere(w)) state.waits += delayOf(args[0]); };
  const setTimeoutW = wrap(timers.setTimeout, waited);
  const setIntervalW = wrap(timers.setInterval, waited);
  timers.setTimeout = setTimeoutW;
  timers.setInterval = setIntervalW;
  globalThis.setTimeout = setTimeoutW;
  globalThis.setInterval = setIntervalW;
  timersPromises.setTimeout = wrap(timersPromises.setTimeout, waitedFirst);
  timersPromises.setInterval = wrap(timersPromises.setInterval, waitedFirst);
  const custom = Symbol.for('nodejs.util.promisify.custom');
  if (setTimeoutW[custom]) {
    try { Object.defineProperty(setTimeoutW, custom, { value: timersPromises.setTimeout }); } catch { /* as it was */ }
  }
  syncBuiltinESMExports();

  // At exit, the waits total, with every kind seen. No signal listener: a process killed by a
  // signal dies as it would have, having already said its kinds.
  process.on('exit', () => {
    if (state.written) return;
    state.written = true;
    if (state.runner) return; // the runner's own process reports nothing for itself
    if (state.unplaced > 0) state.kinds.add('network');
    append({ ...head(), kinds: ORDER.filter((k) => state.kinds.has(k)), waits_ms: Math.round(state.waits * 10) / 10 });
  });
}

const out = outOf(import.meta.url);
if (out && !globalThis[MARK]) install(out);
