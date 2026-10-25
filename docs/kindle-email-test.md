# The Send to Kindle test

The bench guesses which EPUBCheck errors make Amazon reject a file (`KINDLE_CRITICAL` in `bench/run.ts`). This test replaces the guess with what Amazon actually does. It needs a real Kindle account, so a person runs it.

## What you need

- `kindle-test-50.zip`: 50 broken corpus files in `original/`, Magpie's fixed copies in `magpie/`, and `kindle-log.csv`. The list is `corpus/kindle-sample.txt`: one single-defect file for each of the 25 defect types, topped up with multi-defect files.
- Your Send to Kindle address: amazon.com, Account, Manage Your Content and Devices, Preferences, Personal Document Settings. It looks like `name_abc123@kindle.com`.
- The email you'll send from must be on the Approved Personal Document E-mail List on that same page.

## Steps

1. Send each file in `original/` as its own email, one attachment, empty subject. One file per message is what makes each rejection attributable.
2. Do the same for `magpie/`.
3. Wait about 15 minutes. Amazon emails you for each failure ("We couldn't process your document" or similar). Successes show up at amazon.com/sendtokindle and on the device.
4. Fill in `kindle-log.csv`: `result` (delivered / rejected), `amazon_message` (paste the reason), and for delivered books whether the cover, title and author look right on the device.
5. Drop the CSV back into the project. The bench will then use the observed rejections instead of the guessed list.

Amazon throttles heavy senders, so spread 100 emails over an hour or two. A rejected test file has no effect on your account.
