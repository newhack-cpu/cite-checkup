// Hidden-text observer appended to the audited PDF.js 6.4.299 worker module, after the decoder
// guard has verified the module hash. While getTextContent runs it watches the fill colour and
// text rendering mode of the current graphics state, and records text shown where a reader cannot
// see it: white / near-white fill, rendering modes 3 (invisible) and 7 (clip only), or an origin
// outside the page (PDF.js drops such glyphs from the text layer, so only this observer sees them).
// It also sums the page area covered by painted images, so pdf.ts can tell an OCR layer over a scan
// from a page of hidden text.
// It only observes: it never changes what PDF.js extracts, never decodes extra streams, and swallows
// its own errors. Font-size checks use the text items in pdf.ts.
export const PDF_HIDDEN_TEXT_OBSERVER = String.raw`

// Cite Checkup hidden-text observer (observation only).
{
  const RUN_CHARS = 4000;
  const MAX_RUNS = 200;
  let scan = null;
  const unit = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null);
  const gray = (g) => (g === null ? null : [g, g, g]);
  const cmyk = (c, m, y, k) => ([c, m, y, k].some((v) => v === null) ? null : [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]);
  // sc / scn carry components of the current colour space, which the text path does not resolve:
  // infer it from the component count (ICC-based spaces have 1, 3 or 4); patterns stay unknown.
  const byCount = (args) => {
    if (!Array.isArray(args) || args.some((v) => typeof v !== 'number')) return null;
    const v = args.map(unit);
    if (v.length === 1) return gray(v[0]);
    if (v.length === 3) return v.some((x) => x === null) ? null : v;
    if (v.length === 4) return cmyk(v[0], v[1], v[2], v[3]);
    return null;
  };
  // TJ arrays: a large negative adjustment (in thousandths of an em) between strings is a word gap.
  const gapsOf = (items) => {
    if (!Array.isArray(items)) return null;
    const gaps = [];
    let pending = false;
    for (const item of items) {
      if (typeof item === 'number') { if (item < -200) pending = true; }
      else { gaps.push(pending); pending = false; }
    }
    return gaps;
  };
  globalThis.__citeHiddenText = {
    begin(view) { scan = { view, runs: [], total: 0, invisible: 0, imageArea: 0, state: null, gaps: null, gapIndex: 0, lineBreak: false, open: false }; },
    end() {
      const result = scan && { runs: scan.runs.map(({ techniques, text }) => ({ techniques, text })), total: scan.total, invisible: scan.invisible, imageArea: scan.imageArea };
      scan = null;
      return result;
    },
  };
  const originalPreprocess = EvaluatorPreprocessor.prototype.preprocessCommand;
  EvaluatorPreprocessor.prototype.preprocessCommand = function (fn, args) {
    originalPreprocess.call(this, fn, args);
    if (!scan) return;
    try {
      const state = this.stateManager && this.stateManager.state;
      if (!state) return;
      scan.state = state;
      switch (fn | 0) {
        case OPS.setTextRenderingMode: state.__citeRender = Number(args && args[0]) | 0; break;
        case OPS.setFillGray: state.__citeFill = gray(unit(args && args[0])); break;
        case OPS.setFillRGBColor: state.__citeFill = byCount(args && args.slice(0, 3)); break;
        case OPS.setFillCMYKColor: state.__citeFill = byCount(args && args.slice(0, 4)); break;
        case OPS.setFillColor: case OPS.setFillColorN: state.__citeFill = byCount(args); break;
        // Selecting a colour space resets the fill to its initial colour, which is black for all but patterns.
        case OPS.setFillColorSpace: state.__citeFill = [0, 0, 0]; break;
        case OPS.showSpacedText: scan.gaps = gapsOf(args && args[0]); scan.gapIndex = 0; break;
        case OPS.showText: scan.gaps = null; break;
        case OPS.nextLineShowText: case OPS.nextLineSetSpacingShowText: scan.gaps = null; scan.lineBreak = true; break;
        case OPS.beginText: case OPS.moveText: case OPS.setLeadingMoveText: case OPS.nextLine: case OPS.setTextMatrix: scan.lineBreak = true; break;
        // XObject (image or form) and inline image: an image fills the unit square under the CTM, so |det| is its
        // area on the page. Forms are placed with roughly unit scale and add almost nothing. The text pass never
        // decodes images; only the area is recorded, to tell a scanned page from a page of hidden text.
        case OPS.paintXObject: case OPS.endInlineImage: {
          const c = state.ctm;
          if (c) { const area = Math.abs(c[0] * c[3] - c[1] * c[2]); if (Number.isFinite(area)) scan.imageArea += area; }
          break;
        }
      }
    } catch { /* Observation must never affect extraction. */ }
  };
  const originalCharsToGlyphs = Font.prototype.charsToGlyphs;
  Font.prototype.charsToGlyphs = function (chars) {
    const glyphs = originalCharsToGlyphs.call(this, chars);
    if (!scan) return glyphs;
    try {
      const state = scan.state;
      const mode = state ? Number(state.__citeRender) | 0 : 0;
      const fill = state ? state.__citeFill : null;
      const invisible = mode === 3 || mode === 7;
      const white = Array.isArray(fill) && fill.every((v) => typeof v === 'number' && v >= 0.92);
      // Origin of this show operation in page space: CTM x text matrix translation.
      let offpage = false;
      const m = state && state.textMatrix;
      const c = state && state.ctm;
      const view = scan.view;
      if (m && c && Array.isArray(view)) {
        const x = c[0] * m[4] + c[2] * m[5] + c[4];
        const y = c[1] * m[4] + c[3] * m[5] + c[5];
        offpage = x > view[2] + 1 || y > view[3] + 1 || x < view[0] - 1 || y < view[1] - 1;
      }
      let text = '';
      for (const glyph of glyphs) if (glyph && typeof glyph.unicode === 'string') text += glyph.unicode;
      const visible = text.replace(/\s+/g, '').length;
      scan.total += visible;
      if (invisible) scan.invisible += visible;
      const gap = scan.gaps ? Boolean(scan.gaps[scan.gapIndex++]) : false;
      const techniques = [];
      if (white) techniques.push('white');
      if (invisible) techniques.push('invisible');
      if (offpage) techniques.push('offpage');
      if (!techniques.length) { if (visible) scan.open = false; scan.lineBreak = false; return glyphs; }
      const key = techniques.join(',');
      const last = scan.runs[scan.runs.length - 1];
      // One run per text line: shorter runs survive PDF.js dropping or reordering parts of a page.
      if (scan.open && last && last.key === key && !scan.lineBreak) {
        if (gap && !/\s$/.test(last.text)) last.text += ' ';
        if (last.text.length < RUN_CHARS) last.text += text;
      } else if (scan.runs.length < MAX_RUNS) {
        scan.runs.push({ key, techniques, text });
      }
      scan.open = true;
      scan.lineBreak = false;
    } catch { /* Observation must never affect extraction. */ }
    return glyphs;
  };
}
`;
