// Fixtures for lib/levelRequestRules.ts.   node scripts/test-level-requests.mjs
import { normalizeLevelSymbol, parseStrikeSize, cleanText, DEFAULT_STRIKE_SIZE } from '../lib/levelRequestRules.ts';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};

eq('upper-cases', normalizeLevelSymbol(' aapl '), 'AAPL');
eq('class suffix dot', normalizeLevelSymbol('BRK.B'), 'BRK.B');
eq('slash form', normalizeLevelSymbol('brk/b'), 'BRK.B');
eq('dash suffix', normalizeLevelSymbol('BF-B'), 'BF-B');
eq('digits rejected', normalizeLevelSymbol('A1'), null);
eq('too long', normalizeLevelSymbol('ABCDEFG'), null);
eq('empty', normalizeLevelSymbol(''), null);
eq('injection chars', normalizeLevelSymbol("A'; DROP"), null);
eq('non-string', normalizeLevelSymbol(5), null);
eq('space inside', normalizeLevelSymbol('AB CD'), null);

eq('default strike', parseStrikeSize(undefined), DEFAULT_STRIKE_SIZE);
eq('default strike is 5', DEFAULT_STRIKE_SIZE, 5);
eq('empty string = default', parseStrikeSize(''), 5);
eq('2.5', parseStrikeSize('2.5'), 2.5);
eq('number 1', parseStrikeSize(1), 1);
eq('zero rejected', parseStrikeSize(0), null);
eq('negative rejected', parseStrikeSize(-1), null);
eq('NaN rejected', parseStrikeSize('abc'), null);
eq('too large', parseStrikeSize(1001), null);
eq('rounds to 3 dp', parseStrikeSize(0.12345), 0.123);

eq('text trims and collapses', cleanText('  hi   there ', 50), 'hi there');
eq('text capped', cleanText('abcdef', 3), 'abc');
eq('blank text = null', cleanText('   ', 10), null);
eq('non-string text', cleanText(null, 10), null);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
