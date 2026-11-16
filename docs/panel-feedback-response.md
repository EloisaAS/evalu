# evalU: response to the panel's feedback (system changes)

This lists what was changed **in the system** after the manuscript defense, and where the evidence is.
Items that need research work (interviews, RIECO, stakeholder validation, Chapter 4) are listed at the end:
they cannot be solved by code and are not claimed here.

## How evalU differs from the current HRMC Excel process

| HRMC today (Excel since 2022, per the interview) | evalU |
|---|---|
| Forms answered on separate channels; answers copied and cleaned by hand | Every evaluator answers in one system; answers are validated when submitted (1–4 only, every item, deadline, no double submission) |
| Who evaluates whom is prepared by hand | Tasks are generated from accounts and class lists by rule, with UB's form picked automatically per class type |
| Half + 1 rule checked by hand | Enforced automatically per class, with alerts before the deadline |
| Weights and formulas live inside spreadsheet cells | Policy & rules page: threshold, bands, rounding, missing-group rule, approvals; **every change is a version with a reason**, and each period keeps the version it was computed with |
| Result release by hand; no record of who saw what | HR → VP approval (or return with reason) → faculty, enforced by the server; every view and change logged in a **tamper-evident** audit log |
| Comments typed and distributed manually | Comments encrypted in the database, released without names, hidden when too few students answered |
| No comparison between periods | Period-to-period comparison that warns when rules or forms differ |

## The five priorities and what was done

### 1. Dynamic formula and policy management
- New **Policy & rules** page (HR). Configurable without code: participation % and "plus one", rating bands,
  low-item cutoff, decimal places, what happens when an evaluator group is missing (re-weight or no final rating),
  minimum students before comments are shown, and how many VPs must approve.
- Every change needs a **reason** and becomes a **new version** (who, when, why, before → after).
- **Open periods follow** the change; **closed periods keep** the version they were evaluated under, so past results
  never change. The version used is shown on each period.
- Forms keep their existing versioning (a used form is locked; changes go into a new version).
- Evidence: TC-06, TC-10, TC-11, TC-13, TC-22, TC-23, TC-25 in `docs/test-report.md`.

### 2. Secure governance and approval management
- The approval rule is configurable: every VP, any one VP, or a set number (so one VP on leave cannot block all results).
- A VP can **return results to HR with a reason**; HR is notified, approvals are reset, and the return is shown on the period.
- Release to faculty is refused by the server until the approval rule is met.
- Anonymity: students' comments about a teacher are hidden from the teacher, dean and VP when fewer than the minimum
  number of students answered; students' submission times are never sent outside HR (prevents timestamp matching).
- Evidence: TC-15–TC-21, TC-24, TC-30.

### 3. Audit trail and accountability
- Every audit entry is sealed with a **SHA-256 hash chain** (each entry's hash includes the previous one).
  **Verify integrity** recomputes the chain and shows the first entry that was changed, inserted or deleted.
- Rule changes are logged with **before → after values** and the reason (policy, weights).
- **Export CSV** of the audit log, including each entry's hash.
- Evidence: TC-31, TC-32, TC-33 (an entry edited directly in the database is detected).

### 4. Advanced data processing and analytics
- Class-list import is now two steps: **Check file** (nothing saved) shows new classes, new and existing students,
  **duplicate rows** and invalid rows with row numbers; then **Import**.
- **Compare two periods**: per-person change, improved/declined counts, and a warning when the periods used
  different rules, weights or form versions ("compare with care").
- Low-item flags use the period's policy cutoff.
- Analytics now has **Key findings** (plain-language findings, each with a possible action), **Rating distribution**,
  **Participation** by department, **Strengths and weaknesses by form category**, **Evaluator agreement** (gaps between
  students and supervisors), plus the trend, department comparison, period comparison and item-level results.
- Every analytics card has a **"Where this comes from"** note: which evaluations are counted, the formula, and what the
  card cannot tell (descriptive, not predictive or causal). This answers the panel's "analytical validity" concern.
- Evidence: TC-26, TC-27, TC-14.

### 5. System validation and quality assurance
- `npm run test:validation` runs **33 test cases** (the panel's demonstration scenarios) and writes
  `docs/test-report.md` with expected vs actual results. Current result: **33 / 33 pass**.
- `npm run test:load` simulates **35 users at the same time** and writes `docs/load-test-report.md`
  (response times and errors measured on the run).
- `npm test` runs the logic, API and validation suites together.

## Answers to specific panel questions (from the system side)

| Panel question | Answer with evidence |
|---|---|
| 40 students: is 20 enough? 21? 41 students: is 21 enough? | 20 → excluded, 21 → counted, 41 needs 21 (TC-01–TC-05) |
| Dean does not submit: how is it re-weighted? Is it approved? | Students + Chair over 60% (TC-08); HR can switch the policy to "no final rating" if HRMC decides so (TC-10) |
| One VP on leave blocks all results? | Not if HR sets "any one VP" or a set number (Policy & rules) |
| Can an admin match timestamps to a student? | Submission times are only kept for HR; teachers, deans and VPs never receive them |
| Why 3.50 for low items? | It is now 3.00 by default (UB's "Satisfactory"), shown as a policy setting HR controls, not a hidden constant |
| Modify a form without changing history? | Used forms are locked; revising makes a new version; old answers keep theirs (TC-25) |
| Attempt faculty access before approval | Blocked (TC-17, TC-19) |
| Import duplicate, missing and invalid records | Detected and reported before saving (TC-26, TC-27) |
| Modify a record and inspect the audit history | Before → after values logged; hand edits detected (TC-31–TC-33) |
| Simulate 35 users | `docs/load-test-report.md` |

## Still to be done by the researchers (not solvable in code)
- HRMC's written confirmation of the rules now shown on the Policy & rules page (threshold, bands, missing-group rule,
  approval chain). The page makes each rule visible and changeable, but its *values* still need HRMC approval.
- Validation of requirements with students, faculty, deans, program chairs and VPs.
- Instrument validation records, RIECO clearances, transcripts and the coding matrix.
- The stakeholder evaluation (ISO/IEC 25010 questionnaire) and its statistics.
- Measured time savings against the current Excel process (baseline vs evalU).
- Chapter 4 conclusions and recommendations, and fixing Chapter 2's future-tense description of the interview.

## Dynamic Evaluation Computation Engine (formula configurability, Level 2)

**No formula is built into the program.** The percentages shown at first (e.g. 40% Students + 40% Dean + 20% Program Chair)
are only the *starting formula* saved in the database from the manuscript (Table 6), marked on screen as not yet confirmed
by HRMC. HR replaces it on the **Rating formula** page (or starts a blank formula); the Weights page stays for quick weight changes. Start-up repairs never override a category HR has set (TC-47); a blank formula cannot be
sent until HR chooses the method, the groups and the missing-group rule (TC-48).

The final rating is no longer computed by a formula written in the program. It is computed by an **engine**
(`src/lib/formula.js`) that runs a **formula stored as data** in the database (`formulas` table). HR encodes the
formula the evaluation committee approved; the program does not dictate it.

| What can be configured (no code change) | Options |
|---|---|
| Computation method | Weighted average · simple average of the groups · custom expression |
| Evaluator components | Add or remove groups (any group that has a UB form for that category) |
| Weights | Per group (must total 100% for a weighted average) |
| Aggregation inside a group | Average or median of the evaluators; for students, average of class averages or all students together |
| Missing group | Re-weight · invalidate (no final rating) · count as zero · use the other groups' average |
| Minimum groups | A final rating only when at least N groups have a result |
| Rounding | 0–4 decimals; half up, half to even, down, up |
| Conditions | A formula for a whole category, or only for one department (the department formula wins) |
| Effective period | Each period stores the formula versions it uses (`periods.formulas`) |

**Custom expressions are safe.** They are read by a small built-in calculator that understands only numbers, group
codes, `+ - * /`, brackets and `avg()`, `min()`, `max()`. Nothing is run with `eval`; code such as
`process.exit()` or `constructor(1)` is rejected (TC-38).

**Versioning and approval.** draft (HR) → submitted with the committee's basis → approved or returned by a VP →
activated by HR (the previous version is archived). Approved versions cannot be edited; a change is a new version.
HR cannot approve its own submission. Activating a version applies it to new periods, and to open periods only while
nobody in that category has been evaluated yet, so results already collected are never silently recomputed.
Closing a period **stores every result** (`results` table) with its formula version, breakdown and computation steps.

**Simulation before activation.** The formula page tests a draft with sample scores, with standard cases (each group
missing in turn, only one group), and on a real closed period (current rating vs. the draft's rating, person by person).
Nothing is saved by a simulation.

**Transparency.** Every result shows "How this rating was computed": formula name and version, each group's score,
weight, share used and contribution, and the steps.

Evidence: TC-34 to TC-46 in `docs/test-report.md` (weights 40/40/20 → 30/50/20, simple average, the four missing-group
rules, custom expression, rounding methods, validation, the approval workflow, versioning, stored results, and a
department-only formula).

Note on the reviewer's example: with scores 4.30 / 4.50 / 4.10 and weights 30/50/20 the result is
1.29 + 2.25 + 0.82 = **4.36** (the example in the recommendation says 4.38). The engine gives 4.36 (TC-34).

### Proposed SRS additions (for the manuscript)
- **FR – Dynamic evaluation computation configuration.** The system shall allow authorized administrators to configure
  computation methods, evaluator components, weights, aggregation, missing-data handling, conditions and rounding
  without modifying the application's source code.
- **FR – Formula version management.** The system shall keep version-controlled formulas with approval records; each
  evaluation period and each stored result shall reference the formula version used.
- **NFR – Computational flexibility.** Policy changes shall be made by configuration, provided the operations are
  supported by the engine.

### Limit (state it honestly)
A new combination of supported operations needs no programming. A **new kind of operation** the engine does not know
(for example, a statistical normalisation), or a **new type of evaluator** that does not exist in the system yet
(a new position), still needs a developer. This is a deliberate security boundary.

## Ideas taken from similar systems

| Idea | Taken from | What evalU does | Which UB problem it targets |
|---|---|---|---|
| **QR code per class** | Explorance Blue, Watermark (easy access raises response rates) | HR prints a QR card per class (Class lists), or the teacher shows it in class (My results). Scanning opens evalU; after signing in, that class's evaluation opens directly. The QR holds only a link: students still sign in, and only students on the class list have an evaluation. | Low participation (classes excluded below half + 1) |
| **Comment analysis** | Explorance MLY; Central Philippine University (sentiment analysis) | Each comment is tagged positive / negative / mixed / neutral, marked if it is a suggestion, and sorted into topics (clarity, feedback and grading, punctuality, preparation, approachability, pace, activities, language, professional growth). Summaries appear in Reports and in Analytics ("What the comments are about"), with a Key finding for the most negative topic. Built-in English and Filipino/Taglish word lists; nothing is sent to an outside AI service. | Manual comment handling; limited analytics |

Evidence: TC-49 and TC-50 (comment analysis); the QR flow was checked in the browser (scan link → sign in → the class's evaluation opens).
Limit: the comment tags are a reading aid based on word lists; they can miss sarcasm, so the comments stay visible next to their tags.
