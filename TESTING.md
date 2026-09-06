# Testing

```bash
bun test              # the whole suite
bun test test/L0-*    # one layer
bun run check         # tsc --noEmit, the type gate
```

## DO-178C **inspired** standard

It is the standard behind flight-control software. And crucially it is **objective-based: it says what must be shown to be true, and leaves the method open. we steal this standard for testing this project.

## Requirement

DO-178C assigns software a **Design Assurance Level** from the severity of what happens when it fails:

| DAL | Failure condition | Objectives (Annex A)     |
| --- | ----------------- | ------------------------ |
| A   | Catastrophic      | 71, 30 with independence |
| B   | Hazardous         | 69, 18 with independence |
| C   | Major             | 62, 5 with independence  |
| D   | Minor             | 26, 2 with independence  |
| E   | No safety effect  | 0                        |

_(Annex A totals; exact tallies vary slightly with how the supplements are counted.)_

Those objectives live in ten tables, A-1 through A-10. Two of them are the testing ones, and they are the two this suite is organised around:

**Table A-6 — Testing of Outputs of the Integration Process**

1. Executable Object Code complies with high-level requirements
2. Executable Object Code is **robust** with high-level requirements
3. Executable Object Code complies with low-level requirements
4. Executable Object Code is **robust** with low-level requirements
5. Executable Object Code is compatible with the target computer

**Table A-7 — Verification of Verification Process Results**

1. Test procedures are correct
2. Test results are correct and discrepancies explained
3. Test coverage of high-level requirements is achieved
4. Test coverage of low-level requirements is achieved
5. Structural coverage — **MC/DC** (Level A only)
6. Structural coverage — **decision coverage** (A, B)
7. Structural coverage — **statement coverage** (A, B, C)
8. Structural coverage — **data coupling and control coupling** (A, B, C)
9. Verification of additional code not traceable to source (Level A)

Four ideas underneath those tables carry over to this codebase:

- **Requirements-based testing.** Tests are written against a stated requirement, not derived from reading the implementation. A test written by looking at the code inherits the code's misconceptions.
- **Normal _and_ robustness cases**. Every requirement gets both: what it does with valid input, and what it does with input outside the valid range. The traversal battery in L3 is robustness testing, nothing more exotic.
- **Equivalence classes and boundary values**. Test at the edge of each partition, not in the middle of it.
- **No dead code**. Code that no requirement reaches is removed or explicitly justified as deactivated.

## What this repository does _not_ borrow

Stating this plainly : LautJS is **not** DO-178C software and this suite would not survive a certification audit. OK?

What is borrowed is the _shape_ of the argument: state the requirement, test it normally and abnormally, measure whether the tests reach it, and keep a traceable link between the two.

## Assurance tiers

DO-178C's first move is to grade code by consequence of failure rather than test everything identically. Laut's own tiers, by **how a bug here reaches a user**:

| Tier    | Meaning                                                                                                  | Modules                                                                 | Rigor applied                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **L-A** | Fails **silently, in production only.** No exception, no log — just wrong bytes on a stranger's machine. | `Head.tsx`, `runtime/css.ts`, `runtime/respond.ts`, `server.ts`         | Requirements-based + robustness + boundary cases + golden output. Mutation-checked. |
| **L-B** | Fails **loudly** and breaks the app outright.                                                            | `render.tsx`, `runtime/transpile.ts`, `runtime/vendor.ts`, `Island.tsx` | Requirements-based + boundary cases.                                                |
| **L-C** | **Dev-time only.** Never reaches a production user.                                                      | `runtime/dev.ts`, `DevReload.tsx`                                       | Smoke coverage of the contract.                                                     |
| **L-D** | Thin, or fully constrained by types.                                                                     | `config.ts`, `index.ts`, `preload.ts`, `runtime/api.ts`, `i18n/`        | Contract tests only.                                                                |

The tiering is the whole argument for where effort goes. `Head.tsx` gets the heaviest testing in the repository, because a `<head>` that emits its tags in the wrong order still renders, still passes `tsc`, still looks correct in dev — and quietly drops every inlined stylesheet in production. That is the worst shape a bug can have, and it is exactly what DAL reasoning is for.

## Test layers

| Layer  | Scope                                              | DO-178C analogue                                                                 |
| ------ | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| **L0** | Architecture invariants, read off the repo as data | Table A-5 (coding/integration outputs conform); A-7 #8 (data & control coupling) |
| **L1** | Unit / low-level, pure functions                   | low-level testing; A-6 #3, #4                                                    |
| **L2** | Golden `<head>` output, exact bytes                | A-6 #1 (compliance with high-level requirements)                                 |
| **L3** | Integration against a live `Bun.serve`             | software integration testing; A-6 #1 **and #2**                                  |
| **L6** | Resource budgets — shipped bytes, request count    | A-6 #5 (compatible with the target computer)                                     |

Note :
L4 (browser E2E) and L5 (tarball/scaffold E2E) are designed but not built yet right now. Their absence is the largest known gap in this plan: **nothing here proves an island actually hydrates in a browser.** Everything below L4 verifies the server's output is correct HTML, not that the browser does the right thing with it.

## Requirement IDs

Every `// LAUT-XXX-nn` in `src/` is a pointer, not an abbreviation. The comment that used to explain the code was replaced by the ID; the explanation now lives in the test's own doc comment, where it sits next to the thing that proves it and cannot quietly drift out of agreement with it.

To read why a line in `src/` is the way it is:

```bash
grep -rn "LAUT-RESP-11" test/
```

A range in a file header -- `LAUT-HEAD-01..20` -- refers to all twenty. **LAUT-TRACE-01 checks mechanically that no tag anywhere in `src/` names a test that does not exist**, so a tag is a promise the suite keeps rather than one it makes.

| Prefix   | Covers                                                     | Tests | Lives in                                      |
| -------- | ---------------------------------------------------------- | ----: | --------------------------------------------- |
| `RENDER` | Resolving a page's exports into head data                  |    24 | `L1-render.test.ts`, `L3-server.test.ts`      |
| `HEAD`   | The document `<head>`: contents, order, escaping, inlining |    20 | `L2-head.test.tsx`                            |
| `SRV`    | Routing, access control, traversal defences                |    12 | `L3-server.test.ts`                           |
| `RESP`   | Compression, etags, conditional requests, cache-control    |    12 | `L3-server.test.ts`                           |
| `TRANSP` | Per-request transpile -- what replaces the build step      |    11 | `L1-transpile.test.ts`                        |
| `VENDOR` | The import map, and bare specifier resolution              |    10 | `L0-invariants.test.ts`, `L1-runtime.test.ts` |
| `I18N`   | Translation lookup and fallback                            |     8 | `L1-runtime.test.ts`                          |
| `BUDGET` | Shipped bytes, request count, graph depth                  |     6 | `L6-budgets.test.ts`                          |
| `PKG`    | What actually ships in the tarball                         |     4 | `L0-invariants.test.ts`                       |
| `API`    | JSON endpoints and error disclosure                        |     4 | `L1-runtime.test.ts`, `L3-server.test.ts`     |
| `ARCH`   | Architecture invariants -- what `src/` may depend on       |     3 | `L0-invariants.test.ts`                       |
| `DEV`    | The dev reload stream, and its absence in production       |     2 | `L3-server.test.ts`                           |
| `TRACE`  | Traceability -- every tag in `src/` resolves to a test     |     1 | `L0-invariants.test.ts`                       |

conventions : a test's name begins with its ID, and its doc comment explains _why the requirement exists_, not what the assertion does.

## What is deliberately still not covered

Named here rather than left to be discovered, because an unstated gap reads as a claim of coverage:

- **No browser (L4).** At this moment, Nothing in this suite proves an island actually hydrates. Every test verifies the server emits correct HTML, not that a browser does the right thing with it. The `when` strategies (`load`, `idle`, `visible`, `media`), the client router's `<main>` swap, and hydration mismatches are all unverified. This is the largest gap by some distance.
- **No tarball or scaffold test (L5).** `bun pm pack` -> install -> `bun create` -> boot is untested, so the failures that only appear once published -- a missing `files` entry, a stale `create/template`, a wrong dependency range -- are caught only by LAUT-PKG-01..04 reading the repository, not by exercising the artifact.
- **`runtime/dev.ts` is smoke-tested only** (tier L-C). The watcher's event coalescing, the css-vs-reload decision and the boot-id reconnect logic have no tests. A fault there costs a developer a manual refresh.
- **No coverage or mutation gate.** Individual assertions in this suite were mutation-checked by hand while being written -- the guard was removed, the test was confirmed to fail, the guard was restored -- but nothing enforces that going forward.
