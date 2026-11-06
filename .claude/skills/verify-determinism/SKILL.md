---
name: verify-determinism
description: "Check a change against Magpie's determinism test: the same original, plan and cover always build the same bytes and report, at any time and in any time zone. Use whenever a change touches fix() or a fixer, Book.save or anything that writes a zip, the converters (core/src/convert/), the device formats (core/src/send/formats.ts), the cover maker, or core/test/determinism.test.ts."
---

# Verify determinism

A book is its original plus a FixPlan (ADR 0002). The file in `books/` is built again from those two after every edit and undo, and after a power cut (ADR 0008); device copies are cached by the file's hash; a converted EPUB is kept by converter version. So a build must depend on nothing else: not the clock, the time zone, the order a Map happens to hold, or a random number.

`core/test/determinism.test.ts` checks that with fast-check: for a few books (plain, coverless, one whose details come from its pages) it makes up plans (typed or accepted details, turned-down suggestions, a lookup's finds, a chosen cover, kept styling, any stamp) and builds each twice, at two different moments in two time zones, with `mock.timers` and `TZ`. Bytes and report must match. It does the same for turning the Kindle, MOBI and FictionBook fixtures into EPUBs and for each device format.

## Does your change touch it?

It does if it adds anything that reads the time (`Date`, `Date.now`), a random value, the environment or the locale inside a build, or a new kind of zip. A zip's file times are local time with no zone: use `zipTime()` from `epub.ts`, never a default or a UTC `Date`. A new fixer or format is covered by the test already; a new input kind needs a fixture in the list.

## Run it

```sh
node --test core/test/determinism.test.ts                        # 20 plans per book; in just test
DETERMINISM_RUNS=500 node --test core/test/determinism.test.ts   # the nightly depth
```

Before `zipTime()` (at 29d1b59) every test failed on the simplest plan: fflate stamps each zip entry with the current local time. Planting a `Date.now()` into a build should fail it the same way.

## Read a failure

fast-check prints the smallest plan it found. Build it twice in a scratch script and diff the unzipped entries and the reports: the first differing byte is usually a timestamp, an ordering, or a generated id. Fix the build; never pin the test's clock to match.

## What it doesn't cover

Two different machines or Node versions (deflate output can differ between zlib builds; fflate is pure JS, so today it doesn't). The local model's sort guesses, which aren't part of a build.

Last confirmed true to the code at commit `HEAD` (sync commit).
