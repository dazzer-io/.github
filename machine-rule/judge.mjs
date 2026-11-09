#!/usr/bin/env node
// THE MACHINE RULE (decision 121): which job of a dazzer-io repository may use which of our
// machines, judged over that repository's .github/workflows folder. It is the one copy of a rule
// that was held four times: dazzer's gate (scripts/checks/check-runner-setting.mjs), dazzer-app's
// verdict test (holdsMoreThanTheCode), this repository's runs-on test and runners' repository
// reader (bin/check-repos-read-setting.mjs). machine-rule/README.md says each rule and the
// decision behind it; this header says how the files are read.
//
//   node machine-rule/judge.mjs --repository <owner>/<name> --visibility <public|private|internal> [--moving] <folder>
//
// Exit 0: nothing refused (a folder with no .github/workflows is said as nothing to judge, never
//         as clean). Exit 1: at least one refusal, each a line
//         `.github/workflows/<file>:<line> jobs.<id>: <why>`. Exit 2: unread (a list here that
//         fails its own check, a folder read as dazzer-io/.github whose origin does not say so,
//         a commit pin GitHub could not be asked about), so the answer is unknown.
//
// READING. Every .yml and .yaml file directly in the folder, read by the yaml package's
// parseDocument (decision 42, as dazzer's gate reads them), its version pinned in package.json
// and package-lock.json and installed with npm ci --ignore-scripts. No hand-written YAML reader
// is kept. A spelling another parser, GitHub's among them, could read another way is refused
// with its line: every error and warning the parser raises (a duplicate key, more than one
// document), an anchor, an alias, a tag, an explicit key, a directive and a merge key (<<), a
// key written twice in another letter case or a key GitHub reads written in another case at the
// top or a job's level, a double-quoted key holding a backslash, a step or block-list entry
// written as a flow, steps: as a flow, a line break this parser does not count (a lone \r,
// U+0085, U+2028, U+2029), a U+FEFF after the file's first character, a control character, a
// ${{ never closed and a backslash inside ${{ }}; and, as dazzer's gate holds the layout its
// other gates read job spans with, jobs: at column zero, each job id plain and two spaces in, the
// spans that line reader gives the same as the parser's, on: triggers two spaces in, and no job
// without an id. A file whose jobs could not be read at all is refused, never passed.
//
// WHAT A JOB READS. Every ${{ }} in every decoded value and key, and every if: written without
// one, is read by GitHub's expression grammar (moved here from runners' reader): literals,
// context references (a.b, a['b'], a.*), calls, !, comparisons, && and ||. A job's machine is
// its runs-on, read route by route: each side of ||, the last side of &&, what fromJSON, format
// and join are given, needs.<job>.outputs (the job reads a setting in an expression of its
// own), matrix.<key> (each value and include row, a matrix written as one expression read
// through the job it names), inputs.<key> (each ./ caller's with:, or the input's default). A
// quoted label may stand only as the final || fallback. vars are read in any case, by name, by
// index, whole or by a computed name; a setting is read where any of those reach it.
//
// THE SHARED REPOSITORY. A folder judged as dazzer-io/.github is that repository only when its
// git origin names exactly dazzer-io/.github on github.com (https or ssh); otherwise it is unread
// (exit 2), and the refusal names the origin's host only, never its whole address, which may
// carry a token (decision 164). Only there may the shared scans' jobs read SCAN_RUNNER_<N>.
//
// THE LISTS. machine-rule/kept.json (the jobs kept on GitHub's computers, each with its effect,
// reason and decision), machine-rule/secrets.json (the secrets a change check may read, per
// repository) and machine-rule/strict.json (the repositories held to dazzer-app's stricter
// class) are read from this folder, never from the repository judged, so a repository cannot
// widen them from its own pull request. The shared workflows a job may call, their grants and
// their inputs are read from this repository's own .github/workflows files beside this one.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCollection, isMap, isPair, isScalar, isSeq, LineCounter, Parser, parseDocument } from 'yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');
export const ORG = 'dazzer-io';
export const SHARED = `${ORG}/.github`;
export const WORKFLOW_DIR = '.github/workflows';

// ================================================================ the facts the rule rests on
// The settings the organisation declares, as runners' org/settings.json names them at 789b335
// (CHECKS_RUNNER_2, 8 and 16, LOCKED_RUNNER_2 and 8, SCAN_RUNNER_2). They are written here
// because a pull request's run of this rule cannot read the private runners repository; a
// setting added there is added here in the same change.
export const DECLARED_SETTINGS = Object.freeze(['CHECKS_RUNNER_2', 'CHECKS_RUNNER_8', 'CHECKS_RUNNER_16', 'LOCKED_RUNNER_2', 'LOCKED_RUNNER_8', 'SCAN_RUNNER_2']);
// A setting's name, as runners' bin/apply-org-settings.mjs parses it.
export const SETTING_NAME = /^(CHECKS|LOCKED|SCAN)_RUNNER_([1-9][0-9]*)$/;
const settingOf = (name) => {
  const m = SETTING_NAME.exec(String(name));
  return m ? { kind: m[1], cores: Number(m[2]) } : null;
};
// Any name of a setting family, declared or not (vars.CHECKS_RUNNER_4 reads empty for ever).
const familyOf = (name) => /^(CHECKS|LOCKED|SCAN)_RUNNER_/i.exec(String(name))?.[1].toUpperCase() ?? null;
// GitHub's standard Linux machines and their cores (dazzer's GITHUB_STANDARD_CORES).
export const GITHUB_STANDARD_CORES = Object.freeze({ 'ubuntu-latest': 2, 'ubuntu-24.04': 2, 'ubuntu-22.04': 2 });
const STANDARD = Object.keys(GITHUB_STANDARD_CORES).join(', ');
export const isStandard = (label) => Object.hasOwn(GITHUB_STANDARD_CORES, String(label));
// GitHub's machines as a setting's fallback may name them: a standard one, or ubuntu-<N>-core.
export const isGitHubMachine = (label) => isStandard(label) || /^ubuntu-\d+-core$/.test(String(label));
export const GITHUB_MACHINE = `${STANDARD}, or a larger one named ubuntu-<N>-core`;
// The labels of our own machines (runners' MACHINE_LABEL).
export const OUR_MACHINE = /^dazzer-(checks|checks-regular|locked|scan)-([1-9][0-9]*)-core$/;
export function coresFromLabel(label) {
  if (isStandard(label)) return GITHUB_STANDARD_CORES[label];
  const m = /(\d+)[-_]?cores?\b/.exec(String(label));
  return m ? Number(m[1]) : null;
}
// The shared workflows of dazzer-io/.github: the two scans (decisions 118, 119), the one a job
// elsewhere may call beside them (engineer-review.yml), and the rule's own workflow, whose
// literal-label jobs kept.json names because other repositories' runs list them (r-1.58).
export const SHARED_SCANS = Object.freeze(['.github/workflows/codeql.yml', '.github/workflows/security-scan.yml']);
export const CALLABLE = Object.freeze([...SHARED_SCANS, '.github/workflows/engineer-review.yml']);
export const SHARED_HOLDING = Object.freeze([...CALLABLE, '.github/workflows/machine-rule.yml']);
const PIN_ADMITTED = '.github/workflows/engineer-review.yml';
const AT_MAIN = new Set(['main', 'refs/heads/main']);
export const SCAN_SHAPE = "${{ vars.SCAN_RUNNER_2 || 'ubuntu-latest' }}";
const MAIN_REF = "github.ref == 'refs/heads/main'";
const LOCKED_SHAPE = /^\$\{\{\s*github\.ref\s*==\s*'refs\/heads\/main'\s*&&\s*vars\.(LOCKED_RUNNER_(\d+))\s*\|\|\s*'([^']+)'\s*\}\}$/;
// The one shape dazzer-app's stricter class exempts beside the literal ubuntu-latest (decision
// 190, as r-3.8 teaches the app's own holdsMoreThanTheCode): LOCKED_SHAPE, any LOCKED_RUNNER_<N>,
// with the literal ubuntu-latest as its fallback, on a workflow no pull-request event starts
// (PULL_REQUEST_EVENTS, below), so a pull request's code never takes the exemption.
const lockedHeldToMain = (machine, prStarted) => typeof machine === 'string' && !prStarted && LOCKED_SHAPE.exec(machine.trim())?.[3] === 'ubuntu-latest';
// Triggers on which github.ref is the default branch whatever started the run.
const DEFAULT_BRANCH_TRIGGERS = Object.freeze(['pull_request_target', 'workflow_run']);
// Triggers beside push that start a run from a tag ref.
export const TAG_TRIGGERS = Object.freeze(['release', 'create', 'deployment', 'deployment_status', 'registry_package']);
// The events that run a pull request's or a merge queue's change.
const PULL_REQUEST_EVENTS = Object.freeze(['pull_request', 'pull_request_target', 'pull_request_review', 'pull_request_review_comment', 'merge_group']);
// The CodeQL steps that run a scan (dazzer's SCANNER_ACTIONS, decision 91).
const SCANNER_ACTIONS = /^github\/codeql-action\/(init|analyze)@/i;
export const EFFECTS = Object.freeze(['stay', 'checks', 'canary']);
// The two canaries, both runners' (decisions 50, 223): canary.yml proves each set that is not
// locked, and locked-canary.yml each locked set, before any setting names it. A canary file names
// only its own kind of set, so a canary cannot carry a locked set past the locked canary's guards.
const CANARY_REPOSITORY = `${ORG}/runners`;
const CANARY_FILES = Object.freeze({ 'canary.yml': false, 'locked-canary.yml': true });
const isCanaryHome = (repository, file) => repository === CANARY_REPOSITORY && Object.hasOwn(CANARY_FILES, file);
const CANARY_WHERE = `${CANARY_REPOSITORY}'s ${Object.keys(CANARY_FILES).map((f) => `.github/workflows/${f}`).join(' and ')}`;
const isLockedSet = (label) => OUR_MACHINE.exec(String(label))?.[1] === 'locked';

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const show = (v) => JSON.stringify(v);
const unique = (xs) => [...new Set(xs)];
const onKeys = (on) => (typeof on === 'string' ? [on] : Array.isArray(on) ? on.map(String) : isObj(on) ? Object.keys(on) : []);

// ================================================================ reading a workflow
// dazzer's gate's reading (decision 42), moved here.

const keyName = (pair) => (isScalar(pair.key) && pair.key.value !== null ? String(pair.key.value) : null);
function pairOf(map, name) {
  if (!isMap(map)) return null;
  return map.items.find((p) => keyName(p) === name) ?? null;
}
const scalarText = (node) => (isScalar(node) && node.value !== null && node.value !== undefined ? String(node.value) : null);
function walk(node, visit) {
  if (!node) return;
  if (isPair(node)) {
    visit.pair?.(node);
    walk(node.key, visit);
    walk(node.value, visit);
  } else if (isScalar(node)) visit.scalar?.(node);
  else if (isCollection(node)) {
    visit.collection?.(node);
    for (const item of node.items) walk(item, visit);
  }
}

// An expression's text with every single-quoted string's inside blanked, its length kept.
function blankStrings(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] !== "'") {
      out += raw[i];
      continue;
    }
    out += "'";
    for (i += 1; i < raw.length; i += 1) {
      if (raw[i] === "'" && raw[i + 1] === "'") {
        out += '  ';
        i += 1;
      } else if (raw[i] === "'") break;
      else out += raw[i] === '\n' ? '\n' : ' ';
    }
    if (i < raw.length) out += "'";
  }
  return out;
}

// Every ${{ }} in a text, taken whole the way GitHub takes it: from ${{ to the first }} outside a
// single-quoted string ('' a quote inside one), with its line, where it stands (at), its text,
// that text with its strings blanked, and whether it closed.
export function expressionsOf(text, firstLine = 1) {
  const found = [];
  const s = String(text);
  let at = s.indexOf('${{');
  while (at !== -1) {
    let i = at + 3;
    let closed = false;
    while (i < s.length) {
      if (s[i] === "'") {
        for (i += 1; i < s.length; i += 1) {
          if (s[i] === "'" && s[i + 1] === "'") i += 1;
          else if (s[i] === "'") break;
        }
        i += 1;
        continue;
      }
      if (s.startsWith('}}', i)) {
        closed = true;
        break;
      }
      i += 1;
    }
    const raw = s.slice(at + 3, i);
    found.push({ line: firstLine + s.slice(0, at).split('\n').length - 1, at, raw, blanked: blankStrings(raw), closed });
    at = closed ? s.indexOf('${{', i + 2) : -1;
  }
  return found;
}
const bareExpression = (raw, line) => ({ line, raw, blanked: blankStrings(raw), closed: true });
const lineAt = (lineCounter, node) => lineCounter.linePos(node?.range?.[0] ?? 0).line;

function expressionsOfScalar(s, lineCounter, text) {
  const start = lineAt(lineCounter, s);
  const decoded = expressionsOf(s.value, start);
  const written = expressionsOf(text.slice(s.range[0], s.range[1]), start);
  const aligned = written.length === decoded.length;
  return decoded.map((e, index) => ({ ...e, line: aligned ? written[index].line : start, scalar: s, written: aligned ? written[index] : null }));
}

// Every expression under a node, read from the values YAML decoded, keys among them, and every
// if: holding no ${{, as a bare expression, since GitHub reads it so.
function expressionsUnder(node, lineCounter, text) {
  const found = [];
  walk(node, {
    scalar(s) {
      if (typeof s.value === 'string') found.push(...expressionsOfScalar(s, lineCounter, text));
    },
    pair(p) {
      if (keyName(p) !== 'if') return;
      const value = scalarText(p.value);
      if (value !== null && value.trim() !== '' && !value.includes('${{')) found.push(bareExpression(value, lineAt(lineCounter, p.value)));
    },
  });
  return found;
}

export function triggersOf(on) {
  if (isScalar(on)) return scalarText(on) === null ? [] : [scalarText(on)];
  if (isSeq(on)) return on.items.map(scalarText).filter((t) => t !== null);
  if (isMap(on)) return on.items.map(keyName).filter((t) => t !== null);
  return [];
}

const PUSH_UNFILTERED = 'a push with no branches: or tags: filter';
function pushReachesTag(filters) {
  if (!isMap(filters)) return PUSH_UNFILTERED;
  const has = (k) => pairOf(filters, k) !== null;
  const named = (k) => {
    const value = pairOf(filters, k)?.value;
    if (isSeq(value)) return value.items.map(scalarText).filter(Boolean);
    const one = scalarText(value);
    return one ? [one] : [];
  };
  if (has('tags')) return named('tags').length > 0 ? `a push of tags ${named('tags').join(', ')}` : 'a push of tags';
  if (has('tags-ignore')) return 'a push of any tag tags-ignore does not name';
  if (has('branches') || has('branches-ignore')) return null;
  if (has('paths') || has('paths-ignore')) return "a push filtered by paths alone, which GitHub does not read for a tag's push";
  return PUSH_UNFILTERED;
}
export function tagStartsOf(on) {
  const named = isMap(on) ? on.items.map((p) => [keyName(p), p.value]) : triggersOf(on).map((t) => [t, null]);
  const starts = [];
  for (const [name, filters] of named) {
    if (name === 'push') {
      const reached = pushReachesTag(filters);
      if (reached) starts.push(reached);
    } else if (TAG_TRIGGERS.includes(name)) starts.push(name);
  }
  return starts;
}

const ANOTHER_PARSER = 'beyond the plain YAML this rule admits, so another parser, GitHub\'s among them, may not read it the way this one does';

function parseFaults(doc) {
  return [...doc.errors, ...doc.warnings].map((e) => {
    const words = e.message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, '');
    return { line: e.linePos?.[0]?.line ?? 1, why: `could not be read as plain YAML: the parser reports ${e.code}, '${words}', ${ANOTHER_PARSER}. Write it so it parses with no error and no warning.` };
  });
}

function beyondThePlainSubset(text, lineCounter) {
  const found = [];
  const say = (offset, why) => found.push({ line: lineCounter.linePos(offset).line, why });
  const restOfLine = (offset) => text.slice(offset).split(/\r?\n/)[0].trim();
  const visit = (token) => {
    if (!token || typeof token !== 'object') return;
    if (Array.isArray(token)) {
      for (const t of token) visit(t);
      return;
    }
    if (token.type === 'anchor') say(token.offset, `writes a YAML anchor, '${token.source}', which carries text from one place to another, ${ANOTHER_PARSER}. Write the value out in full where it is used.`);
    else if (token.type === 'alias') say(token.offset, `writes a YAML alias, '${token.source}', which carries text from one place to another, ${ANOTHER_PARSER}. Write the value out in full where it is used.`);
    else if (token.type === 'tag') say(token.offset, `writes a YAML tag, '${token.source}', which tells the parser how to read the value after it, ${ANOTHER_PARSER}. Write the value without a tag, quoted where it must stay text.`);
    else if (token.type === 'explicit-key-ind') {
      const key = restOfLine(token.offset).replace(/^\?\s*/, '').split(/\s*:(?:\s|$)|[,{}[\]]/)[0].trim();
      say(token.offset, `writes an explicit key, '? ${key}', a key marked by ? with its value after a : of its own, ${ANOTHER_PARSER}. Write the key plainly, ${key}: and its value after it on the same line.`);
    } else if (token.type === 'directive') say(token.offset, `writes a YAML directive, '${restOfLine(token.offset)}', which changes how the parser reads the document, ${ANOTHER_PARSER}. Remove it.`);
    for (const k of ['start', 'key', 'sep', 'value', 'end', 'items', 'props']) if (k in token) visit(token[k]);
  };
  for (const token of new Parser().parse(text)) visit(token);
  return found;
}

// Keys a reader may take another way: a merge key (<<), which YAML 1.1 readers merge and this
// one reads as a key; a double-quoted key holding a backslash (an escaped key, "permissions"
// decodes to permissions); at the top and at a job's level, a key written twice in any case, and
// a key GitHub reads written in another case.
const TOP_KEYS = ['name', 'run-name', 'on', 'permissions', 'env', 'defaults', 'concurrency', 'jobs'];
const JOB_KEYS = ['name', 'permissions', 'needs', 'if', 'runs-on', 'environment', 'concurrency', 'outputs', 'env', 'defaults', 'steps', 'timeout-minutes', 'strategy', 'continue-on-error', 'container', 'services', 'uses', 'with', 'secrets'];
function oddKeys(root, jobsMap, lineCounter) {
  const found = [];
  walk(root, {
    pair(p) {
      const name = keyName(p);
      if (name === '<<') found.push({ line: lineAt(lineCounter, p.key), why: `writes a merge key, '<<', which a YAML 1.1 reader merges into the map around it and this parser reads as a key of its own, ${ANOTHER_PARSER}. Write each key out in full.` });
    },
  });
  const levels = [[root, TOP_KEYS, 'at the top'], [jobsMap, null, 'among the jobs'], ...(jobsMap?.items ?? []).map((pair) => [isMap(pair.value) ? pair.value : null, JOB_KEYS, `in the job ${keyName(pair)}`])];
  for (const [map, known, where] of levels) {
    if (!isMap(map)) continue;
    const seen = new Map();
    for (const p of map.items) {
      const name = keyName(p);
      if (name === null) continue;
      const lower = name.toLowerCase();
      const line = lineAt(lineCounter, p.key);
      if (seen.has(lower) && seen.get(lower) !== name) found.push({ line, why: `writes the key ${name} ${where} again in another letter case (${seen.get(lower)} stands above it), which a reader that ignores case reads as one key and this one as two. Write each key once.` });
      if (!seen.has(lower)) seen.set(lower, name);
      if (known && known.includes(lower) && name !== lower) found.push({ line, why: `writes the key ${name} ${where}, a key GitHub reads as ${lower}, in another letter case, so this rule and GitHub may not read the same key. Write it in lower case, ${lower}:.` });
    }
  }
  return found;
}
function escapedKeys(text, lineCounter, doc) {
  const found = [];
  walk(doc.contents, {
    pair(p) {
      if (!isScalar(p.key) || p.key.type !== 'QUOTE_DOUBLE') return;
      const written = text.slice(p.key.range[0], p.key.range[1]);
      if (written.includes('\\')) found.push({ line: lineAt(lineCounter, p.key), why: `writes a quoted key with a backslash, ${written}, whose escape the parser decodes (to ${show(String(p.key.value))}), ${ANOTHER_PARSER}. Write the key plainly.` });
    },
  });
  return found;
}

function flowSteps(root, lineCounter) {
  const found = [];
  const entries = (seq, key) => {
    for (const item of seq.items) {
      if (!isCollection(item) || !item.flow) continue;
      const shown = `'- ${isMap(item) ? '{' : '['} ... '`;
      found.push({
        line: lineAt(lineCounter, item),
        why: key === 'steps'
          ? `writes a step as a flow, ${shown}, ${ANOTHER_PARSER}. Write each step as a block, - then one key a line.`
          : `writes an entry of the block list ${key === null ? '' : `under ${key}: `}as a flow, ${shown}, ${ANOTHER_PARSER}. Write the entry as a block, - then one key a line.`,
      });
    }
  };
  walk(root, {
    pair(p) {
      if (isSeq(p.value) && !p.value.flow) entries(p.value, keyName(p));
      if (keyName(p) === 'steps' && isCollection(p.value) && p.value.flow) found.push({ line: lineAt(lineCounter, p.key), why: `writes steps: as a flow, 'steps: [ ... ]', ${ANOTHER_PARSER}. Write each step as a block, - then one key a line.` });
    },
    collection(c) {
      if (!isSeq(c) || c.flow) return;
      for (const item of c.items) if (isSeq(item) && !item.flow) entries(item, null);
    },
  });
  return found;
}

function unreadableExpressions(expressions, lineCounter, text) {
  const found = [];
  const backslash = (e) => {
    const shown = `\${{${e.raw.replace(/\s+/g, ' ')}}}`;
    found.push({ line: e.line, why: `holds a \\ inside \${{ }}, '${shown}'. GitHub's expressions have no escapes, so a \\ there stands for something a YAML reader decodes (\\u005F in a double-quoted value is _), and two readers that decode it differently would read a different setting or secret. Write the expression without a backslash.` });
  };
  const mixed = new Set();
  for (const e of expressions) {
    if (!e.closed) {
      found.push({ line: e.line, why: 'opens ${{ with no closing }}, so where the expression ends could not be read. Close it with }}.' });
      continue;
    }
    if (e.scalar?.type === 'QUOTE_DOUBLE' && !e.written) mixed.add(e.scalar);
    else if (e.written?.raw.includes('\\')) backslash(e.written);
    else if (e.raw.includes('\\')) backslash(e);
  }
  for (const s of mixed) mixedBackslashes(s, lineCounter, text, backslash);
  return found;
}
function decodedOffset(source, offset) {
  const doc = parseDocument(`${source.slice(0, offset)}"`);
  if (doc.errors.length > 0 || !isScalar(doc.contents) || typeof doc.contents.value !== 'string') return null;
  return doc.contents.value.length;
}
function mixedBackslashes(s, lineCounter, text, backslash) {
  const source = text.slice(s.range[0], s.range[1]);
  const start = lineAt(lineCounter, s);
  const decoded = expressionsOf(s.value, start);
  const ends = decoded.map((d) => d.at + 3 + d.raw.length + (d.closed ? 2 : 0));
  const twins = new Map();
  const held = new Set();
  for (const w of expressionsOf(source, start)) {
    const at = decodedOffset(source, w.at);
    const index = at === null ? -1 : decoded.findIndex((d, i) => d.at <= at && at < ends[i]);
    if (index === -1) {
      if (w.closed && w.raw.includes('\\')) backslash(w);
      continue;
    }
    if (decoded[index].at === at) twins.set(index, w);
    if (w.raw.includes('\\')) held.add(index);
  }
  decoded.forEach((d, i) => {
    if (!d.closed || (!d.raw.includes('\\') && !held.has(i))) return;
    const twin = twins.get(i);
    if (twin?.closed) backslash(twin);
    else backslash({ ...d, line: twin ? twin.line : start });
  });
}

const LIBYAML = "libyaml (0.2.5 through PyYAML 6.0.3 and 0.2.1 through Ruby's psych 3.1.0, both run)";
const YAMLDOTNET = "YamlDotNet (5.3.0, the version actions/runner's src/Sdk/Sdk.csproj names, read in its source, not run)";
const NOT_GITHUB = "GitHub's own parser was neither read nor run";
const RUNS_ON = 'so a comment before it runs on, for this parser, over what those readers read as the next line';
const OTHER_BREAKS = Object.freeze([
  ['\r', 'a carriage return not followed by a line feed (\\r)', `which YAML counts as a line break, in 1.2 as in 1.1, and so do ${LIBYAML} and ${YAMLDOTNET}, while this parser does not (${NOT_GITHUB}), ${RUNS_ON}`],
  ...[[0x85, 'a next-line character (U+0085)'], [0x2028, 'a line separator (U+2028)'], [0x2029, 'a paragraph separator (U+2029)']].map(([code, name]) => [
    String.fromCharCode(code), name,
    `which YAML 1.1 counts as a line break, and so do ${LIBYAML} and ${YAMLDOTNET}, while YAML 1.2, which counts \\n and \\r alone, and this parser do not (${NOT_GITHUB}), ${RUNS_ON}`,
  ]),
]);
const LIBYAML_BREAKS = Object.freeze(['\n', ...OTHER_BREAKS.map(([ch]) => ch)]);
const BOM = String.fromCharCode(0xfeff);
const BOM_FIX = 'Remove it: a byte order mark may open the file and stand nowhere else.';
const FIRST_COLUMN_BOM = `writes a byte order mark (U+FEFF) at the start of a line, after the file's first character. This parser reads it as part of the key or value beside it, while ${LIBYAML} skipped one in a line's first column and counted the column on by one, so the two read the line differently: '<U+FEFF> pull_request_target:' under on: was a trigger to libyaml and a top key to this parser (${NOT_GITHUB}). ${BOM_FIX}`;
const IN_A_LINE_BOM = `writes a byte order mark (U+FEFF) inside a line, which ${LIBYAML} and this parser read alike there, as part of the key or value beside it; it is refused all the same, so that no reader's handling of one is relied on (${NOT_GITHUB}). ${BOM_FIX}`;
// A control character YAML does not print (C0 but tab, line feed and carriage return; DEL; C1
// but U+0085, a break above), which a reader that refuses unprintable text (libyaml) would not
// read at all, while this parser keeps it in the value (this repository's runs-on test, round 4).
const CONTROL = (c) => {
  const n = c.charCodeAt(0);
  return (n < 0x20 && c !== '\t' && c !== '\n' && c !== '\r') || n === 0x7f || (n >= 0x80 && n <= 0x9f && n !== 0x85);
};
const hex = (c) => `U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

function otherLineBreaksAndMarks(text) {
  const found = [];
  const said = new Set();
  let line = 1;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '\n') {
      line += 1;
      continue;
    }
    if (c === '\r' && text[i + 1] === '\n') continue;
    if (c === BOM && i > 0 && !said.has(`${line}:${c}`)) {
      said.add(`${line}:${c}`);
      const column = i - (Math.max(...LIBYAML_BREAKS.map((b) => text.lastIndexOf(b, i - 1))) + 1);
      found.push({ line, why: column === 0 ? FIRST_COLUMN_BOM : IN_A_LINE_BOM });
      continue;
    }
    if (CONTROL(c) && !said.has(`${line}:${c}`)) {
      said.add(`${line}:${c}`);
      found.push({ line, why: `writes the control character ${hex(c)}, which YAML does not print: a reader that refuses unprintable text (${LIBYAML}) would not read the file at all, while this parser keeps it in the value. Remove it.` });
      continue;
    }
    const kind = OTHER_BREAKS.find(([ch]) => ch === c);
    if (!kind || said.has(`${line}:${c}`)) continue;
    said.add(`${line}:${c}`);
    found.push({ line, why: `writes ${kind[1]}, ${kind[2]}. Write a plain line break (\\n, or \\r\\n) instead.` });
  }
  return found;
}

// The line reader dazzer's other gates read a job's span through (its
// scripts/lib/workflow-jobs.mjs extractJobs, the same two patterns): a job runs from its id line,
// two spaces in, to the line before the next one. The layout refusals below keep this rule and
// that reader reading the same jobs.
export const JOB_ID_LINE = /^ {2}([a-zA-Z0-9_-]+):\s*(?:#.*)?$/;
const PLAIN_JOBS_LINE = /^jobs:\s*(?:#.*)?$/;
function lineJobs(lines) {
  const jobsIdx = lines.findIndex((line) => PLAIN_JOBS_LINE.test(line));
  if (jobsIdx === -1) return [];
  const blocks = [];
  let i = jobsIdx + 1;
  while (i < lines.length) {
    const match = lines[i].match(JOB_ID_LINE);
    if (!match || lines[i].trimStart().startsWith('#')) {
      i++;
      continue;
    }
    const startIdx = i;
    i++;
    while (i < lines.length && !(JOB_ID_LINE.test(lines[i]) && !lines[i].trimStart().startsWith('#'))) i++;
    blocks.push({ id: match[1], start: startIdx + 1, end: i });
  }
  return blocks;
}
const LINE_READER = "the line reader dazzer's other gates read a job's span through (scripts/lib/workflow-jobs.mjs there)";

function jobSpansDiffer(jobs, stray, shared, jobsPair, root, lines, lineCounter) {
  const LAYOUT = 'Write jobs: at column zero after every other key at the top, each job id two spaces in and plain.';
  const after = root.items[root.items.indexOf(jobsPair) + 1];
  const jobsEnd = after ? lineAt(lineCounter, after.key ?? after.value) - 1 : lines.length;
  const folded = new Set(stray.map((s) => s.line));
  const plain = jobs.filter((j) => !folded.has(j.line));
  const here = plain.map((j, i) => ({ id: j.id, start: j.line, end: i + 1 < plain.length ? plain[i + 1].line - 1 : jobsEnd }));
  const found = [];
  for (const h of here) {
    const s = shared.find((x) => x.id === h.id && x.start === h.start);
    if (!s) found.push({ line: h.start, why: `holds the job ${h.id}, which ${LINE_READER} does not find, so those gates judge this workflow without it. ${LAYOUT}` });
    else if (s.end !== h.end) found.push({ line: h.start, why: `holds the job ${h.id} on lines ${h.start}-${h.end}, where ${LINE_READER} reads it on lines ${s.start}-${s.end}, so those gates judge other text as this job. ${LAYOUT}` });
  }
  for (const s of shared) if (!here.some((h) => h.id === s.id && h.start === s.start)) found.push({ line: s.start, why: `holds no job ${s.id}, where ${LINE_READER} reads one, so those gates judge a job YAML does not hold. ${LAYOUT}` });
  return found;
}

function onMisindented(onPair, lineCounter) {
  if (!onPair || !isMap(onPair.value) || onPair.value.flow || onPair.value.items.length === 0) return [];
  const first = onPair.value.items[0].key;
  if (!first) return [];
  const indent = lineCounter.linePos(first.range[0]).col - 1;
  if (indent === 2) return [];
  return [{ line: lineAt(lineCounter, onPair.key), why: `on: lists its triggers ${indent} spaces in, not two, the layout the line readers of dazzer's other gates are proven on. Write each trigger two spaces in.` }];
}

const plainIdSpelling = (id) => (/^[a-zA-Z0-9_-]+$/.test(id) ? `Write it plainly, '  ${id}:'.` : 'Write it plainly: an id of letters, digits, - and _ alone, two spaces in, then a colon.');

// A workflow read: its decoded data (js), each job with its line, its runs-on's line, its text
// as written and its decoded data, the top's expressions, and every spelling refused (misread,
// each { line, why }). hasJobs is false where no job could be read at all.
export function readWorkflow(text) {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter });
  const lines = text.split(/\r?\n/);
  const root = isMap(doc.contents) && !doc.contents.flow ? doc.contents : null;
  const onPair = pairOf(root, 'on');
  const jobsPair = pairOf(root, 'jobs');
  const jobsMap = jobsPair && isMap(jobsPair.value) && !jobsPair.value.flow && jobsPair.value.items.length > 0 ? jobsPair.value : null;
  const topNodes = root ? root.items.filter((p) => p !== jobsPair) : [];
  const topExpressions = topNodes.flatMap((p) => expressionsUnder(p, lineCounter, text));
  const unnamed = [];
  const named = (jobsMap?.items ?? []).filter((pair) => {
    const id = keyName(pair);
    if (id !== null && id !== '') return true;
    const line = lineAt(lineCounter, pair.key ?? pair.value ?? jobsPair.key);
    unnamed.push({ line, why: `writes a job under jobs: with no id, '${(lines[line - 1] ?? '').trim()}', so this rule cannot name it or judge its machine. Give the job a plain id, two spaces in.` });
    return false;
  });
  let js = null;
  try {
    js = doc.toJS({ maxAliasCount: 100 });
  } catch {
    js = null;
  }
  const jobs = named.map((pair) => {
    const node = isMap(pair.value) ? pair.value : null;
    const runsOnPair = pairOf(node, 'runs-on');
    const id = keyName(pair);
    const end = pair.value?.range?.[2] ?? pair.value?.range?.[1] ?? pair.key.range[1];
    return {
      id,
      line: lineAt(lineCounter, pair.key),
      node,
      js: isObj(js?.jobs) ? js.jobs[id] : undefined,
      runsOnLine: runsOnPair ? lineAt(lineCounter, runsOnPair.key) : null,
      text: text.slice(pair.key.range[0], end),
      expressions: expressionsUnder(pair, lineCounter, text),
    };
  });
  const spans = lineJobs(lines);
  const stray = jobs.filter((j) => !JOB_ID_LINE.test(lines[j.line - 1] ?? '')).map((j) => ({
    line: j.line, id: j.id, text: (lines[j.line - 1] ?? '').trim(),
    into: spans.find((b) => b.start <= j.line && j.line <= b.end)?.id ?? null,
  }));
  const jobsLine = jobsPair ? lineAt(lineCounter, jobsPair.key) : 0;
  const jobsKeyMisread = jobsPair && !PLAIN_JOBS_LINE.test(lines[jobsLine - 1] ?? '')
    ? [{ line: jobsLine, why: `writes the jobs key as '${(lines[jobsLine - 1] ?? '').trim()}', not jobs: at column zero, so ${LINE_READER} finds no jobs in this workflow. Write it plainly, jobs: at column zero.` }]
    : [];
  const strayLines = stray.map((s) => ({
    line: s.line,
    why: `under jobs: '${s.text}' is not a plain job id (letters, digits, - and _, then a colon, two spaces in), so ${LINE_READER} ${s.into === null ? 'would read no job there and leave its lines in no job' : `would fold the job it starts into the job above it, ${s.into}`}. ${plainIdSpelling(s.id)}`,
  }));
  const misread = [
    ...otherLineBreaksAndMarks(text),
    ...parseFaults(doc),
    ...jobsKeyMisread,
    ...(jobsMap && root && jobsKeyMisread.length === 0 ? jobSpansDiffer(jobs, stray, spans, jobsPair, root, lines, lineCounter) : []),
    ...unnamed,
    ...strayLines,
    ...beyondThePlainSubset(text, lineCounter),
    ...oddKeys(root, jobsMap, lineCounter),
    ...escapedKeys(text, lineCounter, doc),
    ...flowSteps(doc.contents, lineCounter),
    ...unreadableExpressions([...topExpressions, ...jobs.flatMap((j) => j.expressions)], lineCounter, text),
    ...onMisindented(onPair, lineCounter),
  ].sort((a, b) => a.line - b.line);
  const topLines = new Map();
  if (root) {
    for (const p of topNodes) {
      const name = keyName(p);
      if (name === null) continue;
      const from = p.key.range[0];
      const to = p.value?.range?.[2] ?? p.value?.range?.[1] ?? p.key.range[1];
      topLines.set(name, text.slice(text.lastIndexOf('\n', from) + 1, to));
    }
  }
  return {
    js: isObj(js) ? js : null,
    triggers: triggersOf(onPair?.value),
    tagStarts: tagStartsOf(onPair?.value),
    topExpressions,
    topText: topLines,
    jobs,
    misread,
    hasJobs: jobsMap !== null && isObj(js) && isObj(js.jobs),
  };
}

// ================================================================ the expression inside ${{ }}
// GitHub's expression grammar, as far as judging a machine needs (runners' reader, moved here).
export class ExpressionError extends Error {}

function tokensOf(body) {
  const out = [];
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'") {
      let v = '';
      i++;
      for (;;) {
        if (i >= body.length) throw new ExpressionError('a quoted text never closes');
        if (body[i] === "'") {
          if (body[i + 1] === "'") { v += "'"; i += 2; continue; }
          i++;
          break;
        }
        v += body[i++];
      }
      out.push({ t: 'str', v });
      continue;
    }
    const two = body.slice(i, i + 2);
    if (['||', '&&', '==', '!=', '<=', '>='].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    const num = /^-?(?:0x[0-9a-fA-F]+|\d+(?:\.\d*)?(?:e[+-]?\d+)?)/i.exec(body.slice(i));
    if (num) { out.push({ t: 'num', v: num[0] }); i += num[0].length; continue; }
    if ('!<>()[],.*'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(body.slice(i));
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    throw new ExpressionError(`it cannot read ${JSON.stringify(c)}`);
  }
  return out;
}

export function parseExpression(body) {
  const toks = tokensOf(body);
  let i = 0;
  const peek = (v) => toks[i] && toks[i].t === 'op' && toks[i].v === v;
  const take = (v) => {
    if (!peek(v)) throw new ExpressionError(`it expected ${v}${toks[i] ? ` before ${JSON.stringify(toks[i].v)}` : ' at the end'}`);
    i++;
  };
  const chain = (kind, op, next) => {
    const ops = [next()];
    while (peek(op)) { i++; ops.push(next()); }
    return ops.length === 1 ? ops[0] : { t: kind, ops };
  };
  const or = () => chain('or', '||', and);
  const and = () => chain('and', '&&', cmp);
  const cmp = () => {
    let left = unary();
    while (toks[i] && toks[i].t === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(toks[i].v)) {
      i++;
      left = { t: 'cmp', ops: [left, unary()] };
    }
    return left;
  };
  const unary = () => {
    if (peek('!')) { i++; return { t: 'not', of: unary() }; }
    return postfix();
  };
  const postfix = () => {
    let node = primary();
    for (;;) {
      if (peek('.')) {
        i++;
        if (peek('*')) { i++; node = node.t === 'ref' ? { t: 'ref', path: [...node.path, '*'] } : { t: 'index', base: node }; continue; }
        const tok = toks[i];
        if (!tok || tok.t !== 'id') throw new ExpressionError('a . is followed by no name');
        i++;
        node = node.t === 'ref' ? { t: 'ref', path: [...node.path, tok.v] } : { t: 'index', base: node };
        continue;
      }
      if (peek('[')) {
        i++;
        const key = or();
        take(']');
        node = node.t === 'ref' && key.t === 'str' ? { t: 'ref', path: [...node.path, key.v] } : { t: 'index', base: node, key };
        continue;
      }
      return node;
    }
  };
  const primary = () => {
    const tok = toks[i];
    if (!tok) throw new ExpressionError('it ends where a value should be');
    if (tok.t === 'str') { i++; return { t: 'str', v: tok.v }; }
    if (tok.t === 'num') { i++; return { t: 'value', text: tok.v }; }
    if (tok.t === 'op' && tok.v === '(') { i++; const inner = or(); take(')'); return inner; }
    if (tok.t === 'id') {
      i++;
      if (['true', 'false', 'null', 'NaN', 'Infinity'].includes(tok.v)) return { t: 'value', text: tok.v };
      if (peek('(')) {
        i++;
        const args = [];
        if (!peek(')')) { args.push(or()); while (peek(',')) { i++; args.push(or()); } }
        take(')');
        return { t: 'call', name: tok.v, args };
      }
      return { t: 'ref', path: [tok.v] };
    }
    throw new ExpressionError(`it cannot read ${JSON.stringify(tok.v)} where a value should be`);
  };
  const tree = or();
  if (i < toks.length) throw new ExpressionError(`it reads past the end at ${JSON.stringify(toks[i].v)}`);
  return tree;
}

// Every reference an expression tree holds, each a path. An index straight into a context
// (vars[format(...)]) reads it by a computed name; into a named part of one
// (vars.CHECKS_RUNNER_8[0]) it reads that part.
function refsOf(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.t === 'ref') out.push({ path: node.path });
  else if (node.t === 'index') {
    if (node.base?.t === 'ref') out.push(node.base.path.length === 1 ? { path: node.base.path, computed: true } : { path: node.base.path });
    else refsOf(node.base, out);
    refsOf(node.key, out);
  } else if (node.t === 'not') refsOf(node.of, out);
  else if (node.t === 'call') for (const a of node.args) refsOf(a, out);
  else if (Array.isArray(node.ops)) for (const o of node.ops) refsOf(o, out);
  return out;
}

// The text of an expression the parser cannot read: every setting name it holds, by
// SETTING_NAME's own pattern in any case, and vars named whole.
const SETTING_TEXT = new RegExp(SETTING_NAME.source.replace(/^\^/, '').replace(/\$$/, ''), 'gi');
const VARS_WHOLE_TEXT = /(?<![\w.-])vars(?![\w-])(?!\s*(?:\.\s*[A-Za-z_]|\[\s*'))/i;
export const VARS_WHOLE = '(vars read whole or by a computed name)';

// Every expression body in a decoded value: each ${{ }} of each string, keys too, and each if:
// written without one.
function bodiesIn(x) {
  const bodies = [];
  const visit = (v, key) => {
    if (typeof v === 'string') {
      if (key === 'if' && !v.includes('${{')) bodies.push({ raw: v, closed: true });
      else bodies.push(...expressionsOf(v));
    } else if (Array.isArray(v)) v.forEach((e) => visit(e));
    else if (isObj(v)) for (const [k, e] of Object.entries(v)) { visit(k); visit(e, k); }
  };
  visit(x);
  return bodies;
}

// What a part of a workflow reads of the settings, through the one expression reader:
//   settings: the declared setting names it reads as the route reader reads them (vars.X or
//             vars['X'], X as written), for a job whose outputs another job's runs-on reads;
//   families: every CHECKS_, LOCKED_ and SCAN_ name it may reach, in capitals, by family, by any
//             spelling or case, declared or not;
//   whole:    vars read whole (toJSON(vars), vars.*) or by a computed name (vars[format(...)]),
//             which may reach any of them;
//   scans:    the SCAN_ names, and VARS_WHOLE where vars is read whole (runners' scan reads).
export function settingReadsIn(x) {
  const settings = new Set();
  const families = { CHECKS: new Set(), LOCKED: new Set(), SCAN: new Set() };
  let whole = false;
  for (const { raw } of bodiesIn(x)) {
    let tree;
    try {
      tree = parseExpression(raw);
    } catch (e) {
      if (!(e instanceof ExpressionError)) throw e;
      for (const m of String(raw).matchAll(SETTING_TEXT)) families[m[1].toUpperCase()].add(m[0].toUpperCase());
      for (const m of String(raw).matchAll(/(?:CHECKS|LOCKED|SCAN)_RUNNER_\w*/gi)) families[familyOf(m[0])].add(m[0].toUpperCase());
      if (VARS_WHOLE_TEXT.test(String(raw))) whole = true;
      continue;
    }
    for (const r of refsOf(tree)) {
      const [head, name] = r.path;
      if (String(head).toLowerCase() !== 'vars') continue;
      if (r.computed || name === undefined || name === '*') { whole = true; continue; }
      if (head === 'vars' && settingOf(name)) settings.add(name);
      const family = familyOf(name);
      if (family) families[family].add(String(name).toUpperCase());
    }
  }
  const scans = [...families.SCAN].sort();
  if (whole) scans.push(VARS_WHOLE);
  return { settings: [...settings], families, whole, scans };
}

// How a context is read inside expressions, their strings blanked so a word in a string is
// never a read: by name, by a name worked out as it runs, or whole (dazzer's contextReads).
// The context counts only as itself, never as a property (inputs.secrets reads no secret).
export function contextReads(expressions, ctx) {
  const names = [];
  let computed = false;
  let whole = false;
  for (const { raw, blanked } of expressions) {
    for (const m of blanked.matchAll(new RegExp(`(?<![\\w.-])${ctx}(?![\\w-])`, 'gi'))) {
      const from = m.index + m[0].length;
      const after = blanked.slice(from);
      const dot = /^\s*\.\s*([A-Za-z_][\w-]*)/.exec(after);
      const bracket = /^(\s*\[\s*')( *)'\s*\]/.exec(after);
      if (dot) names.push(dot[1].toUpperCase());
      else if (bracket) {
        const start = from + bracket[1].length;
        names.push(raw.slice(start, start + bracket[2].length).replace(/''/g, "'").toUpperCase());
      } else if (/^\s*\[/.test(after)) computed = true;
      else whole = true;
    }
  }
  return { names: unique(names), computed, whole };
}
const expressionsInData = (x) => bodiesIn(x).map((b) => ({ raw: b.raw, blanked: blankStrings(b.raw) }));

// ================================================================ the route reader
const exprWhole = (s) => s.startsWith('${{') && s.endsWith('}}') && s.lastIndexOf('${{') === 0;

class Routes {
  constructor({ workflows, shared }) {
    this.shared = shared;
    this.byPath = new Map(workflows.map((w) => [w.path, w]));
    this.callers = new Map();
    for (const w of workflows) {
      for (const [id, job] of Object.entries(w.jobs)) {
        if (!isObj(job) || typeof job.uses !== 'string') continue;
        const m = /^[.$]\/([^@]+)$/.exec(job.uses);
        if (!m) continue;
        if (!this.callers.has(m[1])) this.callers.set(m[1], []);
        this.callers.get(m[1]).push({ wf: w, id, job });
      }
    }
  }

  isSharedScan(w) {
    return this.shared && SHARED_SCANS.includes(w.path);
  }

  scanWords(names) {
    return `${names.join(', ')}, a scan setting: the scan runner group gives a machine to the shared scans in ${SHARED} alone (${SHARED_SCANS.join(', ')}), so this job would wait for a scan machine it is never given`;
  }

  // A runs-on (or a value handed to one) judged: { ok, why, how, reached: [{ name, kind }] }.
  runsOn(value, ctx, depth) {
    if (typeof value === 'string') {
      const s = value.trim();
      if (!s.includes('${{')) return { ok: false, literal: s, why: `runs-on ${show(s)} names a machine literally` };
      if (!exprWhole(s)) return { ok: false, why: `runs-on ${show(s)} names text outside its expression` };
      return this.expression(s.slice(3, -2), ctx, depth);
    }
    if (Array.isArray(value)) return { ok: false, why: `runs-on lists labels ${show(value)} literally, a list of labels this rule does not read as one machine` };
    if (isObj(value)) return { ok: false, why: `runs-on names a runner group or labels literally (${show(value)}), which this rule does not read as one machine` };
    return { ok: false, why: `runs-on ${show(value)} names a machine literally` };
  }

  expression(body, ctx, depth) {
    if (depth > 6) return { ok: false, why: 'its machine is passed through too many hands to read' };
    let tree;
    try {
      tree = parseExpression(body);
    } catch (e) {
      if (!(e instanceof ExpressionError)) throw e;
      return { ok: false, why: `runs-on \${{${body}}} is an expression it cannot read (${e.message})` };
    }
    let ops = [tree];
    let fallback = null;
    if (tree.t === 'or' && tree.ops.length > 1 && tree.ops[tree.ops.length - 1].t === 'str') {
      fallback = tree.ops[tree.ops.length - 1].v;
      ops = tree.ops.slice(0, -1);
    }
    const problems = [];
    if (fallback !== null && !isGitHubMachine(fallback)) {
      problems.push(`its fallback '${fallback}' is not GitHub's machine (${GITHUB_MACHINE}): the fallback is where the job runs while the setting is empty, before its machines exist and after the watcher empties it, so a label of one of our own sets there puts the job on that set with no setting naming it`);
    }
    const inner = { ...ctx, fallback: fallback ?? ctx.fallback ?? null };
    const routes = [];
    const reached = [];
    let scan = false;
    for (const r of ops.flatMap((op) => this.routesOf(op, inner, depth))) {
      if (r.kind === 'setting') {
        routes.push(r.how);
        reached.push(...r.reached);
        if (r.direct) {
          const label = inner.fallback;
          const { name, cores } = r.direct;
          if (label === null) problems.push(`it reads ${name} with no fallback after ||, so while ${name} is empty the job has no machine at all. Write \${{ vars.${name} || '${cores === 2 ? 'ubuntu-latest' : `ubuntu-${cores}-core`}' }}`);
          else if (isGitHubMachine(label) && coresFromLabel(label) !== cores) problems.push(`it reads ${name}, a ${cores}-core machine, but its fallback '${label}' has ${coresFromLabel(label)} cores, so the job would run on a different width depending on the setting. Read ${name.replace(/_\d+$/, `_${coresFromLabel(label)}`)}`);
        }
      } else if (r.kind === 'literal') problems.push(`its expression names ${show(r.v)} literally on a route of its own; a machine name may only be the final || fallback after a setting`);
      else { problems.push(r.why); scan ||= r.scan === true; }
    }
    if (problems.length) return { ok: false, why: unique(problems).join('; '), ...(scan ? { scan } : {}) };
    if (!routes.length) return { ok: false, why: `runs-on \${{${body}}} is an expression that reads no CHECKS_RUNNER_<N>, LOCKED_RUNNER_<N> or SCAN_RUNNER_<N> setting` };
    if (fallback !== null) routes.push(`falls back to ${show(fallback)} after it`);
    return { ok: true, how: unique(routes).join('; '), reached };
  }

  routesOf(node, ctx, depth) {
    switch (node.t) {
      case 'or': return node.ops.flatMap((op) => this.routesOf(op, ctx, depth));
      case 'and': return this.routesOf(node.ops[node.ops.length - 1], ctx, depth);
      case 'str': return [{ kind: 'literal', v: node.v }];
      case 'value': return [{ kind: 'problem', why: `its expression gives ${node.text}, which is no machine` }];
      case 'cmp':
      case 'not': return [{ kind: 'problem', why: 'its expression gives a true/false comparison, which is no machine' }];
      case 'call': {
        const name = node.name.toLowerCase();
        if (name === 'fromjson' || name === 'format' || name === 'join') return node.args.flatMap((a) => this.routesOf(a, ctx, depth));
        return [{ kind: 'problem', why: `its expression gives ${node.name}(), which is no machine setting` }];
      }
      case 'index': return node.base?.t === 'ref' && String(node.base.path[0]).toLowerCase() === 'vars' ? [this.leaf([...node.base.path, '*'], ctx, depth)] : this.routesOf(node.base, ctx, depth);
      case 'ref': return [this.leaf(node.path, ctx, depth)];
      default: return [{ kind: 'problem', why: 'its expression has a part it cannot read' }];
    }
  }

  leaf(path, ctx, depth) {
    const [head, second] = path;
    const text = path.join('.');
    const judged = (r) => (r.ok ? { kind: 'setting', how: r.how, reached: r.reached ?? [] } : { kind: 'problem', why: r.why, ...(r.scan ? { scan: true } : {}) });
    const shared = this.isSharedScan(ctx.wf);
    if (String(head).toLowerCase() === 'vars' && !shared) {
      const whole = second === undefined || second === '*';
      const scanName = !whole && settingOf(String(second).toUpperCase())?.kind === 'SCAN' ? String(second).toUpperCase() : null;
      if (whole || scanName) return { kind: 'problem', scan: true, why: `its expression gives ${text}, which reaches ${this.scanWords([scanName ?? VARS_WHOLE])}` };
    }
    if (head === 'vars' && path.length === 2 && settingOf(second)) {
      const s = settingOf(second);
      if (DECLARED_SETTINGS.includes(second)) return { kind: 'setting', how: `reads ${second}`, direct: { name: second, cores: s.cores }, reached: [{ name: second, kind: s.kind }] };
      return { kind: 'problem', why: `reads ${second}, which the organisation does not declare (runners' org/settings.json: ${DECLARED_SETTINGS.join(', ')}), so it is empty for ever` };
    }
    if (head === 'needs' && second && path[2] === 'outputs') {
      const src = ctx.wf.jobs[second];
      if (!src) return { kind: 'problem', why: `reads needs.${second}.outputs, and the workflow has no job ${second}` };
      const reads = settingReadsIn(src);
      const scans = shared ? [] : reads.scans;
      if (scans.length) return { kind: 'problem', scan: true, why: `reads needs.${second}.outputs, and job ${second} reads no CHECKS_RUNNER_<N>, LOCKED_RUNNER_<N> or SCAN_RUNNER_<N> setting that gives it a machine: it reads ${this.scanWords(scans)}` };
      const declared = reads.settings.filter((n) => DECLARED_SETTINGS.includes(n));
      if (declared.length) return { kind: 'setting', how: `reads job ${second}'s outputs, and ${second} reads a machine setting`, reached: declared.map((n) => ({ name: n, kind: settingOf(n).kind })) };
      return { kind: 'problem', why: `reads needs.${second}.outputs, and job ${second} reads no CHECKS_RUNNER_<N>, LOCKED_RUNNER_<N> or SCAN_RUNNER_<N> setting` };
    }
    if (head === 'matrix' && second) return judged(this.matrix(second, ctx, depth));
    if (head === 'inputs' && second) return judged(this.input(second, ctx, depth));
    return { kind: 'problem', why: `its expression gives ${text}, which is no CHECKS_RUNNER_<N>, LOCKED_RUNNER_<N> or SCAN_RUNNER_<N> setting` };
  }

  // Every value a matrix gives <key>: its own list and each include row; one written as an
  // expression is read through what it names.
  matrixValues(k, job) {
    const m = isObj(job?.strategy) ? job.strategy.matrix : undefined;
    if (m === undefined || m === null) return null;
    const values = [];
    const sources = [];
    const take = (v) => (typeof v === 'string' && v.includes('${{') ? sources.push(v) : values.push(v));
    if (typeof m === 'string') take(m);
    else if (isObj(m)) {
      if (k in m) (Array.isArray(m[k]) ? m[k].forEach(take) : take(m[k]));
      if (typeof m.include === 'string') take(m.include);
      else if (Array.isArray(m.include)) for (const row of m.include) if (isObj(row) && k in row) take(row[k]);
    } else return { unread: true, values, sources };
    return { values, sources };
  }

  matrix(k, ctx, depth) {
    const got = this.matrixValues(k, ctx.job);
    if (got === null) return { ok: false, why: `reads matrix.${k}, and the job has no matrix` };
    if (got.unread) return { ok: false, why: `reads matrix.${k}, and the matrix is not one it can read` };
    const { values, sources } = got;
    if (!values.length && !sources.length) return { ok: false, why: `reads matrix.${k}, which no matrix row sets` };
    const problems = [];
    let scan = false;
    for (const v of values) problems.push(`matrix.${k} takes ${show(v)} literally`);
    const routes = [];
    const reached = [];
    for (const src of sources) {
      const s = src.trim();
      const r = exprWhole(s) ? this.expression(s.slice(3, -2), { ...ctx, job: { ...ctx.job, strategy: undefined } }, depth + 1) : { ok: false, why: `matrix text ${show(s)} names text outside its expression` };
      if (r.ok) { routes.push(`matrix.${k} ${r.how}`); reached.push(...r.reached); }
      else { problems.push(`matrix.${k}: ${r.why}`); scan ||= r.scan === true; }
    }
    if (problems.length) return { ok: false, why: problems.join('; '), ...(scan ? { scan } : {}) };
    return { ok: true, how: routes.join('; '), reached };
  }

  input(k, ctx, depth) {
    const w = ctx.wf;
    const triggers = onKeys(w.doc?.on);
    if (!triggers.includes('workflow_call')) return { ok: false, why: `reads inputs.${k}, and ${w.path} is not a reusable workflow (no workflow_call), so the value is typed by hand or empty` };
    const others = triggers.filter((t) => t !== 'workflow_call');
    if (others.length) return { ok: false, why: `reads inputs.${k}, and a run started by ${others.join(', ')} gets it typed by hand or empty` };
    const callers = this.callers.get(w.path) || [];
    if (!callers.length) return { ok: false, why: `reads inputs.${k}, and no workflow read calls ${w.path}` };
    const inputs = isObj(w.doc.on) && isObj(w.doc.on.workflow_call) && isObj(w.doc.on.workflow_call.inputs) ? w.doc.on.workflow_call.inputs : {};
    const fallback = isObj(inputs[k]) ? inputs[k].default : undefined;
    const defaultScans = this.isSharedScan(w) ? [] : settingReadsIn(fallback ?? null).scans;
    if (defaultScans.length) return { ok: false, scan: true, why: `reads inputs.${k}, whose default reads ${this.scanWords(defaultScans)}` };
    const problems = [];
    const reached = [];
    let scan = false;
    for (const c of callers) {
      const who = `${c.wf.path} ${c.id}`;
      const passed = isObj(c.job.with) ? c.job.with[k] : undefined;
      if (passed === undefined || passed === null) {
        if (fallback === undefined || fallback === null || fallback === '') problems.push(`${who} passes no ${k}, and the input has no default`);
        else {
          const r = this.runsOn(String(fallback), ctx, depth + 1);
          if (!r.ok) { problems.push(`${who} passes no ${k}, and its default: ${r.why}`); scan ||= r.scan === true; } else reached.push(...r.reached);
        }
        continue;
      }
      const r = this.runsOn(String(passed), { wf: c.wf, id: c.id, job: c.job, fallback: ctx.fallback }, depth + 1);
      if (!r.ok) { problems.push(`${who} passes ${k}: ${r.why}`); scan ||= r.scan === true; } else reached.push(...r.reached);
    }
    if (problems.length) return { ok: false, why: `reads inputs.${k}: ${problems.join('; ')}`, ...(scan ? { scan } : {}) };
    return { ok: true, how: `reads inputs.${k}, and every caller passes it a machine setting`, reached };
  }
}

// ================================================================ what a job holds
export const DEFAULT_TOKEN = "the repository's default token, which may be read-write (neither the workflow nor the job writes a permissions: key)";

// The writes one permissions value grants: write-all, each scope whose access is not exactly
// read or none (an empty access or any other word counts as a write, as this repository's
// runs-on test held it), or the whole value where it is no map, read-all or {}.
export function writesOf(permissions) {
  if (permissions === undefined) return [];
  if (permissions === 'write-all') return ['write-all'];
  if (permissions === 'read-all') return [];
  if (isObj(permissions)) return Object.entries(permissions).filter(([, v]) => v !== 'read' && v !== 'none').map(([k, v]) => `${k}: ${v ?? '(empty)'}`);
  return [`permissions: ${permissions === null ? '(empty)' : String(permissions)}`];
}
// The first write a job holds by its workflow's grant or its own; DEFAULT_TOKEN where neither
// writes a permissions: key; or null. A workflow's grant counts even where the job's own would
// replace it, so the reading errs toward GitHub's machines.
export function writeGrantOf(wf, job) {
  const found = [...writesOf(isObj(wf) && 'permissions' in wf ? wf.permissions : undefined), ...writesOf(isObj(job) && 'permissions' in job ? job.permissions : undefined)];
  if (found.length) return found[0];
  if (!(isObj(wf) && 'permissions' in wf) && !(isObj(job) && 'permissions' in job)) return DEFAULT_TOKEN;
  return null;
}
// Whether a part grants the sign-in: id-token: write anywhere in it, or permissions: write-all.
function grantsSignIn(x) {
  let found = false;
  const visit = (v) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (isObj(v)) {
      for (const [k, e] of Object.entries(v)) {
        if ((k === 'id-token' && e === 'write') || (k === 'permissions' && e === 'write-all')) found = true;
        visit(e);
      }
    }
  };
  visit(x);
  return found;
}
const jobSignsIn = (job) => isObj(job) && (grantsSignIn(job) || 'environment' in job);
const topOf = (js) => Object.fromEntries(Object.entries(js ?? {}).filter(([k]) => k !== 'jobs'));
export function workflowSignsIn(js) {
  return grantsSignIn(topOf(js)) || Object.values(js?.jobs ?? {}).some(jobSignsIn);
}
// The job without its runs-on, for reads made beside it.
const besideRunsOn = (job) => (isObj(job) ? Object.fromEntries(Object.entries(job).filter(([k]) => k !== 'runs-on')) : job);
// The steps of a job that run a checkout, and whether each keeps no credential.
const checkouts = (job) => (Array.isArray(job?.steps) ? job.steps.filter((s) => isObj(s) && typeof s.uses === 'string' && /^actions\/checkout@/i.test(s.uses.trim())) : []);
const keepsNone = (step) => isObj(step.with) && (step.with['persist-credentials'] === false || step.with['persist-credentials'] === 'false');
// The steps' own env values, where a stay job may read CHECKS_RUNNER_<N> to hand it on.
const withoutStepEnv = (job) => {
  if (!isObj(job)) return job;
  const steps = Array.isArray(job.steps) ? job.steps.map((s) => (isObj(s) ? Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'env')) : s)) : job.steps;
  return { ...job, steps };
};

// dazzer-app's stricter class (holdsMoreThanTheCode, its test/verdict.test.ts): a secret named in
// any case, the workflow's token handed on, on plain lines or inside any ${{ }}.
const NAMES_THE_TOKEN = /\bgithub\s*(?:\.\s*token\b|\[)|\btojson\s*\(\s*github\s*\)/i;
const READS_THE_TOKEN = /(?<![\w./-])github(?![\w/-])(?!\s*\.\s*(?!token(?![\w-]))[A-Za-z_][\w-]*)/i;
const NAMES_A_SECRET = /\bsecrets\b/i;
const EXPRESSIONS = /\$\{\{(?=((?:[^'}]|'(?:[^']|'')*(?:'(?!')|$)|\}(?!\}))*(?:\}\}|$)))/g;
const expressionsInText = (text) => [...text.matchAll(EXPRESSIONS)].map((m) => `\${{${m[1] ?? ''}`);
function namesIn(what, text) {
  const every = text.split('\n');
  const plain = every.filter((l) => !/^\s*#/.test(l));
  const onPlainLines = what === 'secret' ? NAMES_A_SECRET : NAMES_THE_TOKEN;
  const inAnExpression = what === 'secret' ? NAMES_A_SECRET : READS_THE_TOKEN;
  return onPlainLines.test(plain.join('\n')) || expressionsInText(every.join('\n')).some((e) => inAnExpression.test(e));
}

// What a call hands the workflow it calls under with:, each a refusal (decisions 93, 171, 181): a
// secret by name, secrets.GITHUB_TOKEN, the whole secrets context, a secret looked up by a name
// worked out as it runs, the workflow's token (as dazzer-app's holdsMoreThanTheCode reads it) and
// any other spelling of GITHUB_TOKEN. The called workflow's jobs hold the token their own
// permissions: grant, and the shared scans hold no secret, so a caller hands on neither.
function handsOn(job, target) {
  const out = [];
  if (!isObj(job.with)) return out;
  const exprs = expressionsInData(job.with);
  const secrets = contextReads(exprs, 'secrets');
  for (const n of secrets.names) {
    if (n === 'GITHUB_TOKEN') out.push(`calls ${target} and hands it secrets.GITHUB_TOKEN under with:, the workflow's token: the called workflow's jobs hold the token their own permissions: grant, and a caller hands on no other (decision 171).`);
    else out.push(`calls ${target} and hands it secrets.${n} under with:, a secret: a caller hands no secret to a shared workflow, whose jobs may run on machines of ours and hold none (decision 93).`);
  }
  if (secrets.whole) out.push(`calls ${target} and hands it the whole secrets context under with: (as toJSON(secrets) does), every secret the repository holds: a caller hands no secret to a shared workflow (decision 93).`);
  if (secrets.computed) out.push(`calls ${target} and hands it a secret looked up by a name worked out as it runs under with: (secrets[ followed by no quoted name), which could be any secret the repository holds: a caller hands no secret to a shared workflow (decision 93).`);
  if (exprs.some((e) => READS_THE_TOKEN.test(e.blanked))) out.push(`calls ${target} and hands on the workflow's token under with: (github.token, github[...], toJSON(github), a github.* filter or the github context whole): the called workflow's jobs hold the token their own permissions: grant (decision 171).`);
  const other = exprs.find((e) => /(?<![\w-])github_token(?![\w-])/i.test(e.blanked.replace(/(?<![\w.-])secrets\s*\.\s*github_token(?![\w-])/gi, '')));
  if (other) out.push(`calls ${target} and hands it \${{${other.raw}}} under with:, a GITHUB_TOKEN spelling, which reads the workflow's token wherever it was put: the called workflow's jobs hold the token their own permissions: grant (decision 171).`);
  return out;
}

// Every vars name of a setting family's spelling that is no setting family name (vars.CHECKS_DIR,
// vars.LOCKED_UNTIL): this repository's runs-on test refused each one in every job here but the
// scans' read-only jobs, so none is taken for a setting (decisions 36, 104).
const familySpelled = (x) => unique(contextReads(expressionsInData(x), 'vars').names.filter((n) => /^(CHECKS|SCAN|LOCKED)_/.test(n) && !familyOf(n)));

// ================================================================ the lists
const nonEmpty = (x) => typeof x === 'string' && x.trim() !== '';
const wholeNumber = (x) => Number.isInteger(x) && x > 0;
const REPOSITORY = /^dazzer-io\/[A-Za-z0-9_.-]+$/;
const WORKFLOW_FILE = /^[^/]+\.ya?ml$/;
const SCOPES = ['actions', 'attestations', 'checks', 'contents', 'deployments', 'discussions', 'id-token', 'issues', 'models', 'packages', 'pages', 'pull-requests', 'repository-projects', 'security-events', 'statuses'];
const unknownKeys = (obj, keys) => Object.keys(obj).filter((k) => !keys.includes(k));

// kept.json's own check: every refusal of a list, as a sentence. A list that fails it is unread.
export function checkKept(kept) {
  const problems = [];
  if (!isObj(kept)) return ['kept.json is not an object'];
  for (const k of unknownKeys(kept, ['about', 'entries'])) problems.push(`kept.json holds the key ${k}, beside about and entries`);
  if (!nonEmpty(kept.about)) problems.push('kept.json says nothing under about');
  if (!Array.isArray(kept.entries)) return [...problems, 'kept.json holds no entries list'];
  const seen = new Set();
  kept.entries.forEach((e, i) => {
    const label = isObj(e) ? `${e.repository ?? '?'} ${e.workflow ?? '?'} ${e.job ?? (Array.isArray(e.jobs) ? `[${e.jobs.join(', ')}]` : '?')}` : `entry ${i}`;
    if (!isObj(e)) { problems.push(`kept.json's ${label} is not an object`); return; }
    const whole = 'jobs' in e;
    for (const k of unknownKeys(e, whole ? ['repository', 'workflow', 'jobs', 'effect', 'reason', 'decision', 'source'] : ['repository', 'workflow', 'job', 'name', 'effect', 'writes', 'reason', 'decision', 'source'])) problems.push(`kept.json's ${label} holds the key ${k}, which ${whole ? 'a whole-file entry' : 'a job entry'} does not take`);
    if (!REPOSITORY.test(String(e.repository))) problems.push(`kept.json's ${label} names no dazzer-io repository`);
    if (!WORKFLOW_FILE.test(String(e.workflow))) problems.push(`kept.json's ${label} names no workflow file directly in .github/workflows`);
    if (!EFFECTS.includes(e.effect)) problems.push(`kept.json's ${label} has ${e.effect === undefined ? 'no effect' : `the effect ${show(e.effect)}, an unknown one`}: each entry has exactly one of ${EFFECTS.join(', ')}, so one entry never exempts a job both from reading its setting and from the write ban`);
    if (e.effect === 'canary' && !isCanaryHome(e.repository, e.workflow)) problems.push(`kept.json's ${label} has the effect canary, which only ${CANARY_WHERE} may take, so no other repository can pin one of our sets and skip the setting the watcher empties`);
    if (whole) {
      if (!Array.isArray(e.jobs) || !e.jobs.length || !e.jobs.every(nonEmpty) || new Set(e.jobs).size !== e.jobs.length) problems.push(`kept.json's ${label} lists its jobs as no list of distinct job ids`);
      if (e.effect === 'checks') problems.push(`kept.json's ${label} names a whole file with the effect checks: a whole-file entry is for a file whose every job stays (or one of runners' two canaries), and a checks entry names its job`);
    } else {
      if (!nonEmpty(e.job)) problems.push(`kept.json's ${label} names no job`);
      if (!nonEmpty(e.name)) problems.push(`kept.json's ${label} carries no name, the name GitHub's jobs API shows for it`);
      if (e.effect === 'canary') problems.push(`kept.json's ${label} is a job entry with the effect canary: a canary's jobs are named per run from a matrix, so its entry names the whole file`);
      if ('writes' in e && (e.effect !== 'checks' || !Array.isArray(e.writes) || !e.writes.length || !e.writes.every((s) => SCOPES.includes(s)))) problems.push(`kept.json's ${label} names writes ${show(e.writes)}: only a checks entry names writes, each a permission scope`);
      if (e.effect === 'stay' && nonEmpty(e.name) && e.name.includes('${{')) problems.push(`kept.json's ${label} carries the name ${show(e.name)}, which holds an expression: a stay entry carries the name GitHub shows, a fixed string`);
    }
    if (!nonEmpty(e.reason)) problems.push(`kept.json's ${label} gives no reason`);
    if (!wholeNumber(e.decision)) problems.push(`kept.json's ${label} names no whole-number decision`);
    if (!nonEmpty(e.source)) problems.push(`kept.json's ${label} names no source`);
    const keys = whole ? (Array.isArray(e.jobs) ? e.jobs : []) : [e.job];
    for (const j of keys) {
      const key = `${e.repository}/${e.workflow}/${j}`;
      if (seen.has(key)) problems.push(`kept.json names ${e.repository} ${e.workflow} ${j} twice`);
      seen.add(key);
    }
  });
  return problems;
}

export function checkSecrets(secrets) {
  const problems = [];
  if (!isObj(secrets)) return ['secrets.json is not an object'];
  for (const k of unknownKeys(secrets, ['about', 'repositories'])) problems.push(`secrets.json holds the key ${k}, beside about and repositories`);
  if (!nonEmpty(secrets.about)) problems.push('secrets.json says nothing under about');
  if (!isObj(secrets.repositories)) return [...problems, 'secrets.json holds no repositories map'];
  for (const [repo, e] of Object.entries(secrets.repositories)) {
    if (!REPOSITORY.test(repo)) problems.push(`secrets.json names ${repo}, no dazzer-io repository`);
    if (!isObj(e)) { problems.push(`secrets.json's ${repo} is not an object`); continue; }
    for (const k of unknownKeys(e, ['names', 'reason', 'decision', 'source'])) problems.push(`secrets.json's ${repo} holds the key ${k}`);
    if (!Array.isArray(e.names) || !e.names.every((n) => /^[A-Z][A-Z0-9_]*$/.test(n)) || new Set(e.names).size !== e.names.length) problems.push(`secrets.json's ${repo} names its secrets as no list of distinct names in capitals`);
    if (Array.isArray(e.names) && e.names.includes('GITHUB_TOKEN')) problems.push(`secrets.json's ${repo} names GITHUB_TOKEN, which every job may read and no list names`);
    if (!nonEmpty(e.reason)) problems.push(`secrets.json's ${repo} gives no reason`);
    if (!wholeNumber(e.decision)) problems.push(`secrets.json's ${repo} names no whole-number decision`);
    if (!nonEmpty(e.source)) problems.push(`secrets.json's ${repo} names no source`);
  }
  return problems;
}

export function checkStrict(strict) {
  const problems = [];
  if (!isObj(strict)) return ['strict.json is not an object'];
  for (const k of unknownKeys(strict, ['about', 'repositories'])) problems.push(`strict.json holds the key ${k}, beside about and repositories`);
  if (!nonEmpty(strict.about)) problems.push('strict.json says nothing under about');
  if (!Array.isArray(strict.repositories)) return [...problems, 'strict.json holds no repositories list'];
  for (const e of strict.repositories) {
    if (!isObj(e) || !REPOSITORY.test(String(e.repository))) { problems.push(`strict.json names ${show(e?.repository ?? e)}, no dazzer-io repository`); continue; }
    for (const k of unknownKeys(e, ['repository', 'reason', 'decision', 'source'])) problems.push(`strict.json's ${e.repository} holds the key ${k}`);
    if (!nonEmpty(e.reason)) problems.push(`strict.json's ${e.repository} gives no reason`);
    if (!wholeNumber(e.decision)) problems.push(`strict.json's ${e.repository} names no whole-number decision`);
    if (!nonEmpty(e.source)) problems.push(`strict.json's ${e.repository} names no source`);
  }
  return problems;
}

export class Unread extends Error {}
const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Unread(`could not read ${path}: ${e.message}`);
  }
};
// The three lists, read from this folder and checked; any refusal leaves the rule unread.
export function readLists(dir = HERE) {
  const kept = readJson(join(dir, 'kept.json'));
  const secrets = readJson(join(dir, 'secrets.json'));
  const strict = readJson(join(dir, 'strict.json'));
  const problems = [...checkKept(kept), ...checkSecrets(secrets), ...checkStrict(strict)];
  if (problems.length) throw new Unread(`the rule's own lists fail their check: ${problems.join('; ')}`);
  return { kept, secrets, strict };
}

// The shared workflows a job may call, read from this repository's own folder: each one's
// declared inputs and the most its jobs are granted, scope by scope (a job writing no
// permissions: holds its workflow's).
export function callableOf(files) {
  const out = new Map();
  const rank = { none: 0, read: 1, write: 2 };
  for (const f of files) {
    if (!CALLABLE.includes(f.path)) continue;
    const wf = readWorkflow(f.text);
    if (!wf.js) continue;
    const on = wf.js.on;
    const call = isObj(on) && 'workflow_call' in on ? (on.workflow_call ?? {}) : null;
    const inputs = isObj(call?.inputs) ? Object.keys(call.inputs) : [];
    const grant = {};
    for (const job of Object.values(wf.js.jobs ?? {})) {
      const perm = isObj(job) && 'permissions' in job ? job.permissions : wf.js.permissions;
      if (!isObj(perm)) continue;
      for (const [scope, level] of Object.entries(perm)) if ((rank[level] ?? -1) > (rank[grant[scope]] ?? -1)) grant[scope] = level;
    }
    out.set(f.path, { inputs, grant, callable: call !== null });
  }
  return out;
}
export function readFolder(path) {
  const dir = join(path, WORKFLOW_DIR);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.ya?ml$/.test(e.name))
    .map((e) => e.name)
    .sort()
    .map((name) => ({ path: `${WORKFLOW_DIR}/${name}`, text: readFileSync(join(dir, name), 'utf8') }));
}
let ownCallable = null;
const sharedCallable = () => (ownCallable ??= callableOf(readFolder(ROOT) ?? []));

// ================================================================ the judgment
// The name GitHub's jobs API shows for a job, as kept.json's job entries carry it: its name: as
// written, or its id when it has none; where its name: holds one expression and only as a
// trailing parenthetical, the words before it (GitHub shows each leg as <name> (<value>), and the
// readings take that one parenthetical off). null where its name: holds an expression elsewhere.
export function shownName(id, job) {
  const name = isObj(job) ? job.name : undefined;
  if (name === undefined || name === null) return id;
  const s = String(name);
  if (!s.includes('${{')) return s;
  const m = /^(.*\S)\s+\(\$\{\{[^}]*\}\}\)$/.exec(s);
  return m && !m[1].includes('${{') ? m[1] : null;
}

// One repository's workflows judged. files: [{ path, text }]. Gives { refusals: [{ path, line,
// job, why, production, scan }], lines: [the refusals as printed], nothing: true where there
// were no files, moving }.
export async function judgeFiles({ repository, visibility, files, kept = { entries: [] }, secrets = { repositories: {} }, strict = { repositories: [] }, moving = null, shared = false, compare = null, callable = null }) {
  const refusals = [];
  const say = (path, line, job, why, extra = {}) => refusals.push({ path, line, job, why, ...extra });
  if (!files || files.length === 0) return { refusals, lines: [], notes: [], nothing: true, moving: false };
  const isPublic = visibility === 'public';
  const strictRepo = strict.repositories.some((e) => e.repository === repository);
  const allowedSecrets = secrets.repositories[repository]?.names ?? [];
  const calls = callable ?? sharedCallable();
  const read = files.map((f) => ({ ...f, wf: readWorkflow(f.text) }));
  const workflows = read.filter((r) => r.wf.js && r.wf.hasJobs).map((r) => ({ path: r.path, doc: r.wf.js, jobs: r.wf.js.jobs }));
  const readsAny = workflows.some((w) => {
    const f = settingReadsIn(w.doc).families;
    return f.CHECKS.size > 0 || f.LOCKED.size > 0;
  });
  const isMoving = !isPublic && (moving ?? readsAny);
  const routes = new Routes({ workflows, shared });
  const entries = kept.entries.filter((e) => e.repository === repository);
  const notes = [];
  for (const e of entries) if (!files.some((f) => basename(f.path) === e.workflow)) notes.push(`note: kept.json names ${repository} ${e.workflow}, a workflow ${repository} does not hold as read; the entry keeps nothing until it lands.`);

  for (const r of read) {
    const { path, wf } = r;
    const file = basename(path);
    for (const m of wf.misread) say(path, m.line, null, m.why);
    // A workflow no event starts is refused in every repository (this repository's runs-on test
    // refused it so, decision 181): nothing says when its jobs run, so no class of them can be read.
    if (wf.js && wf.triggers.length === 0) say(path, 1, null, `names no trigger it can read (${'on' in wf.js ? `on: ${show(wf.js.on)}` : 'no on: key'}), so nothing says when its jobs run or which class they are in; it is refused in every repository. Write on: with the events that start it.`);
    if (!wf.hasJobs) {
      say(path, 1, null, 'holds no job this rule can read (a jobs: key at the top whose value is a block map of at least one job), so its machines were never judged; it is refused rather than passed.');
      continue;
    }
    const w = workflows.find((x) => x.path === path);
    const js = wf.js;
    const top = topOf(js);
    const triggers = wf.triggers;
    const signs = workflowSignsIn(js);
    const tag = wf.tagStarts.length ? wf.tagStarts.join('; ') : null;
    const onDefaultBranch = DEFAULT_BRANCH_TRIGGERS.filter((t) => triggers.includes(t));
    const isScanFile = shared && SHARED_SCANS.includes(path);
    const holding = shared && SHARED_HOLDING.includes(path);
    const prStarted = triggers.some((t) => PULL_REQUEST_EVENTS.includes(t));
    // The write token the workflow holds, if any: on pull_request_target every job holds one, and
    // elsewhere the first write any job is granted, by the workflow or itself (decision 36).
    const workflowWrite = triggers.includes('pull_request_target') ? 'pull_request_target, which runs with the base repository\'s token' : (wf.jobs.map((x) => (isObj(x.js) ? writeGrantOf(js, x.js) : null)).find(Boolean) ?? null);
    const fileEntries = entries.filter((e) => e.workflow === file);
    const wholeEntry = fileEntries.find((e) => Array.isArray(e.jobs)) ?? null;
    const ids = wf.jobs.map((j) => j.id);
    // A whole-file entry lists every job id the file holds, so a job added beside them is judged.
    if (wholeEntry) {
      for (const id of ids) if (!wholeEntry.jobs.includes(id)) say(path, wf.jobs.find((j) => j.id === id).line, id, `is not among the jobs kept.json's whole-file entry for ${file} lists (${wholeEntry.jobs.join(', ')}), so the entry does not keep it and it is judged like any other job. Add it to the entry, by its decision, or give it its setting.`);
      for (const id of wholeEntry.jobs) if (!ids.includes(id)) notes.push(`note: kept.json's whole-file entry for ${repository} ${file} lists the job ${id}, which ${path} does not hold as read; it keeps nothing until that job lands (runners' allowed list said a stale entry so too).`);
    }
    for (const e of fileEntries.filter((x) => !Array.isArray(x.jobs))) if (!ids.includes(e.job)) notes.push(`note: kept.json's entry for ${repository} ${file} ${e.job} matches no job of ${path} as read; it keeps nothing until that job lands.`);
    // dazzer-app's stricter class: the workflow holding a job it holds (STRICT_HELD).
    let strictWorkflow = false;
    let finalChecks = 0;
    const scanReadTop = isScanFile ? [] : unique([...settingReadsIn(top).scans]);
    if (scanReadTop.length) say(path, 1, null, `the workflow's top (its env, its inputs' defaults or any key outside jobs) reads ${routes.scanWords(scanReadTop)}.`, { scan: true });

    for (const j of wf.jobs) {
      const job = j.js;
      const id = j.id;
      const line = j.line;
      const at = j.runsOnLine ?? line;
      const no = (why, extra = {}) => say(path, line, id, why, { production: signs, ...extra });
      const noAt = (why, extra = {}) => say(path, at, id, why, { production: signs, ...extra });
      if (!isObj(job)) { no('is not a mapping, so nothing of it could be judged.'); continue; }
      let entry = wholeEntry && wholeEntry.jobs.includes(id) ? wholeEntry : fileEntries.find((e) => e.job === id) ?? null;
      // A job entry carries the name GitHub shows; a stay entry only a fixed string.
      if (entry && !Array.isArray(entry.jobs)) {
        const shown = shownName(id, job);
        if (entry.effect === 'stay' && shown === null) {
          no(`is kept by kept.json's stay entry, but its name: ${show(job.name)} holds an expression other than one trailing parenthetical, so GitHub shows a name no entry can carry and the readings cannot match it. Write a fixed name:, or one ending in a single (\${{ ... }}).`);
          entry = null;
        } else if (entry.effect === 'stay' && entry.name !== shown) {
          no(`is kept by kept.json's stay entry carrying the name ${show(entry.name)}, where GitHub shows this job as ${show(shown)}, so the readings would match no job. Carry the name ${show(shown)}.`);
          entry = null;
        } else if (entry.effect === 'checks' && entry.name !== (job.name === undefined || job.name === null ? id : String(job.name))) {
          no(`is kept by kept.json's checks entry carrying the name ${show(entry.name)}, where its name: as written is ${show(job.name ?? id)}. Carry that name.`);
          entry = null;
        }
      }
      // A job that only calls a shared workflow names no machine and holds no steps (decision
      // 129); the jobs it calls are judged in dazzer-io/.github, where they run. It is held to every
      // class rule below as any job is, its workflow's top included, and then to judgeCall's exact
      // admission (decision 171). No kept.json entry keeps a call.
      const call = 'uses' in job;
      if (call) entry = null;
      const effect = entry?.effect ?? null;
      const reads = settingReadsIn({ job, top });
      const beside = settingReadsIn({ job: besideRunsOn(job), top });
      const families = (kinds) => kinds.flatMap((k) => [...reads.families[k]]);
      const write = writeGrantOf(js, job);
      const secretReads = contextReads([...expressionsInData(job), ...expressionsInData(top)], 'secrets');
      const runsOn = call ? undefined : job['runs-on'];
      // The machine as a string this rule can read, or null: a call names none, and an absent,
      // listed, mapped or other runs-on is refused here once, its classes judging all but it.
      const machine = typeof runsOn === 'string' ? runsOn : null;
      const literal = machine !== null && !machine.includes('${{') ? machine.trim() : null;
      const target = call ? (typeof job.uses === 'string' ? basename(job.uses.split('@')[0]) : 'a workflow') : null;

      // SCAN_ settings are read by the shared scans alone (runners' scan rule, decisions 98, 119).
      const scanNames = isScanFile ? [] : unique(settingReadsIn({ job }).scans);
      if (scanNames.length) no(`reads ${routes.scanWords(scanNames)}.`, { scan: true });

      // ------------------------------------------------------------ the machine named
      if (!call) {
        if (runsOn === undefined || runsOn === null) no('names no machine: it has no runs-on and calls no workflow, so its machine could not be read at all.');
        else if (Array.isArray(runsOn) || isObj(runsOn)) noAt(routes.runsOn(runsOn, { wf: w, id, job }, 0).why + '.');
        else if (typeof runsOn !== 'string') noAt(`runs-on ${show(runsOn)} names no machine this rule can read.`);
        else if (literal !== null && OUR_MACHINE.test(literal) && effect !== 'canary') noAt(`names one of our own machines literally, '${literal}', so it would run there with no setting naming it, and the watcher, which empties the setting to send a waiting job back to GitHub's, could never move it. Read the setting: \${{ vars.<FAMILY>_RUNNER_<N> || '<GitHub's machine>' }}.`);
        else if (literal !== null && !isGitHubMachine(literal) && effect !== 'canary') noAt(`names the machine '${literal}' literally, which is neither GitHub's machine (${GITHUB_MACHINE}) nor a setting, so where it runs could not be judged.`);
      }
      // dazzer-app's stricter class exempts the literal ubuntu-latest (its holdsMoreThanTheCode,
      // verdict.test.ts:1253) and, on a workflow no pull-request event starts, the locked setting
      // held to main falling back to it (lockedHeldToMain, decision 190). It holds every other job,
      // whatever its class, a call among them, to no more than the code; a call asks a grant only
      // as codeql.yml's job codeql (1248, 1258). An exempt job still meets every class rule below,
      // decision 9's LOCKED_ class and the signs-in class's main guard among them.
      if (strictRepo && literal !== 'ubuntu-latest' && !lockedHeldToMain(machine, prStarted)) {
        strictWorkflow = true;
        judgeStrict({ job, text: j.text, no, call, theCall: call && file === 'codeql.yml' && id === 'codeql' && target === 'codeql.yml' });
      }

      // A job running CodeQL's scan reads no CHECKS_ setting (decision 91).
      if (Array.isArray(job.steps) && job.steps.some((s) => isObj(s) && typeof s.uses === 'string' && SCANNER_ACTIONS.test(s.uses.trim())) && families(['CHECKS']).length) no(`runs CodeQL's scan (github/codeql-action/init or analyze) and reads ${families(['CHECKS']).join(', ')}: on the change-check machines the change's own code can reach the scan (decision 91). Call the shared scan instead.`);

      // codeql.yml's one final check is counted whatever keeps it, so a second is refused even
      // where kept.json names the first (decision 135).
      const final = isScanFile && path === '.github/workflows/codeql.yml' && isObj(job.permissions) && Object.keys(job.permissions).length === 0;
      if (final) {
        finalChecks += 1;
        if (finalChecks > 1) no('is a second job of codeql.yml granted no token: the shared scan holds one final check on GitHub\'s machines (decision 135), every other read-only job on the scan machines.');
      }
      // In dazzer-io/.github, every job but the scans' read-only jobs reads no vars name spelled as
      // a setting is (this repository's runs-on test held it so).
      if (shared && !(isScanFile && !write && !final)) for (const n of familySpelled({ job, top })) no(`is ${call ? `a call of ${target} in` : 'a job of'} ${SHARED} ${isScanFile ? `that ${write ? `holds a write token (${write})` : 'is the final check of a scan'}` : 'outside the shared scans'} and reads vars.${n}, a name spelled as a CHECKS_, SCAN_ or LOCKED_ setting is: a job here but the scans' read-only jobs reads no variable so named, so none is taken for a setting (decisions 36, 104).`);

      // ------------------------------------------------------------ the entry's effect
      // Each effect's own rules; the job then meets every class rule below as any job does, the
      // effect admitting it only where its decision did.
      if (effect === 'canary') judgeCanary({ repository, file, js, job, triggers, secretReads, no, noAt, routes, w, id });
      // A shared scan's job is judged by the scans' own rules below, its stay entry only naming it.
      if (effect === 'stay' && !isScanFile) {
        if (!(literal !== null && isStandard(literal))) noAt(`is kept on GitHub's computers by kept.json (effect stay) and runs on ${show(runsOn)}, not one of GitHub's standard machines written as a label (${STANDARD}).`);
        const outsideEnv = settingReadsIn({ job: withoutStepEnv(job), top });
        const own = [...outsideEnv.families.CHECKS, ...reads.families.LOCKED, ...reads.families.SCAN];
        if (own.length || outsideEnv.whole) no(`is kept on GitHub's computers by kept.json (effect stay) and reads ${unique(own).join(', ') || VARS_WHOLE} beyond a step's env: a stay job reads no CHECKS_, LOCKED_ or SCAN_ setting as its own machine, and hands CHECKS_RUNNER_<N> on only in a step's env, as dazzer-app's plan jobs do (decision 34).`);
        // That hand-on is admitted only where decision 34 decided it, a workflow that neither signs
        // in nor holds a write token (decisions 9, 23, 36, 181).
        const handedOn = [...[...reads.families.CHECKS].filter((n) => !outsideEnv.families.CHECKS.has(n)), ...(reads.whole && !outsideEnv.whole ? [VARS_WHOLE] : [])];
        if (handedOn.length && (signs || workflowWrite)) no(`is kept on GitHub's computers by kept.json (effect stay) and hands ${handedOn.join(', ')} on in a step's env in a workflow that ${signs ? 'signs in (id-token: write, write-all or an environment), which reads no CHECKS_ setting (decisions 9, 23)' : `holds a write token (${workflowWrite}), whose jobs read no CHECKS_ setting (decision 36)`}: decision 34 admits that hand-on only in a workflow that does neither, as dazzer-app's ci.yml and split-trial.yml are.`);
      }

      // ------------------------------------------------------------ a workflow that signs in
      // A stay entry keeps a job of such a workflow on GitHub's machine, so its machine is the
      // entry's (decisions 9, 40); what it reads is judged here as any job's.
      if (signs) {
        if (effect !== 'stay') {
          if (onDefaultBranch.length) no(`is a job of a workflow that signs in and runs on ${onDefaultBranch.join(', ')}, where github.ref is the default branch whatever started the run, so the main guard would hand a run the locked set for main's own file; kept.json names no stay entry for it, so where it may run could not be decided.`);
          else if (tag) no(`is a job of a workflow that signs in and that a tag starts (${tag}), and a tag can name any commit, whose own workflow file decides its runs-on, so nothing in it could keep the locked machine to main-line code; kept.json names no stay entry for it.`);
          else if (call) no('is a job of a workflow that signs in and calls a reusable workflow, so it has no machine of its own this rule can read, and it could not be held to the locked set from main.');
          else if (machine !== null) {
            const m = LOCKED_SHAPE.exec(machine.trim());
            if (!m) {
              const label = literal ?? (/\|\|\s*'([^']+)'\s*\}\}$/.exec(machine)?.[1] ?? null);
              const cores = label && isGitHubMachine(label) ? coresFromLabel(label) : null;
              const shape = `\${{ ${MAIN_REF} && vars.LOCKED_RUNNER_${cores ?? '<cores>'} || '${cores ? label : "<GitHub's machine>"}' }}`;
              if (literal !== null) noAt(`is a job of a workflow that signs in and names its machine literally, '${literal}', so it cannot move to the locked set; kept.json names no stay entry for it. Write runs-on: ${shape}, or keep it by an entry with its decision.`);
              else if (reads.families.LOCKED.size) noAt(`is a job of a workflow that signs in and reads ${[...reads.families.LOCKED].join(', ')} without the ref condition held to main, '${machine}', so a run from any other branch or tag would take the locked machine. Write runs-on: ${shape}.`);
              else if (!families(['CHECKS']).length && !scanNames.length) noAt(`is a job of a workflow that signs in whose runs-on, '${machine}', is not the locked setting held to main with GitHub's machine as its fallback. Write runs-on: ${shape}.`);
            } else {
              const [, name, n, label] = m;
              if (!DECLARED_SETTINGS.includes(name)) noAt(`reads ${name}, which the organisation does not declare (${DECLARED_SETTINGS.join(', ')}), so it is empty for ever.`);
              if (!isGitHubMachine(label)) noAt(`is a job of a workflow that signs in that reads ${name} with the fallback '${label}', which is not GitHub's machine (${GITHUB_MACHINE}). Write runs-on: \${{ ${MAIN_REF} && vars.${name} || '${Number(n) === 2 ? 'ubuntu-latest' : `ubuntu-${n}-core`}' }}.`);
              else if (coresFromLabel(label) !== Number(n)) noAt(`reads ${name}, a ${n}-core machine, but its fallback '${label}' has ${coresFromLabel(label)} cores, so the job would run on a different width depending on the setting. Read LOCKED_RUNNER_${coresFromLabel(label)}.`);
            }
          }
        }
        const checks = families(['CHECKS']);
        if (checks.length) no(`is a job of a workflow that signs in (id-token: write, write-all or an environment), and it reads ${checks.join(', ')}. The CHECKS_ settings move the change checks to machines of our own; a job of a workflow that signs in reads none of them (decisions 9, 23).`);
        const lockedElsewhere = [...beside.families.LOCKED];
        if (lockedElsewhere.length) no(`is a job of a workflow that signs in and reads ${lockedElsewhere.join(', ')} outside its runs-on, where no ref condition holds it to main. A job of such a workflow reads the locked setting in its runs-on alone, as ${MAIN_REF} && vars.LOCKED_RUNNER_<N> || '<GitHub's machine>'.`);
      } else {
        // ---------------------------------------------------------- a workflow that does not sign in
        const locked = families(['LOCKED']);
        if (locked.length) no(`is a job of a workflow that does not sign in, and it reads ${locked.join(', ')}. The LOCKED_ settings move the jobs of workflows that sign in to the set locked to main-line code; a change check asking for it would wait for a machine its group never gives (decision 9), and no kept.json effect admits it.`);
      }

      // The shared scans' jobs (decisions 93, 98, 135): every job that is not a write-token job
      // or codeql.yml's one final check reads SCAN_SHAPE exactly, holds no secret and keeps no
      // git credential. These rules stand for the write-token and public classes in the two scans.
      if (isScanFile) {
        if (machine !== null && final && !(literal !== null && isStandard(literal))) noAt(`is the final check of the shared scan ${file}, granted no token, and runs on ${show(runsOn)}, not one of GitHub's standard machines written as a label (${STANDARD}) (decision 135).`);
        if (machine !== null && !write && !final && machine.trim() !== SCAN_SHAPE) noAt(`is a read-only job of the shared scan ${file} and reads ${show(runsOn)}, not ${SCAN_SHAPE}: its machine is the scan machines (decision 93), GitHub's own while the setting is empty.`);
        const said = [...secretWords(job).map((s) => `the job reads ${s}`), ...secretWords(top).map((s) => `the workflow's top reads ${s}`)];
        if (!write && said.length) no(`is a job of the shared scan ${file} and ${said[0]}: a scan job holds no secret, declared or read, so nothing on the scan machines is worth taking, and a caller never hands one to the shared scan.`);
        for (const c of checkouts(job)) if (!keepsNone(c)) no(`is a job of the shared scan ${file} and checks out without persist-credentials: false, so the token stays in the checkout's git settings for every later step.`);
        if (machine !== null && (write || final) && !entry) noAt(`is a job of ${file}, a shared workflow another repository's run lists, on ${show(runsOn)}, and kept.json names no stay entry for it, so the readings would count it against our machines' goal (r-1.58). Name it in kept.json with its decision.`);
        if (machine !== null && write && !(literal !== null && isStandard(literal))) noAt(`holds a write token (${write}) and runs on ${show(runsOn)}, not one of GitHub's standard machines written as a label (${STANDARD}). On a machine of our own, that token is within reach of whatever ran there before it (decision 36).`);
        if ((write || final) && families(['CHECKS', 'LOCKED', 'SCAN']).length) no(`${write ? `holds a write token (${write})` : 'is the final check of a scan, granted no token'} and reads ${families(['CHECKS', 'LOCKED', 'SCAN']).join(', ')}: such a job stays on GitHub's machine and reads no CHECKS_, SCAN_ or LOCKED_ setting (decisions 36, 135).`);
      }

      // A write token on a pull request's change, or anywhere in dazzer-io/.github: a literal
      // GitHub standard label and no setting (decision 36; this repository's stricter rule). No
      // kept.json effect lifts it: a checks entry admits a write only off a pull request, in a
      // private repository, as brain-builder's push-started release tag job (decision 47).
      const writeHeld = !isScanFile && write && (prStarted || shared);
      if (writeHeld) {
        if (machine !== null && !(literal !== null && isStandard(literal))) noAt(`holds a write token (${write}) in a workflow ${shared ? 'of dazzer-io/.github, whatever starts it' : `a pull-request event starts (${triggers.filter((t) => PULL_REQUEST_EVENTS.includes(t)).join(', ')})`} and runs on ${show(runsOn)}, not one of GitHub's standard machines written as a label (${STANDARD}). On a machine of our own, that token is within reach of whatever ran there before it (decision 36).`);
        if (families(['CHECKS', 'SCAN']).length || reads.whole) no(`holds a write token (${write}) and reads ${unique([...families(['CHECKS', 'SCAN']), ...(reads.whole ? [VARS_WHOLE] : [])]).join(', ')}: a job holding a write token stays on GitHub's machine and reads no CHECKS_, SCAN_ or LOCKED_ setting (decision 36).`);
      }
      // On pull_request_target every job holds the base repository's token on a fork's change,
      // so it stays on GitHub's standard machine written as a label (decision 36; dazzer's kindOf
      // classes it write-token), which a call, naming no machine, never is.
      if (call && triggers.includes('pull_request_target')) no(`calls ${target} in a workflow on pull_request_target, which runs with the base repository's token on a fork's change: every job there holds a write token and stays on GitHub's standard machine written as a label (decision 36), and a call names no machine at all. Call it from a workflow on pull_request.`);

      // ------------------------------------------------------------ a public repository (decision 104)
      // No kept.json effect lifts it: in a public repository every job but the shared scans' runs
      // on GitHub's standard machine and reads no setting.
      if (isPublic && !isScanFile) {
        if (machine !== null && !writeHeld && !(literal !== null && isStandard(literal))) noAt(`is a job of ${repository}, a public repository, and runs on ${show(runsOn)}, not one of GitHub's standard machines written as a label (${STANDARD}): the fallback watcher does not read a public repository's runs, so a job there on machines of ours would never be sent back to GitHub's if they stalled (decision 104).`);
        if (!writeHeld && families(['CHECKS', 'SCAN', 'LOCKED']).length) no(`is a job of ${repository}, a public repository, and reads ${families(['CHECKS', 'SCAN', 'LOCKED']).join(', ')}: in a public repository no job but the shared scans' reads a setting (decision 104).`);
        if (holding && literal !== null && !entry) noAt(`is a job of ${file}, a shared workflow another repository's run lists, on '${literal}', and kept.json names no stay entry for it, so the readings would count it against our machines' goal (r-1.58). Name it in kept.json with its decision.`);
      }

      // ------------------------------------------------------------ a private repository
      // A job no entry keeps, of a workflow that does not sign in; a kept job's machine is judged
      // by its effect's own rules, and a job of a workflow that signs in by the locked setting.
      if (!isPublic && !signs && !entry) {
        if (!isMoving) {
          if (!writeHeld && literal === null && machine !== null) {
            const r = routes.runsOn(machine, { wf: w, id, job }, 0);
            if (!r.ok) noAt(`${r.why}.`, r.scan ? { scan: true } : {});
          }
        } else if (!triggers.includes('pull_request')) {
          if (call) no(`calls ${target} from a workflow that signs in to nothing and is not started by pull_request (it runs on ${triggers.join(', ') || 'no trigger it can read'}), in ${repository}, whose workflows read a CHECKS_ or LOCKED_ setting; kept.json names no entry for it, as no entry keeps a call, which names no machine, so whether its jobs may run on our machines is a decision nobody has made (dazzer's kindOf calls it unclassified). Call it from a workflow started by pull_request.`);
          else no(`is a job of a workflow that signs in to nothing (no id-token: write, write-all or environment) and is not started by pull_request (it runs on ${triggers.join(', ') || 'no trigger it can read'}), in ${repository}, whose workflows read a CHECKS_ or LOCKED_ setting; kept.json names no entry for it, so whether it may move onto the change-check machines is a decision nobody has made (dazzer's kindOf calls it unclassified). Name it in kept.json with its effect, stay or checks, and its decision.`);
        } else if (literal !== null) {
          noAt(`names the literal label '${literal}' in ${repository}, a private repository whose workflows read a CHECKS_ or LOCKED_ setting, and kept.json names no entry for it, so it neither reads its setting (decision 15) nor is kept on GitHub's computers by a decision of its own. ${writeHeld ? 'Name it in kept.json with effect stay and its decision.' : `Read \${{ vars.CHECKS_RUNNER_${coresFromLabel(literal) ?? '<N>'} || '${literal}' }}, or name it in kept.json with its decision.`}`);
        } else if (!writeHeld && !call) judgeChecks({ repository, js, job, runsOn: machine, literal, write, entry: null, secretReads, allowedSecrets, triggers, no, noAt, routes, w, id });
      }

      // ------------------------------------------------------------ each shape's own admission, after the classes
      if (effect === 'checks') judgeChecks({ repository, js, job, runsOn: machine, literal, write, entry, secretReads, allowedSecrets, triggers, no, noAt, routes, w, id });
      if (call) {
        for (const why of await judgeCall({ path, id, job, top, shared, calls, compare })) no(why.why, why.scan ? { scan: true } : {});
        for (const why of handsOn(job, target)) no(why);
      }
    }

    // dazzer-app's stricter class, the workflow's part: top permissions exactly contents: read,
    // and no secret or token named outside its jobs (a top-level env reaches every job).
    if (strictWorkflow) {
      const p = js.permissions;
      if (!(isObj(p) && Object.keys(p).length === 1 && p.contents === 'read')) say(path, 1, null, `holds a job that ${STRICT_HELD} in ${repository}, a repository strict.json names, and grants its token more than reading the code: ${'permissions' in js ? `permissions ${show(p)}` : 'no top-level permissions written'}. Write permissions: contents: read at the top.`);
      for (const [key, text] of wf.topText) {
        if (namesIn('secret', text)) say(path, 1, null, `holds a job that ${STRICT_HELD} in ${repository}, a repository strict.json names, and its top-level ${key} names a secret, which reaches every job.`);
        if (namesIn('token', text)) say(path, 1, null, `holds a job that ${STRICT_HELD} in ${repository}, a repository strict.json names, and its top-level ${key} hands on the token, which reaches every job.`);
      }
    }
  }
  const lines = refusals.map((r) => `${r.path}:${r.line} ${r.job === null ? '' : `jobs.${r.job}: `}${r.why}`);
  return { refusals, lines, notes, nothing: false, moving: isMoving };
}

// Every decoded key or value of a part that holds the word secrets, in any case (the scans' rule).
function secretWords(x) {
  const out = [];
  const visit = (v) => {
    if (typeof v === 'string') { if (NAMES_A_SECRET.test(v)) out.push(v.trim().split('\n').find((l) => NAMES_A_SECRET.test(l))?.trim() ?? v.trim()); }
    else if (Array.isArray(v)) v.forEach(visit);
    else if (isObj(v)) for (const [k, e] of Object.entries(v)) { if (NAMES_A_SECRET.test(k)) out.push(`${k}:${typeof e === 'string' ? ` ${e}` : ''}`); visit(e); }
  };
  visit(x);
  return out;
}

// A change check, or a job kept.json names with the effect checks: its runs-on reaches a
// CHECKS_RUNNER_<N> setting on every route with GitHub's machine of N cores as its fallback
// (decision 15), it holds no secret beyond secrets.json, no write but the one its checks entry
// names, and it is not on pull_request_target.
function judgeChecks({ repository, js, job, runsOn, literal, write, entry, secretReads, allowedSecrets, triggers, no, noAt, routes, w, id }) {
  if (literal !== null) {
    noAt(`is kept by kept.json's checks entry but names the literal label '${literal}', so it does not read CHECKS_RUNNER_<N> as a change check does. Read \${{ vars.CHECKS_RUNNER_${coresFromLabel(literal) ?? '<N>'} || '${isGitHubMachine(literal) ? literal : 'ubuntu-latest'}' }}.`);
  } else if (typeof runsOn === 'string') {
    const r = routes.runsOn(runsOn, { wf: w, id, job }, 0);
    if (!r.ok) noAt(`is a change check whose machine could not be read as a CHECKS_RUNNER_<N> setting: ${r.why}.`, r.scan ? { scan: true } : {});
    else {
      const other = r.reached.filter((x) => x.kind !== 'CHECKS');
      if (other.length) noAt(`is a change check whose runs-on reaches ${unique(other.map((x) => x.name)).join(', ')}, not a CHECKS_RUNNER_<N> setting: a change check reads its machine from CHECKS_RUNNER_<N> (decision 15).`);
    }
  }
  if (triggers.includes('pull_request_target')) no('reads CHECKS_RUNNER_<N> in a workflow on pull_request_target, which runs with the base repository\'s token on a fork\'s change: such a job stays on GitHub\'s machine (decision 36).');
  if (write) {
    const scopes = write === DEFAULT_TOKEN || write === 'write-all' || write.startsWith('permissions:') ? null : write.split(':')[0];
    const named = entry?.effect === 'checks' && Array.isArray(entry.writes) && scopes !== null && writesOf(js.permissions ?? undefined).concat(writesOf(job.permissions ?? undefined)).every((s) => entry.writes.includes(s.split(':')[0]));
    if (!named) no(`reads its machine from a CHECKS_RUNNER_<N> setting and holds ${write}: a change check on machines of our own holds no write unless its kept.json entry has the effect checks and names that write (decision 47), since on a machine of ours that token is within reach of whatever ran there before it.`);
  }
  const off = secretReads.names.filter((n) => n !== 'GITHUB_TOKEN' && !allowedSecrets.includes(n));
  if (off.length) no(`is a change check and reads ${off.map((n) => `secrets.${n}`).join(', ')}, which machine-rule/secrets.json does not name for ${repository} (${allowedSecrets.join(', ') || 'it names none'}) beside GITHUB_TOKEN. A secret on the machines that check changes is within reach of every change they checked before; add it there in the change that reads it, where a reviewer sees it, or read it in a job that does not check changes.`);
  if (secretReads.whole) no('is a change check and reads the whole secrets context (as toJSON(secrets) does), every secret the repository holds, on the machines that check changes. Read each secret it needs by name, from machine-rule/secrets.json.');
  if (secretReads.computed) no('is a change check and looks a secret up by a name worked out as it runs (secrets[ followed by no quoted name), which could be any secret the repository holds, on the machines that check changes. Read each secret it needs by its quoted name, from machine-rule/secrets.json.');
}

// The jobs dazzer-app's stricter class holds, in its refusals' words: every job but those the
// literal ubuntu-latest or lockedHeldToMain exempts.
const STRICT_HELD = 'runs on neither the literal ubuntu-latest nor the locked setting held to main on a workflow no pull request starts,';

// dazzer-app's stricter class, a job's part (holdsMoreThanTheCode): no secret, no hand-on of the
// workflow's token, no permission of its own, and every checkout keeping no git credential. A call
// names no machine, so holdsMoreThanTheCode held it so too, reading its every line, comments
// included; it asks a grant only as codeql.yml's job codeql calling the shared scan (theCall,
// verdict.test.ts:1248, 1258).
function judgeStrict({ job, text, no, call, theCall }) {
  const who = call ? 'is a call in a repository strict.json names' : `${STRICT_HELD} in a repository strict.json names`;
  if (namesIn('secret', text)) no(`${who}, and names a secret: such a job may run on machines of ours, which hold no more than the code.`);
  if (namesIn('token', text)) no(`${who}, and hands on the workflow's token (github.token, github[...], toJSON(github), a github.* filter or the github context whole inside \${{ }}).`);
  if (!theCall && Object.keys(job).some((k) => k.toLowerCase() === 'permissions')) no(`${who}, and asks for a permission of its own${call ? ': a call there asks a grant only as codeql.yml\'s job codeql, calling the shared scan' : ''}.`);
  if (checkouts(job).some((c) => !keepsNone(c))) no(`${who}, and checks out without persist-credentials: false, so it keeps a git credential.`);
}

// runners' canary.yml and locked-canary.yml (effect canary): started by workflow_dispatch alone,
// under top permissions exactly contents: read, no job-level permission and no secret, on a matrix
// value every one of whose values names one of our own sets literally, since a canary proves each
// set before any setting names it. locked-canary.yml names the locked sets alone and canary.yml
// none of them (decision 223).
function judgeCanary({ repository, file, js, job, triggers, secretReads, no, noAt, routes, w, id }) {
  if (!isCanaryHome(repository, file)) { no(`is kept by a canary entry, which only ${CANARY_WHERE} may hold.`); return; }
  const locked = CANARY_FILES[file];
  // Why a label of ours is not this canary's to name, or null when it is.
  const notItsSet = (v) => (locked ? (isLockedSet(v) ? null : 'not one of the locked sets (dazzer-locked-<N>-core), which alone locked-canary.yml names') : isLockedSet(v) ? 'a locked set, which only locked-canary.yml may name' : null);
  if (!(triggers.length === 1 && triggers[0] === 'workflow_dispatch')) no(`is a canary job of a workflow started by ${triggers.join(', ')}, not by workflow_dispatch alone: the canary is run by hand (decision 50).`);
  const p = js.permissions;
  if (!(isObj(p) && Object.keys(p).length === 1 && p.contents === 'read')) no(`is a canary job of a workflow whose top grants ${show(p)}, not exactly contents: read.`);
  if ('permissions' in job) no('is a canary job and asks for a permission of its own.');
  if (secretReads.names.length || secretReads.whole || secretReads.computed || 'secrets' in job) no('is a canary job and reads a secret: a canary on our machines holds none.');
  const runsOn = job['runs-on'];
  const literal = typeof runsOn === 'string' && !runsOn.includes('${{') ? runsOn.trim() : null;
  if (literal !== null) {
    if (!OUR_MACHINE.test(literal)) noAt(`is a canary job on '${literal}', not one of our own sets.`);
    else if (notItsSet(literal)) noAt(`is a canary job on '${literal}', ${notItsSet(literal)}.`);
    return;
  }
  const m = typeof runsOn === 'string' ? /^\$\{\{\s*matrix\.([A-Za-z_][\w-]*)\s*\}\}$/.exec(runsOn.trim()) : null;
  if (!m) { noAt(`is a canary job whose runs-on, ${show(runsOn)}, is not one matrix value.`); return; }
  const got = routes.matrixValues(m[1], job);
  if (!got || got.unread || got.sources.length || !got.values.length) { noAt(`is a canary job whose matrix.${m[1]} is not a list of our own sets written literally.`); return; }
  for (const v of got.values) {
    if (!OUR_MACHINE.test(String(v))) noAt(`is a canary job whose matrix.${m[1]} takes ${show(v)}, not one of our own sets.`);
    else if (notItsSet(v)) noAt(`is a canary job whose matrix.${m[1]} takes ${show(v)}, ${notItsSet(v)}.`);
  }
}

// A job that calls a reusable workflow (decision 171): only a shared workflow of dazzer-io/.github
// that declares workflow_call, at main or (engineer-review.yml alone) a commit on main; uses,
// permissions and with alone, its grant at most each scope's allowed level, its with: the inputs
// the called workflow declares, and no setting read in it or in its workflow's top. The class
// rules every job meets are judged before it, in judgeFiles.
async function judgeCall({ path, id, job, top, shared, calls, compare }) {
  const out = [];
  const no = (why, scan = false) => out.push({ why, scan });
  const uses = job.uses;
  if (typeof uses !== 'string') { no(`calls ${show(uses)}, which names no workflow.`); return out; }
  const names = CALLABLE.map((p) => basename(p)).join(', ');
  if (/^[.$]\//.test(uses)) { no(`calls ${uses}, a workflow of its own repository: a call is admitted only into ${SHARED}'s shared workflows (${names}) at main or a commit on main, so the jobs it runs are judged where this rule reads them (decision 121).`); return out; }
  const m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/(.+?)@(.+)$/.exec(uses);
  if (!m) { no(`calls ${uses}, which is no <owner>/<repo>/<path>@<ref>, so no workflow is read.`); return out; }
  const [, owner, repo, file, ref] = m;
  const target = CALLABLE.find((p) => p.toLowerCase() === file.toLowerCase());
  const ours = owner.toLowerCase() === ORG && repo.toLowerCase() === '.github' && target;
  if (!ours) { no(`calls ${uses}, a workflow outside ${SHARED}'s shared workflows (${names}), so the machine its jobs run on cannot be read (decision 121).`); return out; }
  const scan = SHARED_SCANS.includes(target);
  if (owner !== ORG || repo !== '.github' || file !== target) no(`calls ${uses}, the shared workflow ${SHARED}/${target} spelled in another letter case: GitHub reads the owner and repository without regard to case, but the scan runner group and the rulesets name ${SHARED}/${target} exactly, so whether its jobs are given their machines is unread. Write ${SHARED}/${target}@main (decision 171).`, scan);
  if (!AT_MAIN.has(ref)) {
    if (/^[0-9a-f]{40}$/.test(ref) && target === PIN_ADMITTED) {
      let status;
      try {
        status = compare ? await compare({ owner: ORG, repo: '.github', base: 'main', head: ref }) : null;
      } catch (e) {
        throw new Unread(`could not ask GitHub whether ${ref} is on ${SHARED}'s main (compare main...${ref}): ${e.message}`);
      }
      if (status === null) throw new Unread(`could not ask GitHub whether ${ref} is on ${SHARED}'s main: no compare was given`);
      if (status !== 'behind' && status !== 'identical') no(`calls ${target} at ${ref}, which GitHub's compare of main...${ref} reads as ${status}, not behind or identical, so it is no commit on ${SHARED}'s main (engineer-review/decide.mjs's confirmOnMain holds the same).`);
    } else if (scan) no(`calls the shared scan ${target} at ${ref}, not at main: the scan runner group admits it at refs/heads/main alone, so at ${ref} its jobs are given no scan machine.`, true);
    else no(`calls ${target} at ${ref}, another ref: a shared workflow is called at main, or, for ${basename(PIN_ADMITTED)} alone, at a commit on main (decision 171).`);
  }
  for (const k of Object.keys(job)) if (!['uses', 'permissions', 'with'].includes(k)) no(`writes ${k}: in a call of the shared workflow ${basename(target)}, beside uses, permissions and with, the only keys such a call holds (decision 171)${k === 'secrets' ? '; secrets: inherit would hand it every secret the repository holds' : ''}. Remove ${k}:.`);
  const allowed = calls.get(target);
  if (!allowed) throw new Unread(`could not read ${SHARED}'s ${target}, so what a call of it may hold is unread`);
  if (!allowed.callable) no(`calls ${basename(target)}, which declares no workflow_call, so GitHub refuses to run it as a called workflow and its jobs are no shared workflow's (decision 171). Call one of the shared workflows that declares it.`, scan);
  const said = Object.entries(allowed.grant).map(([s, l]) => `${s}: ${l}`).join(', ') || 'nothing';
  if (!('permissions' in job)) no(`calls ${basename(target)} with no permissions: of its own, so it hands the called workflow its workflow's grant or the repository's default token; write the job's own permissions:, at most ${said}.`);
  else if (!isObj(job.permissions)) no(`calls ${basename(target)} granting permissions: ${show(job.permissions)}, not a map of scopes at most ${said}.`);
  else for (const [scope, level] of Object.entries(job.permissions)) {
    if (!Object.hasOwn(allowed.grant, scope) || !['none', 'read', allowed.grant[scope]].includes(level)) no(`calls ${basename(target)} granting ${scope}: ${level}, more than ${said}, the most its jobs use, and a called workflow's token is at most its caller's (decision 171).`);
  }
  if ('with' in job) {
    if (!isObj(job.with)) no(`calls ${basename(target)} with ${show(job.with)} under with:, not a map of its inputs.`);
    else for (const k of Object.keys(job.with)) if (!allowed.inputs.includes(k)) no(`calls ${basename(target)} handing it ${k} under with:, an input it does not declare (${allowed.inputs.join(', ') || 'it declares none'}). Remove ${k}.`);
  }
  const own = settingReadsIn(job).families;
  const reads = settingReadsIn({ job, top }).families;
  for (const kind of ['CHECKS', 'SCAN', 'LOCKED']) if (reads[kind].size) no(`calls ${basename(target)} and reads ${[...reads[kind]].join(', ')}, a ${kind}_ setting${[...reads[kind]].some((n) => !own[kind].has(n)) ? ', in its workflow\'s top' : ''}: the called workflow's jobs name their own machines, a setting handed in could move them, and a call is no change check, which alone reads its machine from a setting (decision 171).`, kind === 'SCAN');
  if (target === '.github/workflows/codeql.yml' && id !== 'codeql') no(`calls the shared scan as the job ${id}, so GitHub shows its check as '${id} / CodeQL complete', not 'codeql / CodeQL complete', the one check a ruleset requires of every caller. Write the job as codeql.`);
  if (shared && !SHARED_SCANS.includes(path) && scan) no(`calls the scan workflow ${basename(target)} from ${basename(path)}, outside the two scans: only the scans' own jobs run on the scan machines (decision 93).`, true);
  return out;
}

// ================================================================ reading at GitHub (for --readings)
export class ReadFailure extends Error {}
export async function readWorkflowAt({ repo, path, ref, call }) {
  const f = await call(`/repos/${ORG}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`, 'application/vnd.github.raw+json');
  if (f.status !== 200) throw new ReadFailure(`could not read ${ORG}/${repo} ${path} at ${ref}: GitHub answered ${f.status}`);
  return f.text;
}
// One repository's workflows at a branch. A folder that answers 404 is no workflows only when the
// repository and the branch both answer 200; a missing branch is unread.
export async function readAtGitHub({ repo, call, ref }) {
  const at = encodeURIComponent(ref);
  const dir = await call(`/repos/${ORG}/${repo}/contents/${WORKFLOW_DIR}?ref=${at}`);
  if (dir.status === 404) {
    const b = await call(`/repos/${ORG}/${repo}/branches/${at}`);
    if (b.status === 200) return { repo, branch: ref, files: [] };
    if (b.status === 404) throw new ReadFailure(`could not read ${ORG}/${repo} at ${ref}: the repository has no branch ${ref} (GitHub answered 404 for it and for its workflows), so its workflows are unread`);
    throw new ReadFailure(`could not read ${ORG}/${repo} at ${ref}: GitHub answered ${b.status} for the branch and 404 for its workflows`);
  }
  if (dir.status !== 200) throw new ReadFailure(`could not read ${ORG}/${repo} ${WORKFLOW_DIR} at ${ref}: GitHub answered ${dir.status}`);
  let list;
  try {
    list = JSON.parse(dir.text);
  } catch {
    throw new ReadFailure(`could not read ${ORG}/${repo} ${WORKFLOW_DIR} at ${ref}: the answer is not JSON`);
  }
  if (!Array.isArray(list)) throw new ReadFailure(`could not read ${ORG}/${repo} ${WORKFLOW_DIR} at ${ref}: it is not a folder`);
  const files = [];
  for (const e of list) {
    if (!e || e.type !== 'file' || !/\.ya?ml$/.test(String(e.name))) continue;
    const path = `${WORKFLOW_DIR}/${e.name}`;
    files.push({ path, text: await readWorkflowAt({ repo, path, ref, call }) });
  }
  return { repo, branch: ref, files };
}
export async function readAtDefaultBranch({ repo, call }) {
  const r = await call(`/repos/${ORG}/${repo}`);
  if (r.status !== 200) throw new ReadFailure(`could not read ${ORG}/${repo}: GitHub answered ${r.status} for the repository, so its default branch is unread`);
  let about;
  try {
    about = JSON.parse(r.text);
  } catch {
    about = null;
  }
  const branch = about?.default_branch;
  if (typeof branch !== 'string' || !branch) throw new ReadFailure(`could not read ${ORG}/${repo}'s default branch: GitHub's answer for the repository names none`);
  return { ...(await readAtGitHub({ repo, call, ref: branch })), visibility: about.visibility ?? (about.private ? 'private' : 'public') };
}

// GitHub keeps every workflow a job calls directly in .github/workflows, and connects at most ten
// levels of them.
const CALLED_PATH = /^\.github\/workflows\/[^/]+\.ya?ml$/;
export const CALL_LEVELS = 10;
const sharedScanCall = (uses) => {
  const m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/(.+?)@(.+)$/.exec(String(uses ?? ''));
  if (!m || m[1].toLowerCase() !== ORG || m[2].toLowerCase() !== '.github' || !SHARED_SCANS.includes(m[3])) return null;
  return { path: m[3], ref: m[4], exact: m[1] === ORG && m[2] === '.github' };
};

// THE CALLS, READ AT THEIR OWN REF (runners' readCalls, moved here): every workflow a job of the
// repositories read calls, read from GitHub at the ref the call names, its own calls followed in
// turn up to GitHub's ten levels. A called workflow reads vars in its caller's context (decision
// 98). <owner>/<repo>/<path>@<ref> is read at <ref>; $/<path> in the calling file's own
// repository at its own ref; ./<path> there too when the calling file is one of the repositories
// read, and unread inside a called workflow. A call to an owner other than dazzer-io, to a file
// outside .github/workflows, or that GitHub does not answer at its ref is unread. A call into a
// shared scan at any ref but main, or spelled in another letter case, is not followed: the judge
// refuses it at the first level (judgeCall) and scanReadsOfCalled at every level below.
export async function readCalls({ call, reads }) {
  const lower = (s) => String(s).toLowerCase();
  const readOf = new Map(reads.map((r) => [lower(r.repo), r]));
  const groups = new Map();
  const fetched = new Map();
  const unread = [];
  const queue = [];
  for (const r of reads) for (const f of r.files) queue.push({ repo: r.repo, ref: r.branch, path: f.path, text: f.text, top: r.repo, level: 1, read: r });
  while (queue.length) {
    const at = queue.shift();
    const wf = readWorkflow(at.text);
    if (!wf.js || !isObj(wf.js.jobs)) continue;
    for (const [id, job] of Object.entries(wf.js.jobs)) {
      if (!isObj(job) || !('uses' in job)) continue;
      const uses = job.uses;
      const refuse = (why) => unread.push({ repo: at.repo, ref: at.ref, path: at.path, job: id, top: at.top, uses, why });
      if (typeof uses !== 'string') { refuse(`which names no workflow (uses is ${show(uses)})`); continue; }
      let repo;
      let ref;
      let path;
      const self = /^([.$])\/(.+)$/.exec(uses);
      if (self) {
        if (uses.includes('@')) { refuse('a call into its own repository, which GitHub takes with no @<ref>'); continue; }
        path = self[2];
        if (at.read) {
          if (!at.read.files.some((f) => f.path === path)) refuse(`which ${ORG}/${at.repo} does not hold on ${at.ref}, the branch read`);
          continue;
        }
        if (self[1] === '.') { refuse(`a ./ call inside a workflow called from ${ORG}/${at.top}: GitHub's documents say it is "from the same commit as the caller workflow", not which caller's, so it is not read; call it as $/${path} or ${ORG}/${at.repo}/${path}@<ref>`); continue; }
        repo = at.repo;
        ref = at.ref;
      } else {
        const m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/(.+?)@(.+)$/.exec(uses);
        if (!m) { refuse('which is no <owner>/<repo>/<path>@<ref>, ./<path> or $/<path>, so no workflow is read'); continue; }
        if (lower(m[1]) !== ORG) { refuse(`of an owner other than ${ORG}, whose workflows are not read`); continue; }
        const scan = sharedScanCall(uses);
        if (scan && !(scan.exact && AT_MAIN.has(scan.ref))) continue;
        [, , repo, path, ref] = m;
      }
      if (!CALLED_PATH.test(path)) { refuse('a file outside .github/workflows, where GitHub keeps every workflow a job calls'); continue; }
      if (at.level + 1 > CALL_LEVELS) { refuse(`level ${at.level + 1} of a chain of calls: GitHub connects at most ${CALL_LEVELS} levels of workflows`); continue; }
      const own = readOf.get(lower(repo));
      if (own && own.branch !== undefined && (ref === own.branch || ref === `refs/heads/${own.branch}`)) {
        if (!own.files.some((f) => f.path === path)) refuse(`which ${ORG}/${own.repo} does not hold on ${own.branch}, the branch read`);
        continue;
      }
      const key = `${lower(repo)}@${ref}`;
      const fileKey = `${key}:${path}`;
      if (fetched.has(fileKey)) {
        if (fetched.get(fileKey).why) refuse(fetched.get(fileKey).why);
        continue;
      }
      let text;
      try {
        text = await readWorkflowAt({ repo, path, ref, call });
      } catch (e) {
        if (!(e instanceof ReadFailure)) throw e;
        const why = `which is unread: ${e.message}`;
        fetched.set(fileKey, { why });
        refuse(why);
        continue;
      }
      fetched.set(fileKey, { text });
      if (!groups.has(key)) groups.set(key, { repo, ref, files: [] });
      groups.get(key).files.push({ path, text, top: at.top });
      queue.push({ repo, ref, path, text, top: at.top, level: at.level + 1, read: null });
    }
  }
  return { called: [...groups.values()], unread };
}

// Every SCAN_ read in workflows read at a ref for a call, outside the shared scans at main: each
// one's file, job and names, said as a refusal of the repository whose run reaches it. So is every
// call such a workflow makes of a shared scan not spelled exactly at main, at whatever level the
// call is (runners' switch-on S6, scanReadsOf), and every spelling a called workflow holds that the
// judge refuses, since what it reads could not be judged (runners' check-repos-read-setting.mjs
// 728, switch-on.mjs 623).
export function scanReadsOfCalled(called) {
  const found = [];
  for (const g of called) {
    for (const f of g.files) {
      if (lower(g.repo) === '.github' && AT_MAIN.has(g.ref) && SHARED_SCANS.includes(f.path)) continue;
      const wf = readWorkflow(f.text);
      if (wf.misread.length) {
        const m = wf.misread[0];
        found.push({ top: f.top, line: `${ORG}/${g.repo} ${f.path} at ${g.ref}, in ${ORG}/${f.top}'s run, holds a spelling this rule refuses, so what it reads could not be judged: line ${m.line} ${m.why}${wf.misread.length > 1 ? ` (and ${wf.misread.length - 1} more)` : ''}` });
      }
      if (!wf.js || !isObj(wf.js.jobs)) { found.push({ top: f.top, line: `${ORG}/${g.repo} ${f.path} at ${g.ref} could not be read: it has no jobs mapping it can read` }); continue; }
      const top = settingReadsIn(topOf(wf.js)).scans;
      if (top.length) found.push({ top: f.top, line: `${ORG}/${g.repo} ${f.path} (the workflow's top) at ${g.ref} reads ${top.join(', ')}, a scan setting, in ${ORG}/${f.top}'s run` });
      for (const [id, job] of Object.entries(wf.js.jobs)) {
        const names = settingReadsIn(job).scans;
        if (names.length) found.push({ top: f.top, line: `${ORG}/${g.repo} ${f.path} ${id} at ${g.ref} reads ${names.join(', ')}, a scan setting, in ${ORG}/${f.top}'s run: the scan runner group gives a machine to the shared scans at main alone` });
        const scan = isObj(job) && typeof job.uses === 'string' ? sharedScanCall(job.uses) : null;
        if (scan && !(scan.exact && AT_MAIN.has(scan.ref))) found.push({ top: f.top, line: `${ORG}/${g.repo} ${f.path} ${id} at ${g.ref} calls the shared scan ${scan.path} ${scan.exact ? `at ${scan.ref}` : `as ${job.uses}`}, not at main spelled exactly ${ORG}/.github/${scan.path}@main, in ${ORG}/${f.top}'s run: the scan runner group gives a machine to the shared scans at main alone (decisions 93, 160, 171)` });
      }
    }
  }
  return found;
}
const lower = (s) => String(s).toLowerCase();

// THE READINGS: every private, non-archived repository of the organisation (or those --only
// names) read at its default branch, judged by this rule, its calls followed. Gives { lines,
// refused, unread }; each line names its repository.
export async function readings({ call, lists, moving = [], only = null, production = false, compare = null }) {
  const lines = [];
  const unreadLines = [];
  let refused = 0;
  const repos = [];
  for (let page = 1; ; page += 1) {
    const r = await call(`/orgs/${ORG}/repos?per_page=100&type=all&page=${page}`);
    if (r.status !== 200) throw new ReadFailure(`could not list ${ORG}'s repositories: GitHub answered ${r.status}`);
    let list;
    try { list = JSON.parse(r.text); } catch { throw new ReadFailure(`could not list ${ORG}'s repositories: the answer is not JSON`); }
    if (!Array.isArray(list)) throw new ReadFailure(`could not list ${ORG}'s repositories: the answer is no list`);
    repos.push(...list);
    if (list.length < 100) break;
  }
  const chosen = repos.filter((r) => r && (only ? only.includes(r.name) : r.private === true && r.archived !== true)).map((r) => r.name).sort();
  if (only) for (const name of only) if (!chosen.includes(name)) unreadLines.push(`UNREAD ${ORG}/${name}: the organisation lists no such repository`);
  const reads = [];
  for (const name of chosen) {
    try {
      reads.push(await readAtDefaultBranch({ repo: name, call }));
    } catch (e) {
      if (!(e instanceof ReadFailure)) throw e;
      unreadLines.push(`UNREAD ${ORG}/${name}: ${e.message}`);
    }
  }
  for (const r of reads) {
    const repository = `${ORG}/${r.repo}`;
    if (!r.files.length) { lines.push(`NOTHING TO JUDGE ${repository}: it holds no ${WORKFLOW_DIR} folder on ${r.branch}, its default branch, so no job of it was judged (never read as clean)`); continue; }
    let result;
    try {
      result = await judgeFiles({ repository, visibility: r.visibility, files: r.files, ...lists, moving: moving.includes(r.repo) ? true : null, shared: repository === SHARED, compare });
    } catch (e) {
      if (!(e instanceof Unread)) throw e;
      unreadLines.push(`UNREAD ${repository}: ${e.message}`);
      continue;
    }
    for (const x of result.refusals) {
      if (production && !x.production) continue;
      refused += 1;
      lines.push(`REFUSED ${repository} on ${r.branch} ${x.path}:${x.line} ${x.job === null ? '' : `jobs.${x.job}: `}${x.why}`);
    }
  }
  if (!production) {
    const { called, unread } = await readCalls({ call, reads });
    for (const u of unread) { refused += 1; lines.push(`REFUSED ${ORG}/${u.top}: ${ORG}/${u.repo} ${u.path} ${u.job} at ${u.ref} calls ${u.uses}, ${u.why}`); }
    for (const f of scanReadsOfCalled(called)) { refused += 1; lines.push(`REFUSED ${ORG}/${f.top}: ${f.line}`); }
  }
  return { lines, unread: unreadLines, refused };
}

// ================================================================ the command
// An origin on github.com, in its https or ssh form: the one place a copy is dazzer-io/.github.
const ON_GITHUB = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;
// The host of an origin, said in place of its whole address, which may carry a token.
export function hostOf(url) {
  const s = String(url).trim();
  const scp = /^[^@/:\s]+@([^:/\s]+):/.exec(s);
  if (scp) return scp[1];
  try {
    const u = new URL(s);
    if (u.protocol === 'file:' || !u.hostname) return null;
    return u.hostname;
  } catch {
    return null;
  }
}
export function originNamesShared(url) {
  const g = ON_GITHUB.exec(String(url).trim());
  return Boolean(g && g[1] === ORG && g[2] === '.github');
}
const defaultGitRemote = (path) => execFileSync('git', ['-C', path, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
// GitHub's compare of main...<commit>, its status field, through fetch (GH_TOKEN when set).
export const defaultCompare = async ({ owner, repo, base, head }) => {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) };
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`, { headers });
  if (res.status !== 200) throw new Error(`GitHub answered ${res.status}`);
  const body = await res.json();
  if (typeof body?.status !== 'string') throw new Error('GitHub\'s answer names no status');
  return body.status;
};

const USAGE = 'usage: node machine-rule/judge.mjs --repository <owner>/<name> --visibility <public|private|internal> [--moving] <folder>';

export async function main(argv, { out = console.log, err = console.error, gitRemote = defaultGitRemote, compare = defaultCompare, listsDir = HERE } = {}) {
  let repository = null;
  let visibility = null;
  let moving = null;
  let folder = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repository') repository = argv[++i] ?? null;
    else if (a === '--visibility') visibility = argv[++i] ?? null;
    else if (a === '--moving') moving = true;
    else if (a.startsWith('--')) { err(`${USAGE}\nunknown flag ${a}`); return 2; }
    else folder = a;
  }
  if (!repository || !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !['public', 'private', 'internal'].includes(visibility) || !folder) { err(USAGE); return 2; }
  let lists;
  try {
    lists = readLists(listsDir);
  } catch (e) {
    if (!(e instanceof Unread)) throw e;
    err(`UNREAD: ${e.message}`);
    return 2;
  }
  let shared = false;
  if (repository === SHARED) {
    let origin = null;
    try { origin = gitRemote(folder); } catch { origin = null; }
    if (!origin || !originNamesShared(origin)) {
      const host = origin ? hostOf(origin) : null;
      const said = origin === null ? 'has no origin it can read' : host === null ? 'has an origin that is a local path' : host === 'github.com' ? 'has an origin on github.com naming another repository or the organisation in another case' : `has an origin on ${host}`;
      err(`UNREAD: ${folder} is read as ${SHARED} only when its origin can be read and names exactly ${SHARED} on github.com; it ${said}, so whether its shared scans may read a scan setting is unknown.`);
      return 2;
    }
    shared = true;
  }
  const files = readFolder(folder);
  if (files === null || files.length === 0) {
    out(`machine-rule: NOTHING TO JUDGE: ${folder} holds no workflow in ${WORKFLOW_DIR}, so no job of ${repository} was judged (never read as clean).`);
    return 0;
  }
  let result;
  try {
    result = await judgeFiles({ repository, visibility, files, ...lists, moving, shared, compare });
  } catch (e) {
    if (!(e instanceof Unread)) throw e;
    err(`UNREAD: ${e.message}`);
    return 2;
  }
  for (const n of result.notes) out(n);
  if (result.lines.length) {
    out(`machine-rule: ${result.lines.length} refused in ${repository} (${visibility}${result.moving ? ', its workflows read a CHECKS_ or LOCKED_ setting' : ''}):`);
    for (const l of result.lines) out(l);
    return 1;
  }
  out(`machine-rule: ${files.length} workflow${files.length === 1 ? '' : 's'} of ${repository} (${visibility}${result.moving ? ', its workflows read a CHECKS_ or LOCKED_ setting' : ''}) judged: nothing refused.`);
  return 0;
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) process.exitCode = await main(process.argv.slice(2));
