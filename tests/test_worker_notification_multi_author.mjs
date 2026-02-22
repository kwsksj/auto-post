/**
 * Unit tests for multi-author notification logic in the worker.
 *
 * These tests validate the key pure-function logic extracted from
 * apps/worker-api/worker/src/index.js to confirm that:
 *   - a work with multiple authorIds notifies every author
 *   - an email shared by two author entries collects works from all those IDs
 *   - deduplication does not lose authorId associations
 *
 * Run with: node tests/test_worker_notification_multi_author.mjs
 */

import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Helpers copied from index.js (pure functions only)
// ---------------------------------------------------------------------------

function asString(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function uniqueIds(ids) {
  if (!Array.isArray(ids)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of ids) {
    const id = asString(raw).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Simulate the email-deduplication step of collectStudentNotificationRecipients.
 * Each rawRecipient has { authorIds: [string], email: string, name: string }.
 */
function deduplicateRecipientsByEmail(rawRecipients) {
  const recipientByEmail = new Map();
  for (const recipient of rawRecipients) {
    const existing = recipientByEmail.get(recipient.email);
    if (!existing) {
      recipientByEmail.set(recipient.email, {
        authorIds: [...recipient.authorIds],
        email: recipient.email,
        name: recipient.name,
      });
      continue;
    }
    existing.authorIds = uniqueIds([...existing.authorIds, ...recipient.authorIds]);
  }
  return Array.from(recipientByEmail.values());
}

/**
 * Build worksByAuthorId map from a list of works (each has authorIds: [string]).
 */
function buildWorksByAuthorId(works) {
  const map = new Map();
  for (const work of works) {
    for (const authorId of work.authorIds) {
      if (!map.has(authorId)) map.set(authorId, []);
      map.get(authorId).push(work);
    }
  }
  return map;
}

/**
 * Simulate the recipient filtering step of notifyStudentsOnUploadBatch.
 */
function filterRecipients(recipients, worksByAuthorId) {
  return recipients.filter((recipient) =>
    (Array.isArray(recipient.authorIds) ? recipient.authorIds : []).some((id) =>
      worksByAuthorId.has(id),
    ),
  );
}

/**
 * Simulate the per-recipient work collection step of notifyStudentsOnUploadBatch.
 */
function collectWorksForRecipient(recipient, worksByAuthorId) {
  const authorIdsForRecipient = uniqueIds(
    Array.isArray(recipient.authorIds) ? recipient.authorIds : [],
  );
  const workSignatureSet = new Set();
  const worksForRecipient = [];
  for (const authorId of authorIdsForRecipient) {
    const worksForAuthor = worksByAuthorId.get(authorId) || [];
    for (const work of worksForAuthor) {
      const signature = `${work.title}|${(work.authorIds || []).join(",")}`;
      if (workSignatureSet.has(signature)) continue;
      workSignatureSet.add(signature);
      worksForRecipient.push(work);
    }
  }
  return worksForRecipient;
}

function buildRecipientSalutation(recipient) {
  const authorIds = uniqueIds(
    Array.isArray(recipient?.authorIds) ? recipient.authorIds : [],
  );
  if (authorIds.length > 1) return "生徒のみなさま";

  let base = asString(recipient?.name).trim();
  if (base.endsWith("様")) base = base.slice(0, -1).trim();
  if (base.endsWith("さま")) base = base.slice(0, -2).trim();
  if (!base) base = "生徒";
  return `${base}さま`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// --- uniqueIds ---

console.log("uniqueIds");

test("deduplicates identical IDs", () => {
  assert.deepEqual(uniqueIds(["a", "b", "a", "c", "b"]), ["a", "b", "c"]);
});

test("trims whitespace around IDs", () => {
  assert.deepEqual(uniqueIds([" id-1 ", "id-1"]), ["id-1"]);
});

test("returns empty array for non-array input", () => {
  assert.deepEqual(uniqueIds(null), []);
  assert.deepEqual(uniqueIds(undefined), []);
  assert.deepEqual(uniqueIds("string"), []);
});

// --- deduplicateRecipientsByEmail ---

console.log("\ndeduplicateRecipientsByEmail");

test("single recipient with one authorId passes through unchanged", () => {
  const result = deduplicateRecipientsByEmail([
    { authorIds: ["id-a"], email: "a@example.com", name: "Alice" },
  ]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].authorIds, ["id-a"]);
  assert.equal(result[0].name, "Alice");
});

test("two recipients with different emails remain separate", () => {
  const result = deduplicateRecipientsByEmail([
    { authorIds: ["id-a"], email: "a@example.com", name: "Alice" },
    { authorIds: ["id-b"], email: "b@example.com", name: "Bob" },
  ]);
  assert.equal(result.length, 2);
});

test("two recipients sharing the same email merge authorIds", () => {
  const result = deduplicateRecipientsByEmail([
    { authorIds: ["id-a"], email: "shared@example.com", name: "Alice" },
    { authorIds: ["id-b"], email: "shared@example.com", name: "Bob" },
  ]);
  assert.equal(result.length, 1);
  // Both IDs must be present
  assert.ok(result[0].authorIds.includes("id-a"), "missing id-a");
  assert.ok(result[0].authorIds.includes("id-b"), "missing id-b");
});

test("merged recipient retains first name encountered", () => {
  const result = deduplicateRecipientsByEmail([
    { authorIds: ["id-a"], email: "shared@example.com", name: "Alice" },
    { authorIds: ["id-b"], email: "shared@example.com", name: "Bob" },
  ]);
  assert.equal(result[0].name, "Alice");
});

// --- buildWorksByAuthorId ---

console.log("\nbuildWorksByAuthorId");

test("single-author work maps to that author", () => {
  const work = { title: "作品A", authorIds: ["id-a"] };
  const map = buildWorksByAuthorId([work]);
  assert.deepEqual(map.get("id-a"), [work]);
  assert.equal(map.has("id-b"), false);
});

test("multi-author work maps to EACH author", () => {
  const work = { title: "合作", authorIds: ["id-a", "id-b"] };
  const map = buildWorksByAuthorId([work]);
  assert.deepEqual(map.get("id-a"), [work]);
  assert.deepEqual(map.get("id-b"), [work]);
});

test("multiple works with shared and distinct authors", () => {
  const workA = { title: "作品A", authorIds: ["id-a"] };
  const workAB = { title: "合作", authorIds: ["id-a", "id-b"] };
  const workC = { title: "作品C", authorIds: ["id-c"] };
  const map = buildWorksByAuthorId([workA, workAB, workC]);

  assert.equal(map.get("id-a")?.length, 2, "id-a should have 2 works");
  assert.ok(map.get("id-a").includes(workA));
  assert.ok(map.get("id-a").includes(workAB));

  assert.equal(map.get("id-b")?.length, 1, "id-b should have 1 work");
  assert.ok(map.get("id-b").includes(workAB));

  assert.equal(map.get("id-c")?.length, 1, "id-c should have 1 work");
});

// --- filterRecipients ---

console.log("\nfilterRecipients");

test("recipient whose authorId appears in works is kept", () => {
  const work = { title: "作品A", authorIds: ["id-a"] };
  const map = buildWorksByAuthorId([work]);
  const recipients = [{ authorIds: ["id-a"], email: "a@example.com", name: "Alice" }];
  assert.equal(filterRecipients(recipients, map).length, 1);
});

test("recipient whose authorId does NOT appear in works is removed", () => {
  const work = { title: "作品A", authorIds: ["id-a"] };
  const map = buildWorksByAuthorId([work]);
  const recipients = [{ authorIds: ["id-z"], email: "z@example.com", name: "Zara" }];
  assert.equal(filterRecipients(recipients, map).length, 0);
});

test("merged recipient with one matching and one non-matching authorId is kept", () => {
  // id-a has a work, id-b does not
  const work = { title: "作品A", authorIds: ["id-a"] };
  const map = buildWorksByAuthorId([work]);
  const recipients = [
    { authorIds: ["id-b", "id-a"], email: "shared@example.com", name: "Alice" },
  ];
  assert.equal(filterRecipients(recipients, map).length, 1);
});

// --- collectWorksForRecipient ---

console.log("\ncollectWorksForRecipient");

test("single-author recipient gets the work for their ID", () => {
  const work = { title: "作品A", authorIds: ["id-a"] };
  const map = buildWorksByAuthorId([work]);
  const recipient = { authorIds: ["id-a"], email: "a@example.com", name: "Alice" };
  const works = collectWorksForRecipient(recipient, map);
  assert.equal(works.length, 1);
  assert.equal(works[0].title, "作品A");
});

test("multi-author work appears exactly once for the recipient, not duplicated", () => {
  // Same work is accessible via both id-a and id-b; recipient has both
  const work = { title: "合作", authorIds: ["id-a", "id-b"] };
  const map = buildWorksByAuthorId([work]);
  const recipient = { authorIds: ["id-a", "id-b"], email: "shared@example.com", name: "Alice" };
  const works = collectWorksForRecipient(recipient, map);
  assert.equal(works.length, 1, "work must not be duplicated");
  assert.equal(works[0].title, "合作");
});

test("merged recipient (same email, two author IDs) receives works from both IDs", () => {
  const workA = { title: "作品A", authorIds: ["id-a"] };
  const workB = { title: "作品B", authorIds: ["id-b"] };
  const map = buildWorksByAuthorId([workA, workB]);
  // After email merge, recipient has both authorIds
  const recipient = { authorIds: ["id-a", "id-b"], email: "shared@example.com", name: "Alice" };
  const works = collectWorksForRecipient(recipient, map);
  assert.equal(works.length, 2, "both works must be collected");
  const titles = works.map((w) => w.title).sort();
  assert.deepEqual(titles, ["作品A", "作品B"]);
});

test("collaborative work - each co-author receives the work independently", () => {
  // Work with two authors who have different emails → should send to both
  const collabWork = { title: "合作", authorIds: ["id-a", "id-b"] };
  const map = buildWorksByAuthorId([collabWork]);

  const recipientA = { authorIds: ["id-a"], email: "a@example.com", name: "Alice" };
  const recipientB = { authorIds: ["id-b"], email: "b@example.com", name: "Bob" };

  const worksA = collectWorksForRecipient(recipientA, map);
  const worksB = collectWorksForRecipient(recipientB, map);

  assert.equal(worksA.length, 1, "Alice should receive the collab work");
  assert.equal(worksB.length, 1, "Bob should receive the collab work");
});

// --- buildRecipientSalutation ---

console.log("\nbuildRecipientSalutation");

test("single-author recipient gets personalized salutation", () => {
  const recipient = { authorIds: ["id-a"], name: "さくら" };
  assert.equal(buildRecipientSalutation(recipient), "さくらさま");
});

test("strips existing 様 suffix before adding さま", () => {
  const recipient = { authorIds: ["id-a"], name: "田中様" };
  assert.equal(buildRecipientSalutation(recipient), "田中さま");
});

test("multi-authorId recipient gets generic group salutation", () => {
  // Same email mapped to two author IDs
  const recipient = { authorIds: ["id-a", "id-b"], name: "さくら" };
  assert.equal(buildRecipientSalutation(recipient), "生徒のみなさま");
});

test("missing name falls back to 生徒さま", () => {
  const recipient = { authorIds: ["id-a"], name: "" };
  assert.equal(buildRecipientSalutation(recipient), "生徒さま");
});

// ---------------------------------------------------------------------------
// Full end-to-end simulation of notifyStudentsOnUploadBatch logic
// ---------------------------------------------------------------------------

console.log("\nEnd-to-end simulation");

test("two separate authors (different emails) each receive the collaborative work", () => {
  const collabWork = { title: "合作", authorIds: ["id-alice", "id-bob"] };

  // Step 1: Build raw recipients (simulate collectStudentNotificationRecipients result)
  const rawRecipients = [
    { authorIds: ["id-alice"], email: "alice@example.com", name: "Alice" },
    { authorIds: ["id-bob"], email: "bob@example.com", name: "Bob" },
  ];

  // Step 2: Deduplicate by email (no change here since emails differ)
  const recipients = deduplicateRecipientsByEmail(rawRecipients);
  assert.equal(recipients.length, 2);

  // Step 3: Build work map
  const map = buildWorksByAuthorId([collabWork]);

  // Step 4: Filter recipients
  const eligible = filterRecipients(recipients, map);
  assert.equal(eligible.length, 2, "both authors should be eligible");

  // Step 5: Collect works per recipient
  const worksForAlice = collectWorksForRecipient(eligible[0], map);
  const worksForBob = collectWorksForRecipient(eligible[1], map);
  assert.equal(worksForAlice.length, 1, "Alice gets the collab work");
  assert.equal(worksForBob.length, 1, "Bob gets the collab work");
});

test("student with two author entries (same email) receives works from both entries", () => {
  const workForEntry1 = { title: "作品1", authorIds: ["entry-1"] };
  const workForEntry2 = { title: "作品2", authorIds: ["entry-2"] };

  // Two author entries with same email (e.g. duplicate Notion entries)
  const rawRecipients = [
    { authorIds: ["entry-1"], email: "same@example.com", name: "Alice" },
    { authorIds: ["entry-2"], email: "same@example.com", name: "Alice" },
  ];

  // After deduplication: one recipient with both IDs
  const recipients = deduplicateRecipientsByEmail(rawRecipients);
  assert.equal(recipients.length, 1);
  assert.equal(recipients[0].authorIds.length, 2);

  const map = buildWorksByAuthorId([workForEntry1, workForEntry2]);
  const eligible = filterRecipients(recipients, map);
  assert.equal(eligible.length, 1);

  const works = collectWorksForRecipient(eligible[0], map);
  assert.equal(works.length, 2, "both works should be collected for the merged recipient");
});

test("old single-authorId approach would have missed works; new array approach does not", () => {
  // Simulate the OLD broken behaviour vs the NEW correct behaviour
  const workA = { title: "作品A", authorIds: ["id-a"] };
  const workB = { title: "作品B", authorIds: ["id-b"] };
  const map = buildWorksByAuthorId([workA, workB]);

  // Two raw entries with same email
  const rawRecipients = [
    { authorIds: ["id-a"], email: "shared@example.com", name: "Alice" },
    { authorIds: ["id-b"], email: "shared@example.com", name: "Alice" },
  ];

  // OLD approach: email deduplication kept only the first entry → only authorId "id-a"
  // would be used, missing 作品B.
  const oldStyleRecipient = { authorId: "id-a", email: "shared@example.com", name: "Alice" };
  const worksOld = map.get(oldStyleRecipient.authorId) || [];
  assert.equal(worksOld.length, 1, "old approach only finds 1 work");
  assert.equal(worksOld[0].title, "作品A");

  // NEW approach: merge authorIds → both works are found.
  const mergedRecipients = deduplicateRecipientsByEmail(rawRecipients);
  const worksNew = collectWorksForRecipient(mergedRecipients[0], map);
  assert.equal(worksNew.length, 2, "new approach finds both works");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
