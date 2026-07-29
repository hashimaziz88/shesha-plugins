// Deterministic counter, not random: the extraction must be reproducible.
let n = 0;
const nanoid = () => `stub-id-${++n}`;
module.exports = { nanoid, customAlphabet: () => nanoid, urlAlphabet: '' };
