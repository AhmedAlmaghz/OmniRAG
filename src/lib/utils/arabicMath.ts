/**
 * Arabic Math Notation (MathJax4Arabic) Helper Engine
 * Converts Western LaTeX / Mathematical expressions into traditional Arabic Mathematical Notation
 * (المعادلات والرموز الرياضية العربية الأصيلة)
 */

export interface ArabicMathConversionOptions {
  useArabicNumerals?: boolean; // ٠-٩ vs 0-9
  showExplanation?: boolean;
}

// Arabic Variable Mappings
const VARIABLE_MAP: Record<string, string> = {
  x: 'س',
  y: 'ص',
  z: 'ع',
  n: 'ن',
  k: 'ك',
  m: 'م',
  a: 'أ',
  b: 'ب',
  c: 'ج',
  f: 'د', // f(x) -> د(س)
  g: 'ق', // g(x) -> ق(س)
  h: 'هـ',
  t: 'ن',
  r: 'نق', // radius -> نصف القطر
  A: 'م',  // Area -> المساحة
  V: 'ح',  // Volume -> الحجم
};

// Arabic Function Mappings
const FUNCTION_MAP: Record<string, string> = {
  '\\sin': 'جا',
  '\\cos': 'جتا',
  '\\tan': 'ظا',
  '\\cot': 'ظتا',
  '\\sec': 'قا',
  '\\csc': 'قتا',
  '\\sinh': 'جاح',
  '\\cosh': 'جتاح',
  '\\tanh': 'ظاح',
  '\\lim': 'نها',
  '\\log': 'لو',
  '\\ln': 'لو_هـ',
  '\\det': 'محدد',
  '\\int': 'تكامل',
  '\\sum': 'مجموع',
  '\\prod': 'جداء',
  '\\sqrt': 'جذر',
  '\\pi': 'ط',
  '\\infty': '∞ (ما لا نهاية)',
  '\\Delta': 'Δ (التغير)',
  '\\theta': 'هـ',
  '\\alpha': 'ألفا',
  '\\beta': 'بيتا',
  '\\gamma': 'جامام',
  '\\times': '×',
  '\\div': '÷',
  '\\pm': '±',
  '\\neq': '≠',
  '\\leq': '≤',
  '\\geq': '≥',
  '\\approx': '≈',
  '\\in': '∈ (ينتمي إلى)',
  '\\subset': '⊂ (مجموعة جزئية)',
};

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

export function convertNumeralsToArabic(str: string): string {
  return str.replace(/\d/g, (d) => ARABIC_DIGITS[parseInt(d, 10)]);
}

/**
 * Transforms LaTeX or standard math string to Arabic mathematical notation string
 */
export function convertTeXToArabicMath(latexStr: string, options: ArabicMathConversionOptions = {}): string {
  if (!latexStr) return '';

  let result = latexStr;

  // 1. Replace TeX commands and functions
  Object.entries(FUNCTION_MAP).forEach(([texCmd, arabicName]) => {
    const escaped = texCmd.replace(/\\/g, '\\\\');
    const regex = new RegExp(escaped, 'g');
    result = result.replace(regex, ` ${arabicName} `);
  });

  // 2. Handle Fractions: \frac{a}{b} -> (a / b) or (a على b)
  result = result.replace(/\\frac\s*\{([^}]+)\}\s*\{([^}]+)\}/g, '($1 ÷ $2)');

  // 3. Handle Powers / Exponents: x^2 -> س² or س^٢
  result = result.replace(/([a-zA-Z])\^2/g, '$1²');
  result = result.replace(/([a-zA-Z])\^3/g, '$1³');

  // 4. Replace Variables (standing alone or in expressions)
  result = result.replace(/\b([a-zA-Z])\b/g, (match, p1) => {
    return VARIABLE_MAP[p1] || p1;
  });

  // 5. Clean up extra TeX syntax symbols like {}, \, $
  result = result.replace(/[\{\}\$\\]/g, '').trim();

  // 6. Convert numbers if requested
  if (options.useArabicNumerals) {
    result = convertNumeralsToArabic(result);
  }

  return result;
}

/**
 * Checks if a message contains mathematical formulas (LaTeX or TeX symbols or equations)
 */
export function containsMathExpressions(text: string): boolean {
  if (!text) return false;
  return (
    /\\(begin|end|frac|sum|int|lim|sin|cos|tan|sqrt|matrix|alpha|beta|pi|infty)/.test(text) ||
    /(\$\$[\s\S]+?\$\$|\$[^\$]+?\$)/.test(text) ||
    /([a-zA-Z]\s*=\s*[-+]?\d+)/.test(text) ||
    /[∫∑√π∞≈≠≤≥]/.test(text)
  );
}
