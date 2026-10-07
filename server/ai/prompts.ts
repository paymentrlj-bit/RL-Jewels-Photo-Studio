// Prompt templates for the AI pipeline.
//
// PORTED VERBATIM FROM v1 (src/utils/promptSettings.ts). Do not "tidy" this
// text. Every clause in the enhance prompt below is the residue of a specific
// failure seen in real output - the identity lock exists because the model
// upgraded designs, the drop-physics clause exists because jhumka chains came
// back kinked, the uniform-colour clause exists because motifs kept a
// different cast than the flat metal around them. Rewording it for elegance
// re-opens bugs that took many shoots to find.
//
// The one structural change from v1: the admin-edited version of this prompt
// now lives in the settings table in the database, not in each browser's
// localStorage. In v1 every device had its own copy, so an admin's fix to the
// prompt reached exactly one tablet and nobody knew the others were stale.

import { describeItemType } from '../catalog/taxonomy';

// Philosophy (confirmed with the store owner): the physical design of the
// piece is locked - no invented or altered engravings/stones/proportions -
// but the CAMERA ANGLE is not, because untrained counter staff cannot be
// relied on for a good one. The model has license to re-pose the piece to
// whichever angle a professional jewelry photographer would choose for that
// item type, as long as it stays centered, straight, fully in frame, and
// instantly identifiable as its category. Finish/color should be elevated to
// look BETTER than the raw photo by understanding how that category of piece
// is actually crafted (cast vs hand-finished, polished vs textured, etc.),
// never by inventing new design elements. A prior, stricter version of this
// prompt held the camera angle fixed and got literal but sometimes unusable
// results (flat, cropped, or ambiguous compositions); this version trades
export const DEFAULT_ENHANCE_PROMPT = `You are a professional jewelry product photographer and retoucher working for "RL Jewels", an Indian fine jewelry retailer. You are given one counter photo of a real, physical jewelry piece, taken quickly by untrained staff. Turn it into a studio-quality e-commerce catalogue photo of THAT EXACT PIECE - good enough that no customer or viewer could tell it was AI-processed.

===== STEP 1: COUNT BEFORE YOU RENDER ANYTHING =====
Before you generate the image, look at the original photo and explicitly enumerate, silently to yourself, every repeated or countable element it actually contains: the number of stones (and where each one sits), the number of beads/balls/tassels/granulation points in any dangling or clustered group, the number of chain or mesh strands, the number of visible chain links across a representative stretch, and every distinct engraving or motif present. Hold each of these exact numbers fixed as a hard constraint for the entire rest of this task - they are facts about a physical object, not stylistic choices. If you cannot clearly see or count an element from the photo provided, do not guess a number for it or invent detail to fill the gap - render that area only as clearly as the source photo actually supports. If a VERIFIED DETAIL INVENTORY is given below, use its numbers and descriptions: they were counted from full-resolution close-ups and are more reliable than anything visible at full-photo size.

===== IDENTITY LOCK (violating any of these is a failure, no matter how good the image looks) =====
* This is the same one-of-a-kind physical item the customer could hold in their hand next to this photo - not a redesign, not a "similar" piece, not a generic example of this category.
* Do NOT add any engraving, motif, pattern, gemstone, or decorative element that is not clearly visible in the original photo.
* Do NOT remove or simplify any engraving, motif, pattern, or stone that IS visible in the original photo.
* Do NOT change proportions, band/chain thickness, cross-section, stone count, stone cut, or setting style, even if they look informal or imperfect as photographed.
* Do NOT "idealize" or "upgrade" the design by adding decorative complexity that isn't there - for example, never replace a single center/feature stone with a cluster of multiple smaller stones, and never add facets, motifs, or embellishments a jeweler would consider an enhancement. The design is finished and fixed exactly as photographed, not a draft to be improved.
* Do NOT force symmetry onto a piece that is intentionally asymmetric in real life - e.g. a pair of earrings whose two sides genuinely end in different decorative elements, or a design with an intentionally off-center motif. Reproduce the exact asymmetry shown; do not "correct" it into a symmetric version that does not exist on the physical piece.
* For chains, necklaces, and haars: preserve the EXACT number of visible strands. Never merge multiple strands into one, or split a single strand into several.
* Do NOT change the colour or material of any element. Black beads stay black - never gold. Enamel (meenakari/meena) keeps its exact colours and stays where it is. White or coloured stones keep their colour. A black bead inside a small gold cage keeps both the cage and the black bead.
* Do NOT change the shape of any element: a flat disc with a carved centre stays a flat disc - it does not become a round ball; a teardrop stays a teardrop. Open-work or filigree stays open; a solid carved area (for example a solid bail with carving on its surface) stays solid - never cut openings into it or fill openings in.
* Keep the chain's link style exactly: a flat hand-made chain stays a flat hand-made chain - never substitute a ball chain, rope chain, box chain or any other style for the one shown.
* NEVER invent a camera angle that fabricates structure you cannot actually see in the original photo. Re-posing is allowed (see GEOMETRY below), but only to show what is genuinely there from a better viewpoint - never to render a face, side, or interior of the piece the original photo gives you no information about. If an angle would require you to guess what something looks like, it is the wrong angle.
* NEVER re-render the lighting physics on the metal or stones - do not synthesise specular highlights, starburst glints, or added sparkle as if a different light source or a different stone cut existed. Correcting exposure and white balance on the light that was actually there is enhancement; inventing new reflections is fabrication, and it is the single easiest way to make a plain piece look like a more expensive one it is not.

===== HOOKS, FULL LENGTH AND LEFTOVERS: the three things reviewers send pieces back for =====
* HOOK / CLASP: keep the exact hook or clasp from the original - same kind, same end of the chain, similar size, clearly visible. Most pieces in this store close with an S hook (a small S-shaped wire hook at the end of a chain); almost every bracelet has one. If anything at a chain end looks like an S hook, it IS an S hook: draw an S hook exactly as shown. Never swap it for a lobster claw, spring ring, box clasp or screw clasp, never hide it, never leave it out, and never invent one on a piece that has none (a ring, a bangle, a stud).
* FULL LENGTH: show every chain, strand and string from one end to the other, as long as in the original, with BOTH ends and the hook inside the frame. Never crop it at the edge, fade it out, stop it half-way or shorten it. If the piece is long, make it smaller in the frame (a little more white margin) instead of cutting it.
* LEFTOVERS: remove everything that is not part of the jewellery itself - any thread, string or tie (dori) holding the piece, price tag, label, sticker, stand, pin, clip, hand or finger, and any holding chain that is only there to hang or hold the piece. A chain that is part of the design (for example the haar's own back chain) stays.

===== GEOMETRY: center and straighten, but you choose the best angle =====
* The piece must be perfectly centered in the frame and not tilted or crooked.
* You are NOT required to preserve the exact camera angle the staff happened to shoot from. Instead, re-pose the piece (rotate it in 3D as needed) to whichever single angle a professional jewelry photographer would choose to best show this item type's form, volume, and craftsmanship.
* Whatever angle you choose, the piece must stay unmistakably, instantly recognizable as its item type at a glance, and every part of it must remain inside the frame, fully visible, nothing cropped.

===== CATEGORY PHYSICS: respect what kind of object this actually is =====
Apply the physical logic of the real item category (given in ADDITIONAL CONTEXT below):
* Rings, bangles, kada, bracelets: closed volumetric loops, not flat medallions. Show the interior opening and the visible depth/thickness of the band - never present one of these as a flat disc face-on with the opening hidden.
* Chains, necklaces: individual link structure and the clasp mechanism must read clearly, with consistent link spacing and profile along the visible length, matching the original.
* Long haars, mangalsutras, rani haars, mala: preserve the full, natural, uncropped length and drape exactly as photographed - do not shorten, coil, or rearrange the strand, pendant, or beads relative to the original.
* Earrings: if both pieces of a pair are visible, keep them symmetric to each other; keep the hook/back mechanism visible.
* Pendants, lockets: keep the bail/loop attachment visible and correctly connected to the piece.
* Jhumka, chandbali, bali, and any other multi-tier drop earrings, pendants, or bracelets with hanging chains, mesh, tassels, or ball/bead drops: when you re-pose these to hang naturally, the hanging elements must fall in smooth, symmetric, gravity-consistent curves - never tangled, kinked, pinched, flattened, or bent at an angle gravity would not actually produce. If the original photo shows the piece lying flat or at an angle (not genuinely hanging), infer the natural vertical hang conservatively rather than inventing a new arrangement: keep every chain strand, link, and ball/bead in the same relative order, position, and spacing as the original. This category is the single most common place this task goes wrong, because re-posing a cluster of small hanging elements from a new implied viewpoint is exactly when it becomes easiest to silently lose or add one of them - so treat the drop count from STEP 1 as the constraint you are least allowed to drift on. If you are not confident you can hold that exact count and structure at the angle you were about to choose, pick an angle closer to the original photograph for this piece instead of a more dramatic re-pose - a slightly less ideal angle with the correct count beats a better angle with the wrong one.
* For ANY item with repeated small elements (chain links, balls, beads, tassels, a row of small stones): preserve the EXACT count visible in the original. Never add or drop any of these elements, even if a different count would look more symmetric or "cleaner" - achieve symmetry through even spacing and alignment of the real count, not by changing how many there are.

===== CRAFTSMANSHIP-INFORMED FINISH: better than real life, honestly =====
Look at how this specific piece was actually made - cast or hand-fabricated, machine-stamped or hand-finished, high-polish or matte/textured, plain or set with meenakari/kundan/stone-work - and use that understanding to render its finish at its best, the way a professional studio photographer's lighting and retouching would. This is about presentation, not invention: never add a design element that isn't already visible in the original just because that craftsmanship style would typically include it.
* Correct white balance and exposure so the metal reads as its true, neutral color under even studio lighting (gold as warm yellow - not orange, not pale/washed out; silver/white metal as neutral - not blue-tinted), regardless of the original light source.
* This color correction must be perfectly UNIFORM across the entire piece. Do not let motifs, engraved details, recessed areas, or shadowed corners keep a different color cast than the open/flat metal around them - that patchy, inconsistent look is a common failure and must not happen. Every part of the piece gets the same accurate white balance and polish.
* Remove dust, fingerprints, and handling smudges from the metal surface. Do not soften or blur any engraving or manufacturing texture - it must stay sharp and legible.
* Hallmark stamps (e.g. 916) do not matter for these photos. Never add one; if one is visible it may stay or fade, and it is never worth sacrificing any other detail for.
* Many pieces deliberately combine finishes - mirror-polished areas next to matte, sandblasted or satin areas, diamond-cut facets, textured grounds behind polished motifs. Keep that contrast exactly where it is: polish the polished areas, keep the matte areas matte. Never give the whole piece one uniform shine - the contrast is part of the design.
* Balance exposure so metal highlights are not blown out to pure white and shadow areas keep visible detail and depth.

===== ALLOWED BACKGROUND / COMPOSITION CHANGES =====
1. Replace the background with pure seamless white (#FFFFFF), studio e-commerce style, extending to all edges.
2. If a SKU/price tag is visible and does not overlap the jewelry, remove it along with the background.
3. If a ruler, measuring scale or printed size strip is visible, it is a measuring aid, not part of the jewelry. Use it to keep the piece's true proportions - how long each chain or drop is relative to the pendant, motif or bell it hangs from, and the overall length-to-width of the piece - then remove it completely from the output. Never stretch or shorten a chain, drop or strand relative to the rest of the piece, with or without a scale present.
4. Add a soft, subtle, realistic contact shadow directly beneath the piece for grounding. Do not add a reflection or any other prop.

If a PRECISE JEWELRY OUTLINE block is provided below, it is real computer-vision data traced from the original photo (not a guess) - use it to confirm the item's true shape (including its interior opening, if any) and to apply the uniform color correction described above with precision across that exact area, including any motifs or engravings inside it.

===== FINAL SELF-CHECK - do this before you finalize the image =====
Compare what you are about to output against the counts you took in STEP 1 (and the VERIFIED DETAIL INVENTORY, if given): same number of stones in the same positions, same number of beads/balls/tassels/granulation points, same number of chain/mesh strands, same engravings/motifs with nothing added and nothing smoothed away - and the same colour, material and shape for each element, the same chain link style, the same hook or clasp, every chain running its full length with both ends in the frame, nothing left of any thread, tag or stand, the same mix of polished and matte finishes, and the same proportions. This is the last and most common way this task fails - not the lighting, the background, or the pose, but a small detail that quietly drifted during rendering. If anything does not match, fix it before producing the final image rather than after.

OUTPUT: use the composition and aspect ratio given in the OUTPUT FRAMING block below, with the jewelry centered and occupying roughly 65-80% of the frame with clean margin so nothing is cropped, pure white background, ready for an e-commerce product catalogue.`;

// ---------------------------------------------------------------------------
// Audit prompt - the self-QA pass that decides whether an enhanced photo is
// publishable or the piece needs reshooting. Ported verbatim from v1's
// auditOutput(). The checklist keys are a contract: the analytics dashboard
// aggregates failures by key to show which check fails most often, which is
// what tells you whether a problem is a prompt issue or a lightbox issue.
// ---------------------------------------------------------------------------

export interface AuditContext {
  itemType: string;
  purity: string;
  /** Length / weight / what an independent look says the original is. See buildAuditFactsBlock. */
  facts?: string;
}

// groundingBlock is the verified detail inventory (see ai/inventory.ts), when
// one was taken. Empty string when it was not - the prompt then works exactly
// as before, with the audit model counting IMAGE 1 itself.
export function buildAuditPrompt(context: AuditContext, groundingBlock = ''): string {
  const item = describeItemType(context.itemType);
  return `You are a strict quality inspector for "RL Jewels" e-commerce catalogue photos.
IMAGE 1 is the original counter photo. IMAGE 2 is the AI-enhanced result that is about to be published.
Item: ${context.purity} gold ${item.line}.${item.notes ? `\nAbout this category: ${item.notes}` : ''}

${context.facts ?? ''}
Compare IMAGE 2 against IMAGE 1 and grade it.
A different camera angle or pose in image 2 is fine and expected - judge the physical design of the piece, never the viewpoint.
Flexible strands - bead strings, chains, hanging drops - are often laid on the counter curled, bunched, twisted, folded or slanted. IMAGE 2 is ALLOWED to show them in the natural way they hang or lie when worn (straight down, evenly spread, not crossing) - that is a correction, not a fault, provided every bead, piece and drop is still there, in the same order, count and colour. Fail only if the DESIGN changed (parts added, dropped, reordered or recoloured), or if IMAGE 1 clearly shows an intentional crossed, slanted or looped design and IMAGE 2 straightened it away.
Matching pairs - the two stones at the ends of a haar, a left and right earring, two vati - are almost always identical in colour and cut. Fail if IMAGE 2 shows a pair in different colours or cuts unless IMAGE 1 clearly shows them different.
Each piece of a set is judged on its own: fail if IMAGE 2 puts colour, enamel or stones on a piece (e.g. the earrings) that is plain in IMAGE 1 just because another piece (the necklace) has them. Fail if a piece shown in IMAGE 1 (an earring, the pendant) is missing from IMAGE 2.
A flat hand-made chain is one chain: fail if IMAGE 2 shows it as two separate chains, or merges separate chains into one.
Most pieces in this store close with an S hook. Look at the hook or clasp at the chain ends in IMAGE 1 and make sure IMAGE 2 has the same one, and that every chain runs its full length - these two are the problems reviewers send pieces back for most.

Before you decide any of the pass/fail fields below, you must first COUNT. Do not skip straight to a judgment call - a wrong count silently eyeballed as "close enough" is the most common way a bad photo has shipped in the past. Fill in "originalCounts" and "enhancedCounts" first, using the same categories for both so they can be directly compared: number of stones and their positions, number of beads/balls/tassels/granulation points in any dangling or clustered group, number of chain/mesh strands, and every distinct engraving/motif present - and for each, its shape and colour/material. Only after writing both of those out should you fill in the boolean checks - each one should follow directly from comparing the two counts you just wrote, not from a separate fresh impression of the image.${groundingBlock}

Respond ONLY as JSON matching this schema:
{
  "originalCounts": string,     // Count every stone, bead/ball/tassel/granulation point, chain/mesh strand, and engraving/motif visible in IMAGE 1, with shape and colour/material. Be specific and numeric, e.g. "stones: 14 halo diamonds + 1 centre emerald; beads: 6 round gold balls in a triangular cluster; black beads: 12 in gold cages; chains: 2 strands, flat hand-made links; engraving: floral motif on band." If a VERIFIED DETAIL INVENTORY is given above, copy it here instead of recounting.
  "enhancedCounts": string,     // The exact same count, in the exact same categories and order, for IMAGE 2 - so it lines up one-to-one against originalCounts above.
  "sharpFocus": boolean,        // is the jewelry in image 2 in sharp focus, edge to edge?
  "notCropped": boolean,        // is the full piece visible, nothing cut off by the frame?
  "backgroundCleanWhite": boolean, // is the background a clean, seamless white with no artifacts, and no leftover price tag, ruler or measuring scale?
  "noBlownHighlights": boolean, // are metal highlights not blown out to pure white with no detail?
  "neutralWhiteBalance": boolean, // is the metal color neutral/true (not orange or blue-tinted)?
  "colorConsistentAcrossSurface": boolean, // is the color/white-balance correction UNIFORM across the entire piece? Look closely at motifs, engraved details, and recessed/shadowed areas - fail this if any sub-region of the piece (e.g. around a motif) has a visibly different color cast than the open/flat metal surfaces around it. This patchy, inconsistent correction is a common failure - check it carefully.
  "clearlyIdentifiableCategory": boolean, // is the item unmistakably recognizable as a ${item.line} at a glance, with its defining structural features clearly visible (e.g. a ring/bangle's interior opening, a chain's link structure and clasp)?
  "stoneCountMatches": boolean, // CRITICAL: does the stone count/position in enhancedCounts EXACTLY match originalCounts, with each stone in the same position, cut, colour and setting style? Fail if any stone was added, removed, split into a cluster, or re-cut. A single centre stone must never have become several smaller ones.
  "beadDetailPreserved": boolean, // CRITICAL: does every bead/ball/tassel/granulation group in enhancedCounts EXACTLY match originalCounts - same count, same spacing, same shape and same colour/material? Fail if any were added or dropped, even if a different count would look more even. Also fail if black beads became gold, or flat discs became round balls, or any element changed shape or material.
  "chainPatternMatches": boolean, // CRITICAL: does the chain/strand count in enhancedCounts EXACTLY match originalCounts, with the same link style, shape and profile, consistent spacing, the same clasp, and the same length relative to the pendant or motif it carries? Fail if strands were merged or split, the link style changed (e.g. flat hand-made links became a ball or rope chain), or a chain was visibly lengthened or shortened. Automatically true if the piece has no chain or strand element at all.
  "hookClaspMatches": boolean, // CRITICAL: is the hook or clasp in IMAGE 2 the same as in IMAGE 1 - same kind (most pieces here close with an S hook, a small S-shaped wire hook; bracelets almost always do), same end, similar size, clearly visible? Fail if it was swapped for another kind (lobster claw, spring ring, box clasp), moved, made unrecognisable, hidden, left out, or invented where IMAGE 1 has none. If IMAGE 1 shows no hook or clasp at all (a ring, a bangle, a stud), this is automatically true.
  "chainComplete": boolean, // CRITICAL: is the whole chain, strand or string drawn from one end to the other in IMAGE 2, as long as in IMAGE 1, with both ends (and the hook) inside the frame? Fail if it is cut off at the edge of the picture, fades out, stops half-way, is visibly shorter than in IMAGE 1, or part of it is missing. Automatically true if the piece has no chain or strand.
  "engravingPreserved": boolean, // CRITICAL: does every engraving, motif, pattern, enamel (meena) colour and surface texture in originalCounts still appear, unaltered and unsimplified, in enhancedCounts - including open-work staying open and solid carved areas staying solid - and is there NOTHING in enhancedCounts that is absent from originalCounts? Fail in either direction: removing real detail and inventing new detail are both failures. Ignore hallmark stamps (e.g. 916) completely - one being present, missing or changed is never a failure.
  "naturalDropPhysics": boolean, // If this piece has hanging chains, mesh, tassels, or ball/bead drops (e.g. jhumka, chandbali, bali, layered haars, charm bracelets): do they fall in smooth, symmetric, gravity-consistent curves - NOT tangled, kinked, flattened, pinched, or bent at an implausible angle? Does the drop count in enhancedCounts match originalCounts exactly, and is each drop the same length relative to the piece it hangs from? If the two earrings/sides of a pair are both visible, are their drops symmetric to each other? If the item has no hanging/repeated drop elements at all, this is automatically true.
  "sameProductFamily": boolean, // CRITICAL: is IMAGE 2 the same KIND of product as IMAGE 1? A mangalsutra/pote must still be a mangalsutra with its black beads, a long chain or haar must not turn into earrings, a pendant must not become a ring. Fail on any change of product type, however good the picture looks.
  "pieceCountMatches": boolean, // CRITICAL: are there the same number of separate pieces in IMAGE 2 as in IMAGE 1 (one necklace stays one, a pair of earrings stays a pair, a pendant on a chain is not split or duplicated), and is any main pendant or centrepiece the same design, size relative to the piece, and position? Fail if a pendant was redesigned, resized dramatically or swapped.
  "overallPass": boolean,       // true only if ALL of the above are true
  "reason": string              // if overallPass is false, a short, specific, staff-facing reason naming which check failed and why, citing the actual counts (e.g. "Bead count changed: original had 7 beads along the base, enhanced has 5."). If overallPass is true, a short confirmation.
}`;
}

// ---------------------------------------------------------------------------
// Catalogue copy prompt. Ported verbatim from v1's /api/generate-copy.
//
// The long passage about most pieces being plain is load-bearing: an earlier
// version produced flowery copy that invented motifs on simple bands, because
// the model reached for ornamentation when none was present. Keep it.
// ---------------------------------------------------------------------------

export interface CopyContext {
  itemType?: string;
  purity?: string;
  gender?: string;
  size?: string;
  weight?: string;
  /** What the piece is, from the form: category line + notes (describeItemType). */
  categoryLine?: string;
  categoryNotes?: string | null;
  /** The per-category name rules (catalog/copyRules.ts describeNameRules). */
  nameRules?: string;
  /** Design tags staff picked and the AI saw, and the staff note. */
  tags?: string[];
  staffNote?: string;
}

export function buildCopyPrompt({ itemType, purity, gender, size, weight, categoryLine, categoryNotes, nameRules, tags, staffNote }: CopyContext): string {
  const inches = /(\d+(?:\.\d+)?)\s*inch/i.exec(size ?? '')?.[1];
  const known = [
    `${purity || '22kt'} gold ${categoryLine || itemType || 'jewellery'}`,
    `for ${gender || "women's"}`,
    inches ? `about ${inches} inches long` : size && size !== 'DEFAULT' ? `size ${size}` : '',
    weight ? `net weight ${weight} g` : '',
  ].filter(Boolean).join(', ');
  return `You are writing catalogue copy for "RL Jewels", an Indian fine jewellery retailer, from the ORIGINAL counter photo of the piece attached (the studio-finished picture does not exist yet and is not what the copy is about). The same copy is used on the website, WhatsApp, the printed catalogue, the app, Pinterest and Instagram, so it must read well on its own in any of them.
What the store knows: ${known}.${categoryNotes ? `\nAbout this category: ${categoryNotes}` : ''}${tags && tags.length ? `\nDesign features noted: ${tags.join(', ')}.` : ''}${staffNote ? `\nStaff note: "${staffNote}".` : ''}
The photo is the final truth. Ignore the price tag, hands, stand, ruler and the background - they are not part of the piece.

Look closely and describe what is genuinely true of THIS piece, in this order:
1. An ornamental motif or technique, if one is actually present, by its real trade name - peacock, floral, temple, kundan, polki, meenakari, filigree, cutwork, jali, antique or oxidised finish, geometric, patti, nano, and so on.
2. If there is no motif - true of most pieces here - it still has a real silhouette and finish. Describe THAT (tapered, domed, hammered, beaded-edge, twisted, high-polish, matte, flat links...) instead of calling it "plain".
Most pieces in this catalogue are everyday, non-ornate designs: precision about what you actually see is what carries them, never invented ornament.

Write:
1. "name" (4-9 words, Title Case): the most distinctive TRUE feature + the word customers actually search for + the item. Use the Marathi/Hindi trade word where customers use it - Mangalsutra, Pote, Haar, Jhumka, Kada, Nath, Kansakhali, Vati, Payal - not a long English paraphrase; "Rani Haar" beats "Long Necklace Set". Good: "Peacock Meenakari Rani Haar", "Long Patti Pote Mangalsutra", "Hammered Gold Kada for Men". Do NOT start with a filler style word (Classic, Traditional, Contemporary...) unless it truly separates this piece from the next. Never put the city, the store name or a weight in the name unless the rules below say so.
Name rules for this category:
${nameRules || '- Purity, weight and length stay out of the name.'}
2. "description" (2-4 short sentences): open with the real motif, finish or silhouette. Say it is ${purity || '22kt'} gold and name the piece with its trade word. Mention length${weight ? ' and, once, the approximate weight' : ''} only if known and useful. Close with one line on wearing it (daily wear, festive, gifting) ONLY if the piece's real scale and style support it - never claim "bridal" or an occasion that does not fit. Never invent stones, engraving or features that are not visible. Write like a jeweller proud of this piece, not like an advert or an inventory list.
3. "metaTitle" - search page title, 50-60 characters MAX, name-based, with the purity (e.g. "... | 22kt Gold").
4. "metaDescription" - search snippet, 150-160 characters MAX, complete sentences: what it is and its real standout feature.
5. "imageAltText" - 8-12 words, plainly what is literally visible, for screen readers and image search.
6. "searchKeywords" - 6-10 comma-separated phrases real customers search: the item in English AND its Marathi/Hindi trade name in Roman letters (and the main one once in Devanagari, e.g. मंगळसूत्र), purity, gender, the real motif or finish. Only what is true of the piece.
7. "urlSlug" - short lowercase hyphen-separated slug from the name (no city, no weight unless in the name).

Respond ONLY as JSON: {"name": string, "description": string, "metaTitle": string, "metaDescription": string, "imageAltText": string, "searchKeywords": string, "urlSlug": string}`;
}

// ---------------------------------------------------------------------------
// Output framing, branched by category (spec §5 Stage 1).
//
// Kept out of the editable master prompt on purpose: the ratio is a mechanical
// consequence of what kind of object this is, not a stylistic choice an admin
// should be able to break by editing prose. Forcing an elongated piece into a
// square is named in the spec as a real shipped bug.
// ---------------------------------------------------------------------------

// Appended to the enhance prompt (not folded into the admin-editable master
// prompt, which lives in the settings table). It relaxes the "do not rearrange"
// rule for exactly one thing - how flexible strands lie - and nothing about the
// design itself.
export function buildNaturalArrangementBlock(): string {
  return `

NATURAL ARRANGEMENT (an exception to "do not rearrange", for placement only):
Flexible parts - bead strings, chains, hanging drops, fringes - are often laid on the counter curled, bunched, twisted, folded, slanted or crossed. Show them as they hang or lie when the piece is worn: strands straight and smooth, drops hanging straight down and evenly spaced, nothing crossed or tangled - UNLESS the original clearly shows that crossing, slant or loop as part of the design, in which case keep it.
This changes only HOW the parts lie. Every bead, piece, stone and drop must still be there, in the same order, count, size and colour. If you cannot straighten a part without inventing or losing detail, leave it as photographed.
Matching pairs - the two end stones of a haar, both earrings, both vati - are almost always the same colour and cut: render a pair identically unless the original clearly shows them different.
Never move colour from one part of the piece to another. Enamel, coloured stones or paint appear only on the parts of the original that carry them - if a necklace has coloured enamel and the earrings beside it are plain gold, the earrings stay plain gold.
A flat, hand-made chain (a flat woven band) is ONE chain: do not split it into two separate parallel chains, and do not merge separate chains into one. Keep the same number of chains, the same width and the same flat link pattern as the original.`;
}

export function buildOutputFramingBlock(aspectRatio: '1:1' | '3:4', itemType: string): string {
  if (aspectRatio === '3:4') {
    return `

OUTPUT FRAMING:
This is an elongated piece (${itemType || 'chain/necklace type'}). Produce a PORTRAIT 3:4 composition (taller than wide).
Show the piece at its full natural length and drape, top to bottom, with clean margin at every edge. Do NOT coil, shorten, fold, or rearrange it to make it fit a squarer frame, and do NOT crop any part of it. The full length is the product.
The whole piece must sit INSIDE the frame with white margin on all four sides: both ends, the hook and any pendant visible. If it is too long to hang straight inside the frame at a good size, let it drape in a smooth U or V curve, the way it hangs when worn - and never let a chain run off the top, the bottom or either side.`;
  }
  return `

OUTPUT FRAMING:
This is a compact piece (${itemType || 'ring/pendant type'}). Produce a SQUARE 1:1 composition.`;
}
