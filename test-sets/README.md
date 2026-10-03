# Test sets

Real photos kept for re-running the pipeline after any change to the prompts, the
audit or the identity check. **The photos themselves are not in this repository**
(it is public, and they are the store's own stock) - keep the two zips somewhere
backed up, such as the store's Google Drive, and use the checksums below to confirm
you have the right files.

| Set | Files | What it is |
| --- | --- | --- |
| `Generated photos with problem.zip` | `1.png`-`6.png` | AI studio outputs that were wrong when reviewed: the Patti Pot drawn as earrings, the Long Chain Pot with a different pendant, the Rani Har with curled beads and mismatched end stones. |
| `Need Reshooting.zip` | `1.jpeg`-`16.jpeg` | Counter photos the pipeline sent back for reshoot. |

## How to re-run

1. Shoot each photo through the normal Shoot screen with the category and size the
   piece really has (e.g. `Long chain pot`, size `28INCH`, its real weight).
2. Open it in Review and compare Original, Studio and Real photo.
3. Check the admin card "Approval rate by category" after a batch.

## What "fixed" looks like

- A pote / pot piece is **never** drawn as earrings. If the form and the photo
  disagree, the piece stops at "Needs another angle" instead.
- A pendant keeps its design, size and position.
- Beads that were curled on the counter come out in their natural, straight
  arrangement - same beads, same order, same count.
- The two end stones of a haar match in colour unless the original clearly differs.
- Anything the AI cannot do faithfully is still available as **Use real photo**.

## Checksums (first 12 hex of SHA-256)

`Generated photos with problem`: 1.png `bfac9964e0fb`, 2.png `a9255e40abf2`, 3.png `1ef24f2a6cc7`,
4.png `6609bb672ae9`, 5.png `8a3ac307729f`, 6.png `f0db4141e4c7`.

`Need Reshooting`: 1 `c81277f236c9`, 2 `63a7ab9fd20f`, 3 `41078b48a0e8`, 4 `d31d8396d1ab`, 5 `0d91f4e32fc0`,
6 `ec20e23e8fa2`, 7 `2fa5febedc01`, 8 `a17dd2c99f6b`, 9 `64ad6284eb03`, 10 `3d4c74589041`,
11 `e4530247ee2a`, 12 `6707d93ed3ff`, 13 `a120f524824a`, 14 `a40eb2e84e6c`, 15 `7c940354487d`,
16 `2e687a1f9fcc`.
