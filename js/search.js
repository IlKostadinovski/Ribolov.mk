// Text matching for the search bar (used by js/app.js).
//
// Names and what people type are both turned into plain Latin letters before they
// are compared, so these all find the same thing:
//   Делчево, Delčevo, Delcevo, Delchevo      Крап, Krap, krap      Штип, Štip, Stip, Shtip
// Small typos are forgiven too (Doiran → Dojran, Strumitsa → Strumica).

// Cyrillic letters in plain Latin (Macedonian first, plus a few Serbian/Russian ones).
const SEARCH_LETTERS = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ѓ: 'g', е: 'e', ж: 'z', з: 'z', ѕ: 'dz',
  и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', ќ: 'k', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'c', џ: 'dz',
  ш: 's', ђ: 'dj', ћ: 'c', й: 'j', ы: 'i', э: 'e', ю: 'ju', я: 'ja', щ: 's', ё: 'e',
  ъ: '', ь: '',
};

// Turns a name (or what was typed) into simple lowercase Latin words.
function searchFold(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[Ѐ-ӿ]/g, (ch) => SEARCH_LETTERS[ch] ?? ch)
    .replace(/đ/g, 'dj')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // č → c, š → s, ž → z, ǵ → g, ḱ → k
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    // Different ways of writing the same sound in Latin letters
    .replace(/sh/g, 's').replace(/ch/g, 'c').replace(/zh/g, 'z')
    .replace(/gj|dj/g, 'g').replace(/kj/g, 'k').replace(/kh/g, 'h')
    .replace(/t[sz]/g, 'c').replace(/y/g, 'j').replace(/w/g, 'v');
}

// How well a name matches what was typed (both already folded with searchFold):
//   4 = exactly the same       3 = the name starts with it
//   2 = its words start with the typed words (in any order)
//   1 = found inside the name  0.5 = close, with a typo or two   0 = no match
function searchScore(name, query) {
  if (!name || !query) return 0;
  if (name === query) return 4;
  if (name.startsWith(query)) return 3;
  const words = name.split(' ');
  const typed = query.split(' ');
  if (typed.every((q) => words.some((w) => w.startsWith(q)))) return 2;
  if (name.includes(query)) return 1;
  const close = (q) => {
    const allowed = q.length >= 7 ? 2 : q.length >= 4 ? 1 : 0;
    return words.some((w) => (allowed ? searchDistance(q, w.slice(0, q.length)) <= allowed : w.startsWith(q)));
  };
  if (typed.some((q) => q.length >= 4) && typed.every(close)) return 0.5;
  return 0;
}

// Number of single-letter changes between two words (a swap of two neighbouring
// letters counts as one).
function searchDistance(a, b) {
  const rows = [];
  for (let i = 0; i <= a.length; i++) rows.push([i]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }
  return rows[a.length][b.length];
}
