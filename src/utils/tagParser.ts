import { GoldPurity, ProductGender, ITEM_TYPE_SUGGESTIONS } from '../types';
import { ScannedProductData } from '../components/BarcodeScannerModal';

// Real ERP category vocabulary, longest/most-specific term first, so "Kada Sardar"
// wins over the more generic "Kada" when both appear as word-boundary matches.
// Store-printed tags use this exact vocabulary, so checking it first is far more
// reliable than guessing from generic English jewelry words.
const TAXONOMY_TERMS = [...ITEM_TYPE_SUGGESTIONS].sort((a, b) => b.length - a.length);

function matchTaxonomyTerm(upperText: string): string | null {
  for (const term of TAXONOMY_TERMS) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escaped.toUpperCase()}\\b`);
    if (pattern.test(upperText)) {
      return term;
    }
  }
  return null;
}

/**
 * Normalizes numbers extracted via OCR by repairing common OCR digit character confusions
 * e.g. '3.46O' -> '3.460', 'O.OOO' -> '0.000', 'l8.450' -> '18.450', '3,460' -> '3.460'
 */
function cleanOcrNumber(raw: string): string {
  if (!raw) return '';
  let cleaned = raw
    .trim()
    .replace(/,/g, '.')
    .replace(/[OoDQ]/g, '0')
    .replace(/[lI|!]/g, '1')
    .replace(/[S]/g, '5')
    .replace(/[B]/g, '8')
    .replace(/[^0-9.]/g, '');

  // Handle multiple dots (e.g. 3.4.60 -> 3.460)
  const parts = cleaned.split('.');
  if (parts.length > 2) {
    cleaned = parts[0] + '.' + parts.slice(1).join('');
  }

  const num = parseFloat(cleaned);
  if (isNaN(num)) return '';
  return num.toFixed(3);
}

/**
 * Intelligent Jewelry Tag Text & Barcode Parser
 * Specifically calibrated for Indian Retail Jewelry Store Tag formats (RL Jewels, Tanishq, Malabar, Kalyan).
 * Correctly extracts CPC / Barcode, Item Type, Title, Purity, Size, Gender, GW, OW, NW.
 */
export function parseJewelryTagText(
  rawText: string,
  existing?: Partial<ScannedProductData>,
  additionalText?: string
): ScannedProductData {
  // Combine primary rawText and any additional text from dual OCR engines
  const combined = `${rawText || ''}\n${additionalText || ''}`;
  const clean = combined.replace(/\r\n/g, '\n').replace(/\t/g, ' ');
  const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
  const upper = clean.toUpperCase();

  // -------------------------------------------------------------
  // 1. Detect Gold Purity (18kt, 22kt, 24kt)
  // -------------------------------------------------------------
  let purity: GoldPurity = existing?.purity || '22kt';

  // Check 18kt patterns
  const is18kt =
    /\b18\s*(?:KT|K|CT|Karat|Carat|K750|\/750|-750)\b/i.test(upper) ||
    /\b750\s*(?:HALLMARK|BIS|GOLD)?\b/i.test(upper) ||
    upper.includes('18CT') ||
    upper.includes('18KT') ||
    upper.includes('18K750') ||
    upper.includes('18/750') ||
    upper.includes('18-750') ||
    upper.includes('750');

  // Check 24kt patterns
  const is24kt =
    /\b24\s*(?:KT|K|CT|Karat|Carat|K999|\/999|-999)\b/i.test(upper) ||
    /\b999\s*(?:FINE|PURE|GOLD)?\b/i.test(upper) ||
    upper.includes('24CT') ||
    upper.includes('24KT') ||
    upper.includes('24K999') ||
    upper.includes('24/999') ||
    upper.includes('99.9') ||
    upper.includes('FINE GOLD');

  // Check 22kt patterns (dominant retail purity)
  const is22kt =
    /\b22\s*(?:KT|K|CT|Karat|Carat|K916|\/916|-916)\b/i.test(upper) ||
    /\b916\s*(?:HALLMARK|BIS|GOLD|HM)?\b/i.test(upper) ||
    upper.includes('22CT') ||
    upper.includes('22KT') ||
    upper.includes('22K916') ||
    upper.includes('22/916') ||
    upper.includes('22-916') ||
    upper.includes('91.6') ||
    upper.includes('916');

  if (is18kt && !is22kt && !is24kt) {
    purity = '18kt';
  } else if (is24kt && !is22kt) {
    purity = '24kt';
  } else if (is22kt) {
    purity = '22kt';
  }

  // -------------------------------------------------------------
  // 2. Detect Item Category / Type & Formatted Name
  // -------------------------------------------------------------
  interface ItemCategoryRule {
    type: string;
    defaultGender: ProductGender;
    titleTemplate: string;
    keywords: string[];
    regexPatterns: RegExp[];
  }

  const CATEGORY_RULES: ItemCategoryRule[] = [
    {
      type: 'earrings',
      defaultGender: "women's",
      titleTemplate: 'Traditional Earrings',
      keywords: [
        'EARRING', 'EARRINGS', 'EARINGS', 'EARING', 'JHUMKA', 'JHUMKI',
        'CHANDBALI', 'SUI DHAGA', 'SUIDHAGA', 'STUD', 'STUDS', 'TOPS',
        'BALI', 'BALIS', 'HOOP', 'HOOPS', 'HANGINGS', 'LATKAN', 'ERR',
      ],
      regexPatterns: [
        /\b(?:EARRINGS?|EARINGS?|JHUMK[AI]|CHANDBALI|STUDS?|TOPS?|BALIS?|HOOPS?)\b/i,
        /\b(?:ER|E\.R|E-R|ERR)\b/i,
      ],
    },
    {
      type: 'pendant',
      defaultGender: "women's",
      titleTemplate: 'Fancy Padak Pendant',
      keywords: ['FANCY PADAK', 'PADAK', 'PENDANT', 'PENDANTS', 'LOCKET', 'LOKET', 'MEDAL', 'PND'],
      regexPatterns: [
        /\b(?:PENDANTS?|PADAK|FANCY\s+PADAK|LOCKETS?|LOKET|MEDAL)\b/i,
        /\b(?:PD|P\.D|P-D|PND)\b/i,
      ],
    },
    {
      type: 'ring',
      defaultGender: "women's",
      titleTemplate: 'Ring',
      keywords: [
        'LADIES RING', 'GENTS RING', 'GENTS FANCY A', 'RING', 'RINGS',
        'BAND', 'SOLITAIRE', 'ANGETHI', 'VANKI', 'COUPLE RING',
      ],
      regexPatterns: [
        /\b(?:LADIES\s+RING|GENTS\s+RING|GENTS\s+FANCY\s+[A-Z]|RINGS?|BAND|SOLITAIRE|ANGETHI|VANKI)\b/i,
        /\b(?:RN|R\.N|R-N|RNG)\b/i,
      ],
    },
    {
      type: 'necklace',
      defaultGender: "women's",
      titleTemplate: 'Necklace',
      keywords: [
        'KUNDAN HARAM', 'HARAM', 'NECKLACE', 'NECKLACES', 'CHOKER',
        'HAAR', 'HAR', 'RANI HAAR', 'RANIHAR', 'KANTHI', 'GALSARI', 'HASLI', 'GALA SET',
      ],
      regexPatterns: [
        /\b(?:NECKLACES?|CHOKER|KUNDAN\s+HARAM|HARAM|RANI\s*HAAR|HAAR|HAR|KANTHI|HASLI)\b/i,
        /\b(?:NK|N\.K|N-K|NCK)\b/i,
      ],
    },
    {
      type: 'mangalsutra',
      defaultGender: "women's",
      titleTemplate: 'Mangalsutra',
      keywords: ['MANGALSUTRA', 'MANGAL SUTRA', 'TANMANIYA', 'THUSHI', 'VATIS', 'DOKIYA'],
      regexPatterns: [
        /\b(?:MANGALSUTRA|MANGAL\s+SUTRA|TANMANIYA|THUSHI|VATIS|DOKIYA)\b/i,
        /\b(?:MS|M\.S|M-S)\b/i,
      ],
    },
    {
      type: 'chain',
      defaultGender: 'unisex',
      titleTemplate: 'Chain',
      keywords: ['CHAIN', 'CHAINS', 'ROPE CHAIN', 'BOX CHAIN', 'HOLLOW CHAIN', 'NAWABI CHAIN', 'LOTUS CHAIN'],
      regexPatterns: [
        /\b(?:CHAINS?|ROPE\s+CHAIN|BOX\s+CHAIN|NAWABI\s+CHAIN)\b/i,
        /\b(?:CH|C\.H|C-H|CHN)\b/i,
      ],
    },
    {
      type: 'bangle',
      defaultGender: "women's",
      titleTemplate: 'Bangle',
      keywords: ['BANGLE', 'BANGLES', 'CHURI', 'CHUDI', 'KANGAN', 'PATLA', 'PACHELI', 'BABY BANGLE'],
      regexPatterns: [
        /\b(?:BANGLES?|CHURI|CHUDI|KANGAN|PATLA|PACHELI)\b/i,
        /\b(?:BG|B\.G|B-G|BNG)\b/i,
      ],
    },
    {
      type: 'kada',
      defaultGender: "men's",
      titleTemplate: 'Solid Kada',
      keywords: ['SOLID KADA', 'KADA', 'KADAS', 'KADDA', 'GENTS KADA', 'VALA'],
      regexPatterns: [
        /\b(?:SOLID\s+KADA|GENTS\s+KADA|KADAS?|KADDA|VALA)\b/i,
        /\b(?:KD|K\.D|K-D)\b/i,
      ],
    },
    {
      type: 'bracelet',
      defaultGender: "women's",
      titleTemplate: 'Bracelet',
      keywords: ['LADIES BRACELET', 'GENTS BRACELET', 'BRACELET', 'BRACELETS', 'BRACLET'],
      regexPatterns: [
        /\b(?:BRACELETS?|BRACLET|LADIES\s+BRACELET|GENTS\s+BRACELET)\b/i,
        /\b(?:BR|B\.R|B-R|BRC)\b/i,
      ],
    },
    {
      type: 'anklet',
      defaultGender: "women's",
      titleTemplate: 'Anklet (Payal)',
      keywords: ['PAYAL', 'PAJEB', 'ANKLET', 'ANKLETS', 'GOLUSU'],
      regexPatterns: [
        /\b(?:PAYAL|PAJEB|ANKLETS?|GOLUSU)\b/i,
        /\b(?:PY|P\.Y|P-Y)\b/i,
      ],
    },
    {
      type: 'nose pin',
      defaultGender: "women's",
      titleTemplate: 'Nose Pin',
      keywords: ['NOSE PIN', 'NOSEPIN', 'NATH', 'NOSE RING', 'NOSE STUD', 'MUKKUTHI'],
      regexPatterns: [
        /\b(?:NOSE\s*PIN|NOSEPIN|NATH|NOSE\s*RING|NOSE\s*STUD|MUKKUTHI)\b/i,
        /\b(?:NP|N\.P|N-P)\b/i,
      ],
    },
    {
      type: 'waist chain',
      defaultGender: "women's",
      titleTemplate: 'Waist Chain (Kamarbandh)',
      keywords: ['WAIST CHAIN', 'KAMARBANDH', 'KANDORA', 'ODDIYANAM', 'VADDANAM'],
      regexPatterns: [
        /\b(?:WAIST\s+CHAIN|KAMARBANDH|KANDORA|ODDIYANAM|VADDANAM)\b/i,
        /\b(?:WC|W\.C|W-C)\b/i,
      ],
    },
    {
      type: 'temple set',
      defaultGender: "women's",
      titleTemplate: 'Temple Jewellery Set',
      keywords: ['TEMPLE SET', 'TEMPLE', 'TEMPLE JEWELLERY', 'NAKSHI'],
      regexPatterns: [/\b(?:TEMPLE\s+SET|TEMPLE\s+JEWELLERY|NAKSHI)\b/i],
    },
    {
      type: 'bridal set',
      defaultGender: "women's",
      titleTemplate: 'Bridal Wedding Set',
      keywords: ['BRIDAL SET', 'BRIDAL', 'WEDDING SET'],
      regexPatterns: [/\b(?:BRIDAL\s+SET|BRIDAL|WEDDING\s+SET)\b/i],
    },
    {
      type: 'coin/bar',
      defaultGender: 'unisex',
      titleTemplate: 'Gold Coin/Bar',
      keywords: ['COIN', 'BAR', 'GINNI', 'VEDHANI', 'GOLD COIN', 'GOLD BAR', 'BULLION'],
      regexPatterns: [/\b(?:COINS?|BARS?|GINNI|VEDHANI|BULLION)\b/i],
    },
  ];

  let detectedType = existing?.itemType || '';
  let detectedTitleSubstr = '';
  let matchedRule: ItemCategoryRule | null = null;

  // Check the real RL Jewels ERP category vocabulary first - store-printed tags use
  // this exact wording, so a whole-word match here is more trustworthy than a guess
  // from generic English jewelry terms.
  const taxonomyMatch = matchTaxonomyTerm(upper);
  if (taxonomyMatch) {
    detectedType = taxonomyMatch.toLowerCase();
    detectedTitleSubstr = taxonomyMatch;
  }

  // First check specific compound multi-word keywords (e.g. "FANCY PADAK", "GENTS FANCY A", "KUNDAN HARAM")
  // - only when the real taxonomy above didn't already find a match, so a stray
  // generic keyword can't override an authentic ERP category name.
  if (!taxonomyMatch) {
    for (const rule of CATEGORY_RULES) {
      for (const kw of rule.keywords) {
        if (upper.includes(kw)) {
          detectedType = rule.type;
          detectedTitleSubstr = kw;
          matchedRule = rule;
          break;
        }
      }
      if (detectedType) break;
    }
  }

  // Second check regex patterns (handles word boundaries and abbreviations like ER, RN, PD, NK)
  if (!detectedType) {
    for (const rule of CATEGORY_RULES) {
      const match = rule.regexPatterns.some((pattern) => pattern.test(clean));
      if (match) {
        detectedType = rule.type;
        matchedRule = rule;
        break;
      }
    }
  }

  if (!detectedType) {
    detectedType = existing?.itemType || 'earrings';
  }

  // -------------------------------------------------------------
  // 3. Detect Gender (women's, men's, unisex, kids')
  // -------------------------------------------------------------
  let gender: ProductGender = existing?.gender || (matchedRule ? matchedRule.defaultGender : "women's");

  const hasGents =
    /\b(?:GENTS|GENT|MENS|MEN'S|MALE|MAN|BOY)\b/i.test(upper) ||
    upper.includes('GENTS') ||
    upper.includes('MENS') ||
    upper.includes("MEN'S");

  const hasKids =
    /\b(?:KIDS|KID|CHILD|BABY|GIRL|BOYS)\b/i.test(upper) ||
    upper.includes('KID') ||
    upper.includes('BABY');

  const hasLadies =
    /\b(?:LADIES|LADY|WOMEN|WOMENS|WOMEN'S|FEMALE)\b/i.test(upper) ||
    upper.includes('LADIES') ||
    upper.includes("WOMEN'S");

  const hasUnisex =
    /\b(?:UNISEX|COIN|BAR|BULLION)\b/i.test(upper) ||
    upper.includes('UNISEX') ||
    upper.includes('COIN') ||
    upper.includes('BAR');

  if (hasGents) {
    gender = "men's";
  } else if (hasKids) {
    gender = "kids'";
  } else if (hasLadies) {
    gender = "women's";
  } else if (hasUnisex) {
    gender = 'unisex';
  } else if (detectedType === 'mangalsutra' || detectedType === 'nose pin' || detectedType === 'anklet' || detectedType === 'waist chain') {
    gender = "women's";
  } else if (detectedType === 'kada' || detectedType === 'chain') {
    gender = 'unisex';
  }

  // -------------------------------------------------------------
  // 4. Extract Size if present (e.g. 17N0, 2.4, 18", DEFAULT, 14, 16)
  // -------------------------------------------------------------
  let size = existing?.size || 'DEFAULT';
  const sizeMatch =
    clean.match(/(?:SIZE|SZ|S\.Z)[\s:=_-]*([0-9A-Z."/-]{1,10})/i) ||
    clean.match(/\b([0-9]{1,2}N[0-9]{0,2})\b/i) || // e.g. 17N0, 18N, 16N0
    clean.match(/\b(2\.[2468]|2-[2468]|2\/[2468])\b/i) || // bangle size 2.4, 2.6, 2.8
    clean.match(/\b([12][0-9]")\b/i) || // chain/necklace inch size 18", 22"
    clean.match(/(?:DEFAULT)\b/i);

  if (sizeMatch && sizeMatch[1]) {
    const candidateSize = sizeMatch[1].trim().toUpperCase().replace(/[-/]/g, '.');
    if (candidateSize && candidateSize !== 'SIZE' && candidateSize !== 'SZ') {
      size = candidateSize;
    }
  }

  // -------------------------------------------------------------
  // 5. Robust Multi-Pass Weights Extraction (GW, OW, NW)
  // -------------------------------------------------------------
  let grossWeight = existing?.grossWeight || '0.000';
  let otherWeight = existing?.otherWeight || '0.000';
  let netWeight = existing?.netWeight || '0.000';
  // Tracks HOW the weights were actually derived - 'labeled' (an explicit
  // GW/OW/NW tag was matched) is far more trustworthy than 'fallback' (guessed
  // from an unlabeled array of decimals). Logged alongside every scan so
  // /api/analytics/summary can show whether OCR is finding real labels or
  // increasingly having to guess - an early-warning signal for tag print
  // quality issues, well before it shows up as a staff correction.
  let weightParseMethod: 'labeled' | 'table' | 'fallback' | 'none' = existing?.weightParseMethod || 'none';

  // Pass A: Explicit Label Matching with OCR repairs
  // GW: Gross Weight
  const gwRegex = /(?:GW|G\.W|G_W|GROSS|GWT|G\.WT|G\s*WT|CW|GVV|GRS)[\s:=_.-]*([0-9OoDQldISB]+[.,][0-9OoDQldISB]{1,4})/i;
  const gwMatch = clean.match(gwRegex);
  if (gwMatch && gwMatch[1]) {
    const cleanedVal = cleanOcrNumber(gwMatch[1]);
    if (cleanedVal) {
      grossWeight = cleanedVal;
      weightParseMethod = 'labeled';
    }
  }

  // OW: Other Weight (Stones, dori, enamel)
  const owRegex = /(?:OW|O\.W|O_W|OTHER|ST\.?WT|STONE|LESS|SW|O\s*WT|O_WT|ST_WT|DW|QW|0W)[\s:=_.-]*([0-9OoDQldISB]+[.,][0-9OoDQldISB]{1,4})/i;
  const owMatch = clean.match(owRegex);
  if (owMatch && owMatch[1]) {
    const cleanedVal = cleanOcrNumber(owMatch[1]);
    if (cleanedVal) otherWeight = cleanedVal;
  }

  // NW: Net Weight
  const nwRegex = /(?:NW|N\.W|N_W|NET|NWT|N\.WT|N\s*WT|N_WT|MW|NVV)[\s:=_.-]*([0-9OoDQldISB]+[.,][0-9OoDQldISB]{1,4})/i;
  const nwMatch = clean.match(nwRegex);
  if (nwMatch && nwMatch[1]) {
    const cleanedVal = cleanOcrNumber(nwMatch[1]);
    if (cleanedVal) netWeight = cleanedVal;
  }

  // Pass B: Three-Column / Tabular weights sequence detection
  // e.g. "3.460 0.000 3.460" or "8.210  0.350  7.860" or "6.450 / 0.210 / 6.240"
  const tableWeightsRegex = /([0-9]+[.,][0-9]{2,3})\s*[/|\s-]\s*([0-9]+[.,][0-9]{2,3})\s*[/|\s-]\s*([0-9]+[.,][0-9]{2,3})/;
  const tableMatch = clean.match(tableWeightsRegex);
  if (tableMatch) {
    const c1 = cleanOcrNumber(tableMatch[1]);
    const c2 = cleanOcrNumber(tableMatch[2]);
    const c3 = cleanOcrNumber(tableMatch[3]);
    const n1 = parseFloat(c1) || 0;
    const n2 = parseFloat(c2) || 0;
    const n3 = parseFloat(c3) || 0;

    // Check if n1 - n2 ≈ n3 (Gross - Other = Net)
    if (n1 > 0 && Math.abs(n1 - n2 - n3) < 0.01) {
      grossWeight = c1;
      otherWeight = c2;
      netWeight = c3;
      weightParseMethod = 'table';
    }
  }

  // Pass C: Decimal Array Fallback Parser if explicit weights still zero
  if (parseFloat(grossWeight) === 0) {
    // Find all 2-to-3 decimal numbers
    const allDecimals = clean.match(/\b([0-9]{1,4}[.,][0-9]{2,3})\b/g) || [];
    const validNums = allDecimals
      .map((d) => parseFloat(cleanOcrNumber(d)))
      .filter((n) => !isNaN(n) && n > 0 && n < 5000); // realistic jewelry gram weights

    if (validNums.length >= 1) {
      weightParseMethod = 'fallback';
    }

    if (validNums.length >= 2) {
      // Find pair where A - B = C or max is GW and second is NW
      const maxVal = Math.max(...validNums);
      const minVal = Math.min(...validNums);
      grossWeight = maxVal.toFixed(3);

      if (validNums.length === 2) {
        if (minVal < maxVal) {
          // If minVal is very small (< 1.0) and maxVal > 1.0, minVal could be OW
          if (minVal <= 1.0 && maxVal > 2.0) {
            otherWeight = minVal.toFixed(3);
            netWeight = Math.max(0, maxVal - minVal).toFixed(3);
          } else {
            // minVal is Net weight
            netWeight = minVal.toFixed(3);
            otherWeight = Math.max(0, maxVal - minVal).toFixed(3);
          }
        } else {
          netWeight = grossWeight;
          otherWeight = '0.000';
        }
      } else if (validNums.length >= 3) {
        // Look for exact triad: gw - ow = nw
        let triadFound = false;
        for (let i = 0; i < validNums.length; i++) {
          for (let j = 0; j < validNums.length; j++) {
            if (i === j) continue;
            for (let k = 0; k < validNums.length; k++) {
              if (k === i || k === j) continue;
              const g = validNums[i];
              const o = validNums[j];
              const n = validNums[k];
              if (g >= n && Math.abs(g - o - n) < 0.005) {
                grossWeight = g.toFixed(3);
                otherWeight = o.toFixed(3);
                netWeight = n.toFixed(3);
                triadFound = true;
                break;
              }
            }
            if (triadFound) break;
          }
          if (triadFound) break;
        }

        if (!triadFound) {
          grossWeight = maxVal.toFixed(3);
          netWeight = maxVal.toFixed(3);
          otherWeight = '0.000';
        }
      }
    } else if (validNums.length === 1) {
      grossWeight = validNums[0].toFixed(3);
      otherWeight = '0.000';
      netWeight = grossWeight;
    }
  }

  // Other Weight (stones/dori/enamel) is physically always less than Gross
  // Weight - it's a component of it. A common OCR/label-matching failure is
  // the two getting swapped (e.g. the GW/OW regex pair matching the wrong
  // number for each label), which this would otherwise silently ship. Swap
  // them back if that's clearly what happened.
  if (parseFloat(otherWeight) > 0 && parseFloat(grossWeight) > 0 && parseFloat(otherWeight) > parseFloat(grossWeight)) {
    [grossWeight, otherWeight] = [otherWeight, grossWeight];
  }

  // Ensure mathematical integrity: Net = Gross - Other
  const parsedGw = parseFloat(grossWeight) || 0;
  const parsedOw = parseFloat(otherWeight) || 0;
  const parsedNw = parseFloat(netWeight) || 0;

  if (parsedGw > 0) {
    if (parsedNw === 0 || Math.abs(parsedNw - (parsedGw - parsedOw)) > 0.005) {
      netWeight = Math.max(0, parsedGw - parsedOw).toFixed(3);
    }
  }

  // -------------------------------------------------------------
  // 6. Extract Tag / CPC Code (e.g. 20L1579, 1517L724, 3132L237)
  // -------------------------------------------------------------
  let cpc = existing?.cpc || '';
  const cpcMatch =
    clean.match(/\b([0-9]{1,5}[A-Z]{1,3}[0-9]{1,6})\b/i) || // e.g. 20L1579, 1517L724, 3132L237
    clean.match(/\b(RLJ[-_]?[0-9A-Z]{3,10})\b/i) ||
    clean.match(/\b([A-Z]{2,5}[-_]?[0-9]{3,8})\b/i);

  if (cpcMatch) {
    cpc = cpcMatch[1].toUpperCase();
  } else if (!cpc) {
    for (const line of lines) {
      const codeCandidate = line.replace(/[^A-Z0-9-]/gi, '').trim();
      if (
        codeCandidate.length >= 4 &&
        codeCandidate.length <= 15 &&
        /[0-9]/.test(codeCandidate) &&
        /[A-Z]/i.test(codeCandidate) &&
        !codeCandidate.includes('22KT') &&
        !codeCandidate.includes('18KT') &&
        !codeCandidate.includes('24KT') &&
        !codeCandidate.includes('916')
      ) {
        cpc = codeCandidate.toUpperCase();
        break;
      }
    }
  }

  if (!cpc) {
    cpc = existing?.cpc || 'RLJ-' + Math.floor(1000 + Math.random() * 9000);
  }

  // -------------------------------------------------------------
  // 7. Formulate Accurate Display Name
  // -------------------------------------------------------------
  let formattedName = '';
  const genderPrefix = gender === "men's" ? 'Gents ' : '';
  const sizeSuffix = size && size !== 'DEFAULT' ? ` (Sz: ${size})` : '';

  if (detectedTitleSubstr) {
    // Format detected title nicely
    const cleanSubstr = detectedTitleSubstr
      .toLowerCase()
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    formattedName = `${purity.toUpperCase()} Gold ${cleanSubstr}${sizeSuffix}`;
  } else if (matchedRule) {
    formattedName = `${purity.toUpperCase()} Gold ${genderPrefix}${matchedRule.titleTemplate}${sizeSuffix}`;
  } else {
    const formattedType = detectedType.charAt(0).toUpperCase() + detectedType.slice(1);
    formattedName = `${purity.toUpperCase()} Gold ${genderPrefix}${formattedType}${sizeSuffix}`;
  }

  return {
    cpc,
    name: formattedName,
    itemType: detectedType,
    purity,
    gender,
    grossWeight: grossWeight || '0.000',
    otherWeight: otherWeight || '0.000',
    netWeight: netWeight || grossWeight || '0.000',
    size,
    weightParseMethod,
  };
}

/**
 * Merge Side 1 (Barcode, CPC, Item Type, Purity, Size) + Side 2 (GW, OW, NW weights)
 */
export function mergeScannedTagData(
  side1: Partial<ScannedProductData> | null,
  side2: Partial<ScannedProductData> | null
): ScannedProductData {
  const base: ScannedProductData = {
    cpc: side1?.cpc || side2?.cpc || 'RLJ-20L1579',
    name: side1?.name || side2?.name || '22kt Gold Jewelry',
    itemType: side1?.itemType || side2?.itemType || 'earrings',
    purity: side1?.purity || side2?.purity || '22kt',
    gender: side1?.gender || side2?.gender || "women's",
    grossWeight: '0.000',
    otherWeight: '0.000',
    netWeight: '0.000',
    size: side1?.size && side1.size !== 'DEFAULT' ? side1.size : side2?.size || 'DEFAULT',
    weightParseMethod: 'none',
  };

  // Determine best weights (prefer values > 0)
  const gw1 = parseFloat(side1?.grossWeight || '0');
  const gw2 = parseFloat(side2?.grossWeight || '0');
  const bestGw = gw2 > 0 ? side2!.grossWeight! : gw1 > 0 ? side1!.grossWeight! : '0.000';
  base.weightParseMethod = gw2 > 0 ? side2?.weightParseMethod || 'none' : gw1 > 0 ? side1?.weightParseMethod || 'none' : 'none';

  const ow1 = parseFloat(side1?.otherWeight || '0');
  const ow2 = parseFloat(side2?.otherWeight || '0');
  const bestOw = ow2 > 0 ? side2!.otherWeight! : ow1 > 0 ? side1!.otherWeight! : '0.000';

  const nw1 = parseFloat(side1?.netWeight || '0');
  const nw2 = parseFloat(side2?.netWeight || '0');
  let bestNw = nw2 > 0 ? side2!.netWeight! : nw1 > 0 ? side1!.netWeight! : bestGw;

  if (parseFloat(bestGw) > 0) {
    bestNw = Math.max(0, parseFloat(bestGw) - parseFloat(bestOw)).toFixed(3);
  }

  base.grossWeight = bestGw;
  base.otherWeight = bestOw;
  base.netWeight = bestNw;

  // Re-generate formatted display name using best purity, type, gender, size
  const genderPrefix = base.gender === "men's" ? 'Gents ' : '';
  const formattedType = base.itemType.charAt(0).toUpperCase() + base.itemType.slice(1);
  const sizeSuffix = base.size && base.size !== 'DEFAULT' ? ` (Sz: ${base.size})` : '';
  base.name = `${base.purity.toUpperCase()} Gold ${genderPrefix}${formattedType}${sizeSuffix}`;

  return base;
}