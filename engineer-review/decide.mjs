#!/usr/bin/env node
// Engineer review: settles whether a person who may merge to the repository has
// recorded a review of a pull request's head commit, and sets the commit status
// "Engineer review" on that commit: pending with the reason, or success with who,
// when and the commit (D83, D86).
//
// A review counts when it is either
//   - a pull-request conversation comment whose first line is exactly "reviewed"
//     (any letter case, surrounding spaces ignored), made after the head commit
//     was last pushed, or
//   - an approving review submitted on the head commit itself;
// by a person (never a bot) whose permission on the repository is write or admin.
// A push after the review moves the head and its status is pending again.
//
// The pure part is exported for the tests; run() takes a client so the tests feed it
// recorded GitHub answers. Nothing here names an organisation or repository: they
// come from the run's own context.

import { pathToFileURL } from 'node:url';

export const REVIEW_WORD = 'reviewed';
const PUSH_KINDS = new Set(['push', 'force_push', 'branch_creation']);
const MERGE_PERMISSIONS = new Set(['admin', 'write']);

export function firstLineIsReviewed(body) {
  if (typeof body !== 'string') return false;
  const first = body.split(/\r?\n/, 1)[0];
  return first.trim().toLowerCase() === REVIEW_WORD;
}

export function isBot(user) {
  if (!user || typeof user.login !== 'string') return true; // no known person
  return user.type === 'Bot' || /\[bot\]$/i.test(user.login);
}

// permissionAnswer: GitHub's answer to GET /repos/{o}/{r}/collaborators/{u}/permission,
// or undefined when it could not be read (read as no right).
export function mayMerge(permissionAnswer) {
  if (!permissionAnswer) return false;
  return MERGE_PERMISSIONS.has(String(permissionAnswer.permission || '').toLowerCase());
}

function ms(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

// The moment the head commit last arrived on the pull request's branch, read from
// the head repository's activity (GET /repos/{o}/{r}/activity). Returns an ISO
// string, or null when no push of that commit to that branch is on record.
export function headPushedAt({ headSha, headRef, activity }) {
  if (!headSha || !Array.isArray(activity)) return null;
  const wantRef = headRef ? (headRef.startsWith('refs/') ? headRef : `refs/heads/${headRef}`) : null;
  let latest = null;
  for (const entry of activity) {
    if (!entry || entry.after !== headSha) continue;
    if (!PUSH_KINDS.has(entry.activity_type)) continue;
    if (wantRef && entry.ref && entry.ref !== wantRef) continue;
    const t = ms(entry.timestamp);
    if (!Number.isFinite(t)) continue;
    if (latest === null || t > ms(latest)) latest = entry.timestamp;
  }
  return latest;
}

// A comment whose text changed after it was posted (updated_at later than created_at).
export function wasEdited(c) {
  if (!c || !c.updated_at || !c.created_at) return false;
  const u = ms(c.updated_at);
  const k = ms(c.created_at);
  return !Number.isFinite(u) || !Number.isFinite(k) || u !== k;
}

// input: {
//   pr: { number, headSha, headRef },
//   activity: [...]  head repository activity entries,
//   comments: [...]  GET /repos/{o}/{r}/issues/{n}/comments,
//   reviews:  [...]  GET /repos/{o}/{r}/pulls/{n}/reviews,
//   permissions: { <login>: GET .../collaborators/{login}/permission answer }
// }
// returns { result: 'pass' | 'pending', pr, headSha, pushedAt, evidence, considered, reason }
export function decide(input) {
  const { pr, activity = [], comments = [], reviews = [], permissions = {} } = input || {};
  const headSha = pr && pr.headSha;
  const base = { pr: pr ? pr.number : null, headSha: headSha || null };
  if (!headSha) {
    return { ...base, result: 'pending', pushedAt: null, evidence: null, considered: [], reason: 'the pull request head commit is unknown' };
  }
  const pushedAt = headPushedAt({ headSha, headRef: pr.headRef, activity });
  const considered = [];
  const candidates = [];

  for (const c of comments) {
    if (!c || !firstLineIsReviewed(c.body)) continue;
    const who = c.user && c.user.login;
    const row = { how: 'comment', who: who || null, at: c.created_at, url: c.html_url || null };
    if (isBot(c.user)) { considered.push({ ...row, counted: false, why: 'made by a bot' }); continue; }
    if (c.performed_via_github_app) {
      const app = c.performed_via_github_app.slug || c.performed_via_github_app.name || 'an App';
      considered.push({ ...row, counted: false, why: `posted through ${app}, not by the person's own hand` });
      continue;
    }
    if (wasEdited(c)) {
      // GitHub does not say who made an edit, and D89 counts no comment edited after the
      // last push; one edited before it is already too early. Either way: post a new one.
      considered.push({ ...row, counted: false, why: `edited at ${c.updated_at}; an edited comment does not count, post a new one` });
      continue;
    }
    if (!mayMerge(permissions[who])) { considered.push({ ...row, counted: false, why: 'the author may not merge to this repository' }); continue; }
    if (pushedAt === null) { considered.push({ ...row, counted: false, why: `no record of when ${headSha.slice(0, 7)} was pushed` }); continue; }
    if (!(ms(c.created_at) > ms(pushedAt))) { considered.push({ ...row, counted: false, why: `made before ${headSha.slice(0, 7)} was pushed at ${pushedAt}` }); continue; }
    considered.push({ ...row, counted: true });
    candidates.push({ ...row, commit: headSha });
  }

  for (const r of reviews) {
    if (!r || String(r.state || '').toUpperCase() !== 'APPROVED') continue;
    const who = r.user && r.user.login;
    const row = { how: 'approving review', who: who || null, at: r.submitted_at, url: r.html_url || null };
    if (isBot(r.user)) { considered.push({ ...row, counted: false, why: 'made by a bot' }); continue; }
    if (!mayMerge(permissions[who])) { considered.push({ ...row, counted: false, why: 'the reviewer may not merge to this repository' }); continue; }
    if (r.commit_id !== headSha) {
      considered.push({ ...row, counted: false, why: `given on ${String(r.commit_id || 'an unknown commit').slice(0, 7)}, not the head ${headSha.slice(0, 7)}` });
      continue;
    }
    considered.push({ ...row, counted: true });
    candidates.push({ ...row, commit: headSha });
  }

  if (candidates.length === 0) {
    const reason = pushedAt
      ? `no review by a person who may merge since ${headSha.slice(0, 7)} was pushed at ${pushedAt}`
      : `no approving review on ${headSha.slice(0, 7)}, and no record of when it was pushed`;
    return { ...base, result: 'pending', pushedAt, evidence: null, considered, reason };
  }
  // The earliest qualifying review is the evidence: the first moment the head was reviewed.
  candidates.sort((a, b) => ms(a.at) - ms(b.at));
  return { ...base, result: 'pass', pushedAt, evidence: candidates[0], considered, reason: null };
}

export function summary(d) {
  const lines = ['## Engineer review', ''];
  const sha = d.headSha || 'unknown';
  if (d.result === 'pass') {
    const e = d.evidence;
    lines.push(`**Passed.** ${e.who} recorded a review (${e.how}) at ${e.at} of commit \`${e.commit}\`.`);
  } else {
    lines.push(`**Pending.** ${d.reason}.`);
    lines.push('');
    lines.push(`To pass: a person who may merge comments \`reviewed\` (first line, nothing else on it) after the last push, or approves commit \`${sha}\`.`);
  }
  lines.push('');
  lines.push('| | |', '|---|---|');
  lines.push(`| Pull request | #${d.pr ?? 'unknown'} |`);
  lines.push(`| Head commit | \`${sha}\` |`);
  lines.push(`| Head pushed at | ${d.pushedAt || 'no record'} |`);
  if (d.evidence) {
    lines.push(`| Reviewed by | ${d.evidence.who} |`);
    lines.push(`| Reviewed at | ${d.evidence.at} |`);
    lines.push(`| How | ${d.evidence.how}${d.evidence.url ? ` (${d.evidence.url})` : ''} |`);
  }
  const passed = d.considered.filter((c) => !c.counted);
  if (passed.length) {
    lines.push('', 'Not counted:', '');
    for (const c of passed) lines.push(`- ${c.how} by ${c.who || 'unknown'} at ${c.at}: ${c.why}`);
  }
  return lines.join('\n') + '\n';
}

// One line a later reading can collect (ids, logins and times only).
export function evidenceLine(d) {
  return JSON.stringify({
    result: d.result,
    pr: d.pr,
    headSha: d.headSha,
    pushedAt: d.pushedAt,
    by: d.evidence ? d.evidence.who : null,
    at: d.evidence ? d.evidence.at : null,
    how: d.evidence ? d.evidence.how : null,
  });
}

// merge_group head refs read refs/heads/gh-readonly-queue/<base>/pr-<n>-<sha>.
export function prNumberFromMergeGroup(headRef) {
  const m = /\/pr-(\d+)-[0-9a-f]+$/.exec(String(headRef || ''));
  return m ? Number(m[1]) : null;
}

// ---------- the status (D86) ----------

export const CONTEXT = 'Engineer review';

// Which pull request and commit an event is about, or why it sets nothing.
// returns { skip: '<why>' } or { number, headSha (null: read the live head), statusSha (null: the head) }
export function targetOf(eventName, event) {
  const e = event || {};
  if (eventName === 'pull_request' || eventName === 'pull_request_target') {
    if (!e.pull_request) return { skip: 'the event carries no pull request' };
    return { number: e.pull_request.number, headSha: e.pull_request.head.sha, statusSha: null };
  }
  if (eventName === 'pull_request_review') {
    if (!e.pull_request) return { skip: 'the event carries no pull request' };
    return { number: e.pull_request.number, headSha: null, statusSha: null };
  }
  if (eventName === 'issue_comment') {
    if (!e.issue || !e.issue.pull_request) return { skip: 'a comment on an issue, not a pull request' };
    return { number: e.issue.number, headSha: null, statusSha: null };
  }
  if (eventName === 'merge_group') {
    // A repository using a merge queue adds merge_group to its caller: the status then
    // goes on the queue's commit, settled on the pull request it carries.
    const mg = e.merge_group || {};
    const number = prNumberFromMergeGroup(mg.head_ref);
    if (!number) return { skip: `no pull request number in ${mg.head_ref}` };
    return { number, headSha: null, statusSha: mg.head_sha || null };
  }
  return { skip: `the event ${eventName} is not one this check reads` };
}

// The commit status for a decision. GitHub keeps a status's description to 140 characters.
export function statusFor(d, { sha, runUrl } = {}) {
  const short = (d.headSha || '').slice(0, 7);
  const description = d.result === 'pass'
    ? `Reviewed by ${d.evidence.who} at ${d.evidence.at} (${d.evidence.how}) on ${short}`
    : `Waiting: ${d.reason}`;
  const status = {
    sha: sha || d.headSha,
    state: d.result === 'pass' ? 'success' : 'pending',
    context: CONTEXT,
    description: description.length > 140 ? `${description.slice(0, 139)}…` : description,
  };
  if (runUrl) status.target_url = runUrl;
  return status;
}

// The caller template each gated repository copies (engineer-review/caller.yml) names
// no organisation, repository or commit; the copy is filled with them here.
const SHA = /^[0-9a-f]{40}$/;
const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_])?$/;
export const CALLER_USES = '<owner>/<repo>/.github/workflows/engineer-review.yml@<commit>';
export function renderCaller(template, { owner, repo, commit }) {
  if (!NAME.test(String(owner || ''))) throw new Error(`owner "${owner}" is not an organisation name`);
  if (!/^\.?[A-Za-z0-9._-]+$/.test(String(repo || '')) || String(repo).includes('/')) throw new Error(`repo "${repo}" is not a repository name`);
  if (!SHA.test(String(commit || ''))) throw new Error(`commit "${commit}" is not a full 40-character commit id: the caller pins to a commit, never a branch or tag`);
  if (!template.includes(CALLER_USES)) throw new Error(`the template has no "uses: ${CALLER_USES}" line`);
  return template.split(CALLER_USES).join(`${owner}/${repo}/.github/workflows/engineer-review.yml@${commit}`);
}

// The pin must be a commit already on the shared workflow repository's main branch, never
// one that only a fork carries (GitHub serves a fork's commit under the parent's name, so a
// 40-character id alone proves nothing). compare main...<commit> reads "behind" or "identical"
// exactly when the commit is in main's history.
export const PIN_BRANCH = 'main';
export async function confirmOnMain(client, { owner, repo, commit }) {
  const path = `/repos/${owner}/${repo}/compare/${PIN_BRANCH}...${commit}`;
  const answer = await client.get(path);
  if (!answer) throw new Error(`commit ${commit} is not in ${owner}/${repo}: GitHub has no comparison of it with ${PIN_BRANCH}`);
  if (answer.status !== 'behind' && answer.status !== 'identical') {
    throw new Error(`commit ${commit} is not on ${owner}/${repo} ${PIN_BRANCH} (compare ${PIN_BRANCH}...${commit.slice(0, 7)} reads "${answer.status}"): pin a commit of ${PIN_BRANCH}`);
  }
  return answer.status;
}

// The caller file for a gated repository, refused unless its commit is on main.
export async function callerFor(client, template, { owner, repo, commit }) {
  const text = renderCaller(template, { owner, repo, commit });
  await confirmOnMain(client, { owner, repo, commit });
  return text;
}

// Why this run's token cannot write statuses, or null when it can. GitHub gives a read-only
// token to pull_request and pull_request_review runs of a pull request from a fork, and to
// runs Dependabot starts; comment runs always have the base repository's token.
export function readOnlyReason(eventName, event, actor) {
  if (eventName !== 'pull_request' && eventName !== 'pull_request_review') return null;
  const pr = (event && event.pull_request) || {};
  const base = (pr.base && pr.base.repo && pr.base.repo.full_name) || (event && event.repository && event.repository.full_name);
  const head = pr.head && pr.head.repo ? pr.head.repo.full_name : null;
  if (!head || (base && head !== base)) return 'a pull request from a fork, whose token is read-only';
  if (actor === 'dependabot[bot]') return 'a run started by Dependabot, whose token is read-only';
  return null;
}

// Reads what the decision needs through a client: { all(path, { stop }), get(path) }.
export async function collect(client, repo, number, headShaFromEvent) {
  const pull = await client.get(`/repos/${repo}/pulls/${number}`);
  if (!pull) throw new Error(`pull request #${number} not found in ${repo}`);
  const headSha = headShaFromEvent || pull.head.sha;
  const headRepo = (pull.head.repo && pull.head.repo.full_name) || repo;
  const headRef = pull.head.ref;
  const activity = await client.all(
    `/repos/${headRepo}/activity?ref=${encodeURIComponent(`refs/heads/${headRef}`)}&per_page=100`,
    { maxPages: 5, stop: (items) => items.some((e) => e.after === headSha) },
  );
  const comments = await client.all(`/repos/${repo}/issues/${number}/comments?per_page=100`);
  const reviews = await client.all(`/repos/${repo}/pulls/${number}/reviews?per_page=100`);
  const logins = new Set();
  for (const c of comments) if (c.user && firstLineIsReviewed(c.body) && !isBot(c.user)) logins.add(c.user.login);
  for (const r of reviews) if (r.user && String(r.state).toUpperCase() === 'APPROVED' && !isBot(r.user)) logins.add(r.user.login);
  const permissions = {};
  for (const login of logins) {
    try {
      const body = await client.get(`/repos/${repo}/collaborators/${encodeURIComponent(login)}/permission`);
      if (body) permissions[login] = body;
    } catch (err) {
      client.warn?.(`could not read ${login}'s permission: ${err.message}`);
    }
  }
  return { pr: { number, headSha, headRef }, activity, comments, reviews, permissions };
}

// One run: settle the event and set the status. Returns
// { status: <what was posted> | null, decision | null, skip | null, readOnly }.
// A missing review is a pending status, never a failure; a token that cannot write
// statuses is a skip with its reason; only a failed read or write throws.
export async function run({ eventName, event, repo, client, runUrl, actor }) {
  const target = targetOf(eventName, event);
  if (target.skip) return { status: null, decision: null, skip: target.skip, readOnly: false };
  const readOnly = readOnlyReason(eventName, event, actor);
  if (readOnly) {
    return {
      status: null, decision: null, readOnly: true,
      skip: `${readOnly}; the status is set when a reviewed comment arrives, which runs with the repository's own token`,
    };
  }
  const d = decide(await collect(client, repo, target.number, target.headSha));
  const status = statusFor(d, { sha: target.statusSha, runUrl });
  const { sha, ...body } = status;
  await client.post(`/repos/${repo}/statuses/${sha}`, body);
  return { status, decision: d, skip: null, readOnly: false };
}

// ---------- the command (reads and writes GitHub; the tests use run() with recorded answers) ----------

function githubClient(token = process.env.GITHUB_TOKEN) {
  const base = process.env.GITHUB_API_URL || 'https://api.github.com';
  async function call(path, { method = 'GET', body } = {}) {
    const res = await fetch(path.startsWith('http') ? path : `${base}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'engineer-review',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (method === 'GET' && res.status === 404) return { body: null, next: null };
    if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} answered ${res.status}`);
    const text = await res.text();
    const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') || '');
    return { body: text ? JSON.parse(text) : null, next: next ? next[1] : null };
  }
  return {
    async get(path) { return (await call(path)).body; },
    async all(path, { maxPages = 20, stop } = {}) {
      const out = [];
      let url = path;
      for (let page = 0; url && page < maxPages; page++) {
        const { body, next } = await call(url);
        const items = Array.isArray(body) ? body : [];
        out.push(...items);
        if (stop && stop(items)) break;
        url = next;
      }
      return out;
    },
    async post(path, body) { return (await call(path, { method: 'POST', body })).body; },
    warn(text) { process.stderr.write(`${text}\n`); },
  };
}

function argValue(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main() {
  const fs = await import('node:fs');
  const argv = process.argv.slice(2);
  if (argv[0] === 'caller') {
    // Prints the filled caller file for a gated repository to copy.
    // Reads GitHub (GITHUB_TOKEN or GH_TOKEN if set; the shared repository is public).
    const template = fs.readFileSync(new URL('./caller.yml', import.meta.url), 'utf8');
    process.stdout.write(await callerFor(githubClient(process.env.GITHUB_TOKEN || process.env.GH_TOKEN), template, {
      owner: argValue(argv, 'owner'), repo: argValue(argv, 'repo'), commit: argValue(argv, 'commit'),
    }));
    return 0;
  }
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${server}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : undefined;
  const out = await run({
    eventName: process.env.GITHUB_EVENT_NAME, event, repo: process.env.GITHUB_REPOSITORY,
    client: githubClient(), runUrl, actor: process.env.GITHUB_ACTOR,
  });
  if (out.skip) {
    console.log(out.readOnly ? `::notice title=Engineer review not set::${out.skip}.` : `Nothing to set: ${out.skip}.`);
    return 0;
  }
  const text = `${summary(out.decision)}\nStatus **${CONTEXT}** set to \`${out.status.state}\` on \`${out.status.sha}\`.\n`;
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  process.stdout.write(text);
  console.log(`::notice title=Engineer review::${evidenceLine(out.decision)}`);
  return 0;
}

const invoked = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  main().then((code) => { process.exitCode = code; }, (err) => {
    console.error(`Engineer review could not be settled: ${err.message}`);
    process.exitCode = 1;
  });
}
