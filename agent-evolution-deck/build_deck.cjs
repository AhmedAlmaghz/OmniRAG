// build_deck.cjs — «تطوّر وكلاء الذكاء الاصطناعي» — 17 شريحة، عربي RTL، نمط تقني داكن
const path = require('path');
const pptxgen = require(path.join(__dirname, '..', 'node_modules', 'pptxgenjs'));

// ---------- ثوابت الهوية البصرية ----------
const BG = '0B1F3A'; // أزرق حبري داكن
const BG2 = '0E2A4F'; // بطاقات أفتح
const BG3 = '102E56'; // تظليل أعمق
const PRIMARY = '00D4FF'; // سماوي تقني
const ACCENT = 'C9A959'; // ذهبي هادئ
const LIGHT = '9BE8FF'; // سماوي فاتح (المرحلة 3)
const TEXT = 'F5F7FA';
const MUTED = '8FA3B8';
const DIM = '5A7186';
const FONT = 'Segoe UI';
const W = 13.33,
  H = 7.5,
  M = 0.5;

const ERAS = [
  { n: '01', name: 'هندسة الأوامر', color: ACCENT },
  { n: '02', name: 'هندسة السياق', color: PRIMARY },
  { n: '03', name: 'هندسة الحزام', color: LIGHT },
];

// ---------- الدوال المساعدة ----------
const shadow = () => ({ type: 'outer', color: '000000', blur: 7, offset: 2, angle: 90, opacity: 0.3 });
const easeOut = (t) => 1 - Math.pow(1 - t, 2);
const asArabicDigits = (s) => String(s).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

function bgFill(s) {
  s.background = { color: BG };
}

function T(slide, text, o = {}) {
  slide.addText(text, Object.assign({ fontFace: FONT, color: TEXT, rtlMode: true, align: 'right', margin: 0 }, o));
}

function card(slide, x, y, w, h, { fill = BG2, lineColor = null, radius = 0.09 } = {}) {
  const opt = { x, y, w, h, fill: { color: fill }, rectRadius: radius, shadow: shadow() };
  if (lineColor) opt.line = { color: lineColor, width: 0.75 };
  slide.addShape('roundRect', opt);
}

function arrowRTL(slide, xFrom, xTo, y, color = DIM, width = 1.5) {
  slide.addShape('line', { x: Math.min(xFrom, xTo), y, w: Math.abs(xTo - xFrom), h: 0, line: { color, width } });
  const s = 0.13;
  slide.addShape('triangle', { x: xTo - s, y: y - s / 2, w: s, h: s, fill: { color }, rotate: 270 });
}

// خط زمني: mode "top" (كل التسميات فوق الخط) أو "stagger" (توزيع علوي/سفلي متناوب)
function timeline(
  slide,
  { y, xFrom, xTo, events, labelW = 2.0, labelSize = 11, subSize = 10, mode = 'top', colors: colorsArg },
) {
  const colors = colorsArg || { line: DIM, node: PRIMARY, nodeFill: BG };
  slide.addShape('line', { x: xFrom, y, w: xTo - xFrom, h: 0, line: { color: colors.line, width: 2 } });
  events.forEach((ev, i) => {
    const cx = ev.x !== undefined ? ev.x : xFrom + (xTo - xFrom) * ev.frac;
    slide.addShape('ellipse', {
      x: cx - 0.06,
      y: y - 0.06,
      w: 0.12,
      h: 0.12,
      fill: { color: colors.nodeFill },
      line: { color: colors.node, width: 1.75 },
    });
    const above = mode === 'stagger' ? i % 2 === 0 : true;
    const clampX = (x) => Math.min(Math.max(x, 0.5), W - 0.5 - labelW);
    const lx = clampX(cx - labelW / 2);
    T(slide, ev.t, {
      x: lx,
      y: above ? y - 0.42 : y + 0.12,
      w: labelW,
      h: 0.4,
      fontSize: labelSize,
      bold: true,
      align: 'center',
      valign: 'middle',
      color: ev.c || TEXT,
      lineSpacing: labelSize + 2,
    });
    if (ev.s)
      T(slide, ev.s, {
        x: lx,
        y: above ? y - 0.95 : y + 0.54,
        w: labelW,
        h: 0.55,
        fontSize: subSize,
        align: 'center',
        valign: 'middle',
        color: ev.sc || MUTED,
        lineSpacing: subSize + 2,
      });
  });
}

function header(slide, title, sub, stageIdx, num) {
  T(slide, title, { x: 1.45, y: 0.34, w: 11.35, h: 0.62, fontSize: 28, bold: true, lineSpacing: 30 });
  if (sub) T(slide, sub, { x: 1.45, y: 0.95, w: 11.35, h: 0.35, fontSize: 13, color: MUTED, lineSpacing: 15 });
  if (stageIdx !== undefined) {
    const era = ERAS[stageIdx];
    slide.addShape('roundRect', {
      x: 0.45,
      y: 0.34,
      w: 0.62,
      h: 0.62,
      rectRadius: 0.09,
      fill: { color: BG2 },
      line: { color: era.color, width: 1 },
    });
    T(slide, era.n, {
      x: 0.45,
      y: 0.34,
      w: 0.62,
      h: 0.62,
      fontSize: 17,
      bold: true,
      align: 'center',
      color: era.color,
      valign: 'middle',
    });
    T(slide, era.name, {
      x: 0.21,
      y: 1.02,
      w: 1.1,
      h: 0.24,
      fontSize: 8.5,
      align: 'center',
      color: era.color,
      lineSpacing: 10,
    });
  }
  if (num)
    T(slide, asArabicDigits(String(num).padStart(2, '0')), {
      x: 0.45,
      y: 7.12,
      w: 0.5,
      h: 0.26,
      fontSize: 10,
      color: DIM,
      align: 'left',
    });
}

function src(slide, txt, y = 7.08) {
  T(slide, txt, { x: 2.2, y, w: 10.63, h: 0.26, fontSize: 9.5, color: DIM, lineSpacing: 11 });
}

function nodeGrid(slide, cfg) {
  const { pts, lines, maxR = 0.2 } = cfg;
  lines.forEach(([a, b]) => {
    const [ax, ay] = pts[a],
      [bx, by] = pts[b];
    slide.addShape('line', {
      x: Math.min(ax, bx),
      y: Math.min(ay, by),
      w: Math.abs(bx - ax),
      h: Math.abs(by - ay),
      flipV: (by - ay) * (bx - ax) < 0,
      line: { color: PRIMARY, width: 0.75, transparency: 62 },
    });
  });
  pts.forEach(([x, y, r]) => {
    const rr = r || maxR * (0.4 + (0.6 * ((x * 7 + y * 3) % 10)) / 10);
    slide.addShape('ellipse', {
      x: x - rr,
      y: y - rr,
      w: rr * 2,
      h: rr * 2,
      fill: { color: PRIMARY, transparency: 35 + ((x * 13 + y * 5) % 30) },
    });
  });
}

function slide_dot(s, color, x, y, r = 0.06) {
  s.addShape('ellipse', { x: x - r, y: y - r, w: r * 2, h: 2 * r, fill: { color } });
}
function arrowDown(s, x, yTop, h, color) {
  s.addShape('line', { x, y: yTop, w: 0, h, line: { color, width: 1.25 } });
  s.addShape('triangle', { x: x - 0.065, y: yTop + h - 0.13, w: 0.13, h: 0.13, fill: { color }, rotate: 180 });
}

// ---------- بدء البناء ----------
const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';
pres.rtlMode = true;
pres.author = 'OmniRAG';
pres.title = 'تطوّر وكلاء الذكاء الاصطناعي';
pres.subject = 'من هندسة الأوامر إلى هندسة السياق إلى هندسة الحزام';

// ========== شريحة 1: الغلاف ==========
{
  const s = pres.addSlide();
  bgFill(s);
  nodeGrid(s, {
    pts: [
      [1.1, 1.4],
      [2.3, 2.5],
      [1.0, 3.6],
      [2.6, 4.7],
      [1.6, 6.3],
      [3.4, 1.1],
      [3.9, 3.1],
      [3.2, 5.7],
      [12.2, 1.2],
      [11.2, 2.4],
      [12.5, 3.5],
      [11.0, 4.8],
      [12.0, 6.2],
      [10.4, 1.4],
      [10.1, 3.3],
      [10.6, 5.8],
      [5.4, 0.55],
      [8.1, 0.5],
      [6.8, 7.0],
      [9.5, 6.9],
    ],
    lines: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [0, 5],
      [5, 6],
      [6, 7],
      [8, 9],
      [9, 10],
      [10, 11],
      [11, 12],
      [8, 13],
      [13, 14],
      [14, 15],
      [16, 5],
      [16, 13],
      [17, 8],
      [18, 11],
      [19, 15],
      [1, 6],
      [9, 14],
    ],
  });
  T(s, 'من هندسة الأوامر إلى هندسة الحزام', {
    x: 1.67,
    y: 1.7,
    w: 10,
    h: 0.4,
    fontSize: 17,
    align: 'center',
    color: ACCENT,
    charSpacing: 2,
    lineSpacing: 20,
  });
  T(s, 'تطوّر وكلاء الذكاء الاصطناعي', {
    x: 0.67,
    y: 2.12,
    w: 12,
    h: 1.05,
    fontSize: 54,
    bold: true,
    align: 'center',
    lineSpacing: 58,
  });
  T(s, 'ثلاث موجات أعادت تعريف طريقة بناء التطبيقات الذكية — وكيف نبرمج النماذج اللغوية الكبيرة', {
    x: 1.6,
    y: 3.32,
    w: 10.13,
    h: 0.55,
    fontSize: 15,
    align: 'center',
    color: MUTED,
    lineSpacing: 19,
  });
  ERAS.forEach((era, i) => {
    const w = 3.3,
      gap = 0.35,
      x = (W - 3 * w - 2 * gap) / 2 + (2 - i) * (w + gap);
    card(s, x, 4.35, w, 1.0, { fill: BG2 });
    T(s, era.n, {
      x: x + w - 0.72,
      y: 4.35,
      w: 0.62,
      h: 1.0,
      fontSize: 26,
      bold: true,
      color: era.color,
      align: 'center',
      valign: 'middle',
    });
    T(s, era.name, { x: x + 0.2, y: 4.53, w: w - 0.95, h: 0.4, fontSize: 16, bold: true, lineSpacing: 19 });
    T(s, ['كيف نَسأل النموذج', 'ماذا نُدخل إلى النموذج', 'ما الذي يحيط بالنموذج'][i], {
      x: x + 0.2,
      y: 4.93,
      w: w - 0.95,
      h: 0.32,
      fontSize: 11,
      color: MUTED,
      lineSpacing: 13,
    });
    if (i < 2) arrowRTL(s, x, x - gap, 4.85, DIM, 1.25);
  });
  T(s, 'إعداد: فريق OmniRAG — سبتمبر ٢٠٢٦', {
    x: 3.67,
    y: 6.7,
    w: 6,
    h: 0.3,
    fontSize: 11,
    align: 'center',
    color: DIM,
    lineSpacing: 13,
  });
  s.addNotes(
    'مرحباً بالجميع. عرض اليوم يرصد رحلة وكلاء الذكاء الاصطناعي عبر ثلاث موجات متتالية. الفكرة المحورية: مع كل موجة، انتقل ما نبرمجه نحن البشر من طبقة إلى أعمق في النظام — من صياغة السؤال، إلى إدارة المدخلات، إلى بناء النظام المحيط بأكمله.',
  );
}

// ========== شريحة 2: الخط الزمني الرئيسي ==========
{
  const s = pres.addSlide();
  bgFill(s);
  header(s, 'الخط الزمني ٢٠٢٠ – ٢٠٢٦', 'من أوراق بحثية إلى مساعدين شخصيين يعيشون على أجهزتنا', undefined, 2);
  const y = 4.75,
    xFrom = 0.9,
    xTo = 12.43;
  const bands = [
    { st: 1, en: 4.35, color: ACCENT, label: 'المرحلة ١ — هندسة الأوامر' },
    { st: 4.35, en: 8.85, color: PRIMARY, label: 'المرحلة ٢ — هندسة السياق' },
    { st: 8.85, en: 12.43, color: LIGHT, label: 'المرحلة ٣ — هندسة الحزام' },
  ];
  bands.forEach((b) => {
    s.addShape('rect', {
      x: b.st,
      y: y - 0.55,
      w: b.en - b.st,
      h: 1.1,
      fill: { color: b.color, transparency: 88 },
      line: { color: b.color, width: 0.5, transparency: 55 },
    });
    T(s, b.label, {
      x: b.st + 0.08,
      y: y + 1.12,
      w: b.en - b.st - 0.16,
      h: 0.26,
      fontSize: 10.5,
      bold: true,
      color: b.color,
      align: 'center',
      lineSpacing: 12,
    });
  });
  timeline(s, {
    y,
    xFrom,
    xTo,
    mode: 'stagger',
    labelW: 1.78,
    labelSize: 10.5,
    subSize: 9,
    events: [
      { frac: 0.0, t: 'GPT-3 وورقة RAG', s: 'مايو ٢٠٢٠', c: ACCENT },
      { frac: 0.115, t: 'سلسلة التفكير', s: 'يناير ٢٠٢٢', c: ACCENT },
      { frac: 0.225, t: 'ChatGPT', s: 'نوفمبر ٢٠٢٢', c: ACCENT },
      { frac: 0.335, t: 'AutoGPT', s: 'مارس ٢٠٢٣', c: ACCENT },
      { frac: 0.47, t: 'MCP', s: 'نوفمبر ٢٠٢٤', c: PRIMARY },
      { frac: 0.6, t: 'Claude Code', s: 'فبراير ٢٠٢٥', c: PRIMARY },
      { frac: 0.715, t: 'هندسة السياق', s: 'يونيو ٢٠٢٥', c: PRIMARY },
      { frac: 0.85, t: 'بروتوكول ACP', s: 'يونيو ٢٠٢٥', c: LIGHT },
      { frac: 1.0, t: 'OpenClaw', s: 'يناير ٢٠٢٦', c: LIGHT },
    ],
  });
  const rows = [
    {
      c: ACCENT,
      h: 'العهد الذهبي للأوامر (٢٠٢٠ – ٢٠٢٣):',
      b: 'صياغة السؤال الصحيح هي المهارة — Zero/Few-shot، سلسلة التفكير، ReAct',
    },
    {
      c: PRIMARY,
      h: 'ثورة السياق (٢٠٢٤ – ٢٠٢٥):',
      b: 'النموذج ثابت؛ ما يتغيّر هو ما نُدخل إليه — RAG، الذاكرة، الأدوات، MCP',
    },
    {
      c: LIGHT,
      h: 'عهد الحزام (٢٠٢٥ – ٢٠٢٦):',
      b: 'البنية التحتية المحيطة بالنموذج هي المنتج — حلقة الوكيل، الصلاحيات، دورة الحياة',
    },
  ];
  rows.forEach((r, i) => {
    const yy = 1.35 + i * 0.78;
    slide_dot(s, r.c, 12.55, yy + 0.12);
    T(
      s,
      [
        { text: r.h + '  ', options: { bold: true, color: r.c } },
        { text: r.b, options: { color: MUTED } },
      ],
      { x: 0.7, y: yy, w: 11.7, h: 0.7, fontSize: 12.5, lineSpacing: 17 },
    );
  });
  src(
    s,
    'المصادر: arXiv (2020)، Anthropic (Nov 2024)، Zed (Jun 2025)، Wikipedia/OpenClaw (2026) — تواريخ موثقة حتى سبتمبر ٢٠٢٦',
    7.08,
  );
  s.addNotes(
    'الخط الزمني يقرأ من اليمين إلى اليسار كما هو معتاد في العربية. لاحظوا التداخل بين الموجات: MCP ظهر في نهاية ٢٠٢٤ ويمهّد للحزام، وهندسة السياق كمصطلح رسخت في يونيو ٢٠٢٥.',
  );
}

// ========== شريحة 3: نظرة عامة على المراحل الثلاث ==========
{
  const s = pres.addSlide();
  bgFill(s);
  header(s, 'ثلاث مراحل، وشيء واحد يتغيّر', 'ما نبرمجه نحن البشر ينتقل إلى طبقة أعمق في كل مرة', undefined, 3);
  const w = 3.75,
    gap = 0.29,
    x0 = (W - 3 * w - 2 * gap) / 2;
  const cards = [
    {
      q: 'كيف نَسأل؟',
      b: 'صياغة الأمر اللفظي بدقة: أمثلة Few-shot، سلاسل تفكير، أدوار للنموذج. المهارة كتابة «السؤال المثالي» لنموذج ثابت.',
      k: 'Zero/Few-shot · CoT · ReAct · الأدوار',
    },
    {
      q: 'ماذا نُدخل؟',
      b: 'النموذج لم يعد يتغيّر؛ التحسين انتقل إلى ما يصل إلى نافذة السياق: استرجاع معرفة، ذاكرة، أدوات، تاريخ محادثة.',
      k: 'RAG · الذاكرة · الأدوات · MCP',
    },
    {
      q: 'بماذا نُحيط؟',
      b: 'لا نكتب أوامر ولا ندير سياقاً لحظياً — بل نبني النظام بأكمله: حلقة الوكيل، الصلاحيات، الضوابط، دورة الحياة الكاملة.',
      k: 'حلقة الوكيل · الصلاحيات · المهارات · الاختبارات',
    },
  ];
  cards.forEach((c1, i) => {
    const era = ERAS[i],
      x = x0 + (2 - i) * (w + gap);
    card(s, x, 1.6, w, 4.85, { fill: BG2 });
    slide_dot(s, era.color, x + w - 0.55, 2.0, 0.09);
    T(s, era.n, {
      x: x + 0.25,
      y: 1.8,
      w: w - 0.95,
      h: 0.5,
      fontSize: 15,
      bold: true,
      color: era.color,
      lineSpacing: 18,
    });
    T(s, era.name, { x: x + 0.25, y: 2.24, w: w - 0.95, h: 0.5, fontSize: 21, bold: true, lineSpacing: 25 });
    T(s, c1.q, {
      x: x + 0.25,
      y: 2.85,
      w: w - 0.5,
      h: 0.45,
      fontSize: 16,
      bold: true,
      color: era.color,
      lineSpacing: 20,
    });
    T(s, c1.b, { x: x + 0.25, y: 3.38, w: w - 0.5, h: 1.7, fontSize: 12, color: TEXT, lineSpacing: 17 });
    T(s, c1.k, { x: x + 0.25, y: 5.6, w: w - 0.5, h: 0.6, fontSize: 10.5, color: era.color, lineSpacing: 14 });
    if (i < 2) arrowRTL(s, x, x - gap, 4.0, DIM, 1.25);
  });
  T(s, 'اتجاه التطوّر: من نصّ نكتبه، إلى بيانات نُغذّيها، إلى نظام نبنيه بالكامل', {
    x: 2.07,
    y: 6.62,
    w: 9.2,
    h: 0.32,
    fontSize: 12.5,
    bold: true,
    align: 'center',
    color: MUTED,
    lineSpacing: 15,
  });
  s.addNotes(
    'الرسالة الجوهرية للعرض كله: كل مرحلة لم تلغِ ما قبلها بل بُنيت فوقه. هندسة الأوامر ما زالت ضرورية داخل الحزام، لكنها لم تعد هي الميزة التنافسية.',
  );
}

// ========== شريحة 4: النشأة ==========
{
  const s = pres.addSlide();
  bgFill(s);
  header(s, 'هندسة الأوامر: من أين بدأت؟', 'قصة ثلاثة نماذج: من التنبؤ بالكلمة التالية إلى «التعلم ضمن السياق»', 0, 4);
  const vx = 11.9,
    vy0 = 1.7,
    vh = 4.4;
  s.addShape('line', { x: vx, y: vy0, w: 0, h: vh, line: { color: ACCENT, width: 2 } });
  [
    ['GPT-1', '٢٠١٨', 'إثبات المفهوم: أول نموذج توليدي مسبق التدريب (117M معامل)'],
    ['GPT-2', '٢٠١٩', 'نافذة 1,024 توكن — تنبؤ بالكلمة التالية، بلا أي فهم للمهمة'],
    ['GPT-3', '٢٠٢٠', '175B معامل ونافذة 2,048: أمثلة داخل الأمر تكفي لتعليم المهمة — «التعلم ضمن السياق»'],
  ].forEach((ev, i) => {
    const yy = vy0 + (i + 0.5) * (vh / 3);
    s.addShape('ellipse', {
      x: vx - 0.07,
      y: yy - 0.07,
      w: 0.14,
      h: 0.14,
      fill: { color: BG },
      line: { color: ACCENT, width: 1.75 },
    });
    T(
      s,
      [
        { text: ev[0] + '  ', options: { bold: true, color: ACCENT, fontSize: 15 } },
        { text: ev[1], options: { color: MUTED, fontSize: 12 } },
      ],
      { x: 6.3, y: yy - 0.3, w: 5.3, h: 0.4, lineSpacing: 18 },
    );
    T(s, ev[2], { x: 6.3, y: yy + 0.06, w: 5.3, h: 0.85, fontSize: 11.5, color: MUTED, lineSpacing: 15 });
  });
  T(s, '٢٠١٨ ← ٢٠٢٠', { x: 11.15, y: 6.4, w: 1.5, h: 0.3, fontSize: 10, color: DIM, align: 'center', lineSpacing: 12 });
  card(s, 0.7, 2.1, 4.9, 3.75, { fill: BG3 });
  T(s, 'جوهر هندسة الأوامر', {
    x: 0.95,
    y: 2.35,
    w: 4.4,
    h: 0.35,
    fontSize: 13,
    bold: true,
    color: ACCENT,
    lineSpacing: 16,
  });
  const bx = 1.15,
    bw = 2.0,
    bh = 0.62;
  [
    ['الأمر المُحكم', 'ما نتحكم فيه'],
    ['النموذج الثابت', 'ما لا نتحكم فيه'],
    ['الخرج المُحسَّن', 'النتيجة'],
  ].forEach((r, i) => {
    const yy = 2.9 + i * 0.86;
    s.addShape('rect', {
      x: bx,
      y: yy,
      w: bw,
      h: bh,
      fill: { color: i === 1 ? BG : BG2 },
      line: { color: i === 1 ? ACCENT : PRIMARY, width: i === 1 ? 1.5 : 0.75 },
    });
    T(s, r[0], {
      x: bx,
      y: yy,
      w: bw,
      h: bh,
      fontSize: 11.5,
      bold: true,
      align: 'center',
      valign: 'middle',
      lineSpacing: 14,
    });
    T(s, r[1], {
      x: bx + bw + 0.25,
      y: yy,
      w: 2.1,
      h: bh,
      fontSize: 10.5,
      color: MUTED,
      valign: 'middle',
      lineSpacing: 13,
    });
    if (i < 2) arrowDown(s, bx + bw / 2, yy + bh, 0.1, DIM);
  });
  T(s, 'كل المعرفة اللازمة يجب أن تسكن داخل نصّ الأمر نفسه', {
    x: 0.95,
    y: 5.35,
    w: 4.4,
    h: 0.35,
    fontSize: 10.5,
    color: MUTED,
    align: 'center',
    lineSpacing: 13,
  });
  src(s, 'المصادر: «Language Models are Few-Shot Learners» (arXiv:2005.14165)، GPT-2 paper (OpenAI, 2019)');
  s.addNotes(
    'قبل ٢٠٢٠ كان التعامل مع النماذج مهمة هندسية ثقيلة: ضبط دقيق على بيانات كل مهمة. GPT-3 غيّر المعادلة: أمثلة قليلة داخل النص تكفي. هنا وُلدت هندسة الأوامر كمهارة مستقلة.',
  );
}

// ========== شريحة 5: التقنيات الأساسية ==========
{
  const s = pres.addSlide();
  bgFill(s);
  header(s, 'صندوق أدوات هندسة الأوامر', 'أربع تقنيات رسّخت صياغة الأمر مهارةً برمجية قائمة بذاتها', 0, 5);
  const rows = [
    [
      'Zero-shot / Few-shot',
      '٢٠٢٠',
      'تغذية النموذج بأمثلة صفرية أو قليلة داخل الأمر نفسه — بلا أي تدريب إضافي. أثبتتها ورقة GPT-3.',
      'الأمثلة داخل النص تُعلّم المهمة',
    ],
    [
      'سلسلة التفكير — CoT',
      'يناير ٢٠٢٢',
      'مطالبة النموذج بـ«فكّر خطوة بخطوة» قبل الإجابة — قفزة في دقة الاستدلال الرياضي والمنطقي.',
      '«لنفكّر خطوة بخطوة» تفتح الاستدلال',
    ],
    [
      'ReAct',
      'أكتوبر ٢٠٢٢',
      'دمج التفكير بالفعل: النموذج يفكّر ثم يستدعي أداة ثم يلاحظ النتيجة — الجدّ المباشر لحلقة الوكيل.',
      'التفكير + الفعل في حلقة واحدة',
    ],
    [
      'الأدوار — Role Prompting',
      '٢٠٢٢ – ٢٠٢٣',
      '«أنت خبير قانوني…» — تقييد الأسلوب والمجال وتحسين الاتساق بتكليف النموذج شخصية محددة.',
      'الشخصية تقيّد فضاء الإجابة',
    ],
  ];
  rows.forEach((r, i) => {
    const yy = 1.62 + i * 1.22;
    card(s, 0.6, yy, 12.13, 1.05, { fill: BG2, radius: 0.06 });
    T(s, asArabicDigits(String(i + 1).padStart(2, '0')), {
      x: 11.75,
      y: yy,
      w: 0.7,
      h: 1.05,
      fontSize: 26,
      bold: true,
      color: ACCENT,
      align: 'center',
      valign: 'middle',
    });
    T(s, r[0], { x: 8.1, y: yy + 0.12, w: 3.5, h: 0.4, fontSize: 14.5, bold: true, lineSpacing: 17 });
    T(s, r[1], { x: 8.1, y: yy + 0.58, w: 3.5, h: 0.3, fontSize: 10, color: ACCENT, lineSpacing: 12 });
    T(s, r[2], { x: 2.85, y: yy, w: 5.1, h: 1.05, fontSize: 11, color: MUTED, valign: 'middle', lineSpacing: 15 });
    T(s, r[3], {
      x: 0.8,
      y: yy,
      w: 1.95,
      h: 1.05,
      fontSize: 10.5,
      bold: true,
      color: PRIMARY,
      valign: 'middle',
      lineSpacing: 13,
    });
    if (i < 3) arrowDown(s, 12.1, yy + 1.05, 0.17, DIM);
  });
  src(s, 'المصادر: Wei et al. (arXiv:2201.11903)، Yao et al. (arXiv:2210.03629)، Brown et al. (arXiv:2005.14165)', 7.1);
  s.addNotes(
    'التقنيات الأربع لا تزال مستخدمة اليوم داخل الحزم الحديثة — لكن لاحظوا أن ReAct تحديداً هو الفكرة التي ستتطور لاحقاً لتصبح حلقة الوكيل الكاملة في المرحلة الثالثة.',
  );
}

// ========== شريحة 6: حدود المرحلة الأولى (الانعطاف) ==========
{
  const s = pres.addSlide();
  bgFill(s);
  header(
    s,
    'حدود هندسة الأوامر — نقطة الانعطاف',
    'النموذج يعرف الكثير، لكنه لا يتذكر ولا يملك أدوات ولا يرى إلا نافذته',
    0,
    6,
  );
  T(s, '2,048', { x: 6.4, y: 1.48, w: 6.3, h: 1.3, fontSize: 68, bold: true, color: ACCENT, lineSpacing: 72 });
  T(s, 'توكن — كل «ذاكرة» GPT-3 المتاحة', {
    x: 6.4,
    y: 2.8,
    w: 6.3,
    h: 0.4,
    fontSize: 15,
    color: TEXT,
    lineSpacing: 18,
  });
  T(s, 'كل المعرفة يجب أن تُحشر داخل الأمر — وما لا يتسع يُنسى', {
    x: 6.4,
    y: 3.25,
    w: 6.3,
    h: 0.35,
    fontSize: 11.5,
    color: MUTED,
    lineSpacing: 14,
  });
  const rows = [
    ['لا ذاكرة', 'كل محادثة تبدأ من الصفر — لا تاريخ، لا تعلّم من الجلسات السابقة'],
    ['لا أدوات', 'لا يمكنه البحث أو الحساب أو الوصول إلى أي نظام خارجي — عالَم مغلَق'],
    ['لا معرفة محدّثة', 'المعرفة مُجمّدة عند تاريخ التدريب — والنموذج لا «يعرف» ما جهله'],
    ['هشاشة الصياغة', 'تغيير كلمة واحدة في الأمر قد يقلب جودة الخرج رأساً على عقب'],
  ];
  rows.forEach((r, i) => {
    const yy = 1.75 + i * 1.18;
    slide_dot(s, i === 3 ? ACCENT : PRIMARY, 5.55, yy + 0.1);
    T(s, r[0], { x: 3.2, y: yy, w: 2.2, h: 0.35, fontSize: 14, bold: true, lineSpacing: 17 });
    T(s, r[1], { x: 0.6, y: yy + 0.36, w: 4.9, h: 0.6, fontSize: 11, color: MUTED, lineSpacing: 14 });
  });
  card(s, 0.6, 6.35, 12.13, 0.72, { fill: BG3, radius: 0.06 });
  T(
    s,
    [
      { text: 'القفزة التالية:  ', options: { bold: true, color: PRIMARY } },
      {
        text: 'إذا كانت المشكلة في «ما يدخل إلى النموذج» — فالحل ليس أمراً أذكى، بل نظاماً يُدير المدخلات. ← هندسة السياق',
        options: { color: TEXT },
      },
    ],
    { x: 0.85, y: 6.35, w: 11.6, h: 0.72, fontSize: 12.5, valign: 'middle', lineSpacing: 16 },
  );
  src(s, 'المصادر: نافذة سياق GPT-3 (2,048 توكن) — Brown et al. 2020؛ حدود AutoGPT المبكرة — Wikipedia (2026)', 7.16);
  s.addNotes(
    'هذه الشريحة هي مفصل العرض. 2,048 توكن تعني أن كل تراكم معرفي — وثائق الشركة، المحادثات، البيانات الحية — كان خارج متناول النموذج مهما أتقنّا صياغة الأمر. من هنا انطلقت الموجة الثانية.',
  );
}

// ========== شريحة 7: هندسة السياق — لماذا؟ ==========
{
  const s = pres.addSlide();
  bgFill(s);
  header(s, 'هندسة السياق: لماذا؟', 'عندما تثبت النماذج، يصبح التنافس على ما يدخل إليها', 1, 7);
  card(s, 0.6, 1.55, 5.3, 4.9, { fill: BG2 });
  T(s, '”', {
    x: 5.05,
    y: 1.42,
    w: 0.7,
    h: 0.85,
    fontSize: 48,
    bold: true,
    color: PRIMARY,
    align: 'center',
    lineSpacing: 50,
  });
  T(
    s,
    '«+1 لهندسة السياق بدل هندسة الأوامر. إنها الفن الرقيق لملء نافذة السياق بالمعلومات الصحيحة تماماً للخطوة القادمة»',
    { x: 0.95, y: 2.45, w: 4.6, h: 2.0, fontSize: 15.5, bold: true, lineSpacing: 23 },
  );
  T(s, '— أندريه كارباثي، يونيو ٢٠٢٥', {
    x: 0.95,
    y: 4.65,
    w: 4.6,
    h: 0.35,
    fontSize: 12,
    color: ACCENT,
    lineSpacing: 15,
  });
  T(
    s,
    'المصطلح روّجه توبي ليوتكي (Shopify) ثم تبنّاه كارباثي؛ وعرّفه هاريسون تشيس (LangChain) ببناء أنظمة ديناميكية تُوصل المعلومة والأداة الصحيحتين بالتنسيق الصحيح.',
    { x: 0.95, y: 5.15, w: 4.6, h: 1.1, fontSize: 10.5, color: MUTED, lineSpacing: 14 },
  );
  card(s, 6.15, 1.55, 6.58, 4.9, { fill: BG3 });
  T(s, 'تشبيه «نظام التشغيل»: النموذج معالج، والسياق ذاكرة RAM', {
    x: 6.45,
    y: 1.75,
    w: 6.0,
    h: 0.4,
    fontSize: 13.5,
    bold: true,
    color: PRIMARY,
    lineSpacing: 17,
  });
  const layers = [
    ['RAG — استرجاع المعرفة', 'مستندات وأجزاء مسترجعة لحظياً من قاعدة معرفة خارجية'],
    ['الذاكرة', 'تاريخ الجلسات والمحادثات السابقة مضغوطاً'],
    ['الأدوات', 'مخزون قدرات النموذج: بحث، تشغيل شيفرة، استدعاء APIs'],
    ['التاريخ والحالة', 'ما جرى في هذه المهمة حتى اللحظة'],
  ];
  layers.forEach((r, i) => {
    const yy = 2.32 + i * 0.68;
    s.addShape('rect', { x: 6.45, y: yy, w: 6.0, h: 0.6, fill: { color: BG2 } });
    T(s, r[0], { x: 10.35, y: yy, w: 2.1, h: 0.6, fontSize: 11, bold: true, valign: 'middle', lineSpacing: 13 });
    T(s, r[1], { x: 6.55, y: yy, w: 3.7, h: 0.6, fontSize: 9.5, color: MUTED, valign: 'middle', lineSpacing: 12 });
  });
  arrowDown(s, 9.45, 5.02, 0.26, PRIMARY);
  s.addShape('rect', {
    x: 6.7,
    y: 5.36,
    w: 5.6,
    h: 0.7,
    fill: { color: PRIMARY, transparency: 82 },
    line: { color: PRIMARY, width: 1.25 },
  });
  T(
    s,
    [
      { text: 'نافذة السياق  ', options: { bold: true, color: TEXT } },
      { text: '(RAM) — كل ما يراه النموذج الآن', options: { color: MUTED } },
    ],
    { x: 6.85, y: 5.36, w: 5.3, h: 0.7, fontSize: 12.5, valign: 'middle', align: 'center', lineSpacing: 15 },
  );
  T(s, 'النموذج (المعالج) يستهلك النافذة في كل خطوة', {
    x: 6.45,
    y: 6.12,
    w: 6.0,
    h: 0.28,
    fontSize: 10,
    color: MUTED,
    align: 'center',
    lineSpacing: 12,
  });
  src(
    s,
    'المصادر: Karpathy (يونيو ٢٠٢٥) عبر Simon Willison؛ Chase — «The rise of context engineering» (LangChain, Jun 2025)؛ تشبيه LLM-OS — Karpathy (2023)',
  );
  s.addNotes(
    'الفكرة الناظمة: النموذج أصبح مورداً عاماً متاحاً للجميع — GPT وClaude وGemini. الميزة التنافسية انتقلت إلى أنظمة السياق: ماذا نسترجع، ماذا نتذكر، ماذا نضغط، ومتى نُفرغ النافذة.',
  );
}

// ========== شريحة 8: نمو نافذة السياق ==========
{
  const s = pres.addSlide();
  bgFill(s);
  header(s, 'نافذة السياق تتضخّم ×10,000', 'خلال ست سنوات: من ألف توكن إلى عشرة ملايين', 1, 8);
  const bars = [
    ['GPT-2', '1,024', '2019'],
    ['GPT-3', '2,048', '2020'],
    ['GPT-4', '32K', '2023'],
    ['GPT-4 Turbo', '128K', '2023'],
    ['Gemini 1.5 Pro / GPT-4.1', '1M', '2024–25'],
    ['Llama 4 Scout', '10M', '2025'],
  ];
  const maxH = 3.1,
    minH = 0.4,
    base = 5.85;
  bars.forEach((b, i) => {
    const bw = 1.55,
      gap2 = 0.28,
      x = (W - 6 * bw - 5 * gap2) / 2 + (5 - i) * (bw + gap2);
    const hh = minH + (maxH - minH) * easeOut(i / 5);
    s.addShape('rect', {
      x,
      y: base - hh,
      w: bw,
      h: hh,
      fill: { color: PRIMARY, transparency: i === 5 ? 0 : 25 + i * 12 },
    });
    T(s, b[1], {
      x: x - 0.05,
      y: base - hh - 0.4,
      w: bw + 0.1,
      h: 0.35,
      fontSize: 14,
      bold: true,
      color: i === 5 ? PRIMARY : TEXT,
      align: 'center',
      lineSpacing: 16,
    });
    T(s, b[0], {
      x: x - 0.1,
      y: base + 0.1,
      w: bw + 0.2,
      h: 0.55,
      fontSize: 9.5,
      color: TEXT,
      align: 'center',
      valign: 'top',
      lineSpacing: 12,
    });
    T(s, b[2], {
      x: x - 0.1,
      y: base + 0.68,
      w: bw + 0.2,
      h: 0.26,
      fontSize: 9,
      color: DIM,
      align: 'center',
      lineSpacing: 11,
    });
  });
  T(s, 'مقياس لوغاريتمي مبسّط — القيم الحقيقية أعلاه', {
    x: 0.6,
    y: 6.85,
    w: 3.2,
    h: 0.26,
    fontSize: 9,
    color: DIM,
    lineSpacing: 11,
  });
  s.addShape('roundRect', {
    x: 0.6,
    y: 1.5,
    w: 2.55,
    h: 0.8,
    rectRadius: 0.09,
    fill: { color: BG2 },
    line: { color: ACCENT, width: 1 },
  });
  T(s, '×10,000', {
    x: 0.6,
    y: 1.56,
    w: 2.55,
    h: 0.42,
    fontSize: 24,
    bold: true,
    color: ACCENT,
    align: 'center',
    lineSpacing: 27,
  });
  T(s, 'نمو النافذة ٢٠١٩ ← ٢٠٢٥', {
    x: 0.7,
    y: 2.0,
    w: 2.35,
    h: 0.23,
    fontSize: 9,
    color: MUTED,
    align: 'center',
    lineSpacing: 11,
  });
  T(s, 'نافذة أكبر لا تلغي هندسة السياق — بل تجعل إدارتها أهم: كل توكن يدخل النافذة هو تكلفة، وضجيج، وفرصة تشتيت.', {
    x: 9.1,
    y: 1.7,
    w: 3.55,
    h: 1.5,
    fontSize: 11.5,
    color: MUTED,
    lineSpacing: 16,
  });
  src(
    s,
    'المصادر: Wikipedia (GPT-2/3/4, Gemini, Llama 4)، OpenAI API docs (GPT-4.1: 1,047,576 توكن) — سبتمبر ٢٠٢٦',
    7.18,
  );
  s.addNotes(
    'النقطة المضادة للحدس: لا تزال أنظمة الوكلاء الحديثة تضغط السياق وتلخصه وتحذفه حتى مع نوافذ ضخمة — لأن التكلفة والزمن وتشتت الانتباه أمور لا تحلّها النافذة الكبيرة وحدها.',
  );
}

// ========== شريحة 9: RAG ==========
{
  const s = pres.addSlide();
  bgFill(s);
  header(
    s,
    'التقنية الأولى: RAG — الاسترجاع المعزّز بالتوليد',
    'أعطِ النموذج «مكتبة مفتوحة» قبل أن تسأله — بدل حشرها في الأمر',
    1,
    9,
  );
  const steps = [
    ['قاعدة المعرفة', 'مستندات مؤسستك: تقارير، عقود، صفحات ويب — تُفهرس مسبقاً'],
    ['الاسترجاع الهجين', 'بحث دلالي (متجهات) + بحث لفظي (BM25) — ويُدمجان بترتيب توافقي'],
    ['تجميع السياق', 'أفضل الفقرات وحدها تُبنى في سياق مضغوط ومقيد بالميزانية'],
    ['النموذج يولّد', 'إجابة مقيّدة بالمصدر — لا يخترع ما ليس في الفقرات'],
    ['إجابة موثّقة', 'كل ادعاء مربوط بمرجعه: صفحة، وثيقة، رابط'],
  ];
  const bw = 2.2,
    bh = 2.5,
    gap2 = 0.22,
    x0 = (W - 5 * bw - 4 * gap2) / 2;
  steps.forEach((st, i) => {
    const x = x0 + (4 - i) * (bw + gap2);
    card(s, x, 2.7, bw, bh, { fill: BG2, lineColor: i === 4 ? PRIMARY : null });
    T(s, asArabicDigits(String(i + 1)), {
      x: x + bw / 2 - 0.3,
      y: 2.9,
      w: 0.6,
      h: 0.5,
      fontSize: 21,
      bold: true,
      color: PRIMARY,
      align: 'center',
      lineSpacing: 24,
    });
    T(s, st[0], {
      x: x + 0.12,
      y: 3.5,
      w: bw - 0.24,
      h: 0.6,
      fontSize: 12.5,
      bold: true,
      align: 'center',
      lineSpacing: 15,
    });
    T(s, st[1], {
      x: x + 0.15,
      y: 4.18,
      w: bw - 0.3,
      h: 0.95,
      fontSize: 9.5,
      color: MUTED,
      align: 'center',
      lineSpacing: 12.5,
    });
    if (i < 4) arrowRTL(s, x, x - gap2, 2.7 + bh / 2, PRIMARY, 1.5);
  });
  T(
    s,
    [
      { text: 'لماذا انتصرت؟  ', options: { bold: true, color: PRIMARY } },
      {
        text: 'معرفة محدّثة + مصادر موثّقة + لا حاجة لإعادة تدريب النموذج — أضحت البنية الافتراضية للأنظمة المؤسسية.',
        options: { color: MUTED },
      },
    ],
    { x: 0.7, y: 1.72, w: 11.95, h: 0.55, fontSize: 12.5, lineSpacing: 17 },
  );
  src(
    s,
    'المصدر: Lewis et al., «Retrieval-Augmented Generation» (arXiv:2005.11401، مايو ٢٠٢٠)؛ الدمج الهجين RRF — وثائق OmniRAG',
  );
  s.addNotes(
    'RAG هي جسر المرحلتين الأولى والثانية: نقل المعرفة من داخل نص الأمر إلى نظام يسترجعها ديناميكياً. وهي التقنية التي يقوم عليها مشروعنا OmniRAG نفسه.',
  );
}

// ========== شريحة 10: الذاكرة ==========
{
  const s = pres.addSlide();
  bgFill(s);
  header(s, 'التقنية الثانية: الذاكرة', 'من محادثة بلا ماضٍ إلى وكيل «يتذكّر» تفضيلاتك وسِجِلّك', 1, 10);
  const layers = [
    { t: 'الذاكرة الفورية', d: 'نافذة الجلسة الحالية: آخر الرسائل والاستدعاءات — تُدار لحظياً', m: 'تُقاس بالرسائل' },
    {
      t: 'الذاكرة قصيرة المدى',
      d: 'تلخيص وضغط تلقائي: الجلسة الطويلة تتحول إلى ملخص يُحمل في السياق',
      m: 'تُقاس بالتوكنات',
    },
    {
      t: 'الذاكرة طويلة المدى',
      d: 'مخازن متجهات دائمة: تفضيلات، حقائق، مشاريع سابقة — تُسترجع عند الحاجة',
      m: 'تُقاس بالأشهر والسنوات',
    },
  ];
  const bw2 = 3.6,
    bh2 = 2.6,
    gap3 = 0.3,
    x0 = (W - 3 * bw2 - 2 * gap3) / 2;
  layers.forEach((L, i) => {
    const x = x0 + (2 - i) * (bw2 + gap3);
    card(s, x, 1.85, bw2, bh2, { fill: BG2 });
    s.addShape('rect', {
      x: x + 0.3,
      y: 2.1,
      w: bw2 - 0.6,
      h: 0.5,
      fill: { color: PRIMARY, transparency: 85 },
      line: { color: PRIMARY, width: 0.75 },
    });
    T(s, L.t, {
      x: x + 0.3,
      y: 2.1,
      w: bw2 - 0.6,
      h: 0.5,
      fontSize: 13.5,
      bold: true,
      align: 'center',
      valign: 'middle',
      lineSpacing: 16,
    });
    T(s, L.d, { x: x + 0.28, y: 2.75, w: bw2 - 0.56, h: 1.3, fontSize: 10.5, color: TEXT, lineSpacing: 14.5 });
    T(s, L.m, {
      x: x + 0.28,
      y: 4.08,
      w: bw2 - 0.56,
      h: 0.28,
      fontSize: 9.5,
      color: PRIMARY,
      align: 'center',
      lineSpacing: 12,
    });
    if (i < 2) arrowRTL(s, x, x - gap3, 1.85 + bh2 / 2, PRIMARY, 1.5);
  });
  card(s, 0.6, 4.95, 12.13, 1.5, { fill: BG3, radius: 0.06 });
  T(s, 'تطبيق واقعي: OpenClaw يتذكّر', {
    x: 0.9,
    y: 5.12,
    w: 11.5,
    h: 0.35,
    fontSize: 12.5,
    bold: true,
    color: PRIMARY,
    lineSpacing: 15,
  });
  T(
    s,
    'ذاكرة OpenClaw تعمل كملفات سِجِل ومهارات على جهازك: يتذكّر محادثاتك، تفضيلاتك، مشاريعك عبر الجلسات والقنوات — واتساب وغيره — ويبني ملفاً شخصياً متراكماً. التحدي المصاحب: خصوصية هذه الذاكرة وأمنها.',
    { x: 0.9, y: 5.5, w: 11.5, h: 0.85, fontSize: 11, color: MUTED, lineSpacing: 15 },
  );
  src(s, 'المصادر: معمارية ذاكرة الوكلاء — LangChain/LangGraph docs؛ ذاكرة OpenClaw الدائمة — GitHub/Wikipedia (2026)');
  s.addNotes(
    'الذاكرة هي ما يحوّل «أداة ذكية» إلى «مساعد شخصي». لاحظوا التحدي: كل طبقة ذاكرة تضيف قيمة، وتضيف في الوقت نفسه مسطّحة هجوم جديدة — سنرى هذا في دراسة حالة OpenClaw.',
  );
}

// ========== شريحة 11: استخدام الأدوات ==========
{
  const s = pres.addSlide();
  bgFill(s);
  header(s, 'التقنية الثالثة: استخدام الأدوات', 'من نموذج «يتكلم فقط» إلى نظام يستدعي بحثاً وشيفرة وAPIs', 1, 11);
  timeline(s, {
    y: 2.55,
    xFrom: 0.9,
    xTo: 12.43,
    labelW: 2.4,
    labelSize: 11.5,
    subSize: 9.5,
    events: [
      { frac: 0.0, t: 'Toolformer', s: 'فبراير ٢٠٢٣ — النموذج يتعلم متى يستدعي أداةً بنفسه', c: PRIMARY },
      { frac: 0.5, t: 'Function Calling', s: 'يونيو ٢٠٢٣ — OpenAI تُقيّس الاستدعاء المُهيكل', c: PRIMARY },
      { frac: 1.0, t: 'MCP — Anthropic', s: 'نوفمبر ٢٠٢٤ — «منفذ USB» موحّد لكل الأدوات', c: ACCENT },
    ],
  });
  const bx = 1.0,
    by = 3.6,
    bw = 11.3,
    bh = 2.5;
  card(s, bx, by, bw, bh, { fill: BG3, radius: 0.07 });
  T(s, 'حلقة استدعاء الأداة (Tool-Use Loop)', {
    x: bx + 0.25,
    y: by + 0.15,
    w: 5.0,
    h: 0.35,
    fontSize: 12.5,
    bold: true,
    color: PRIMARY,
    lineSpacing: 15,
  });
  const seq = [
    ['١ · طلب المستخدم'],
    ['٢ · النموذج يقرر'],
    ['٣ · استدعاء الأداة'],
    ['٤ · ملاحظة النتيجة'],
    ['٥ · إجابة نهائية'],
  ];
  const sw = 1.95,
    sg = 0.35,
    sx0 = bx + (bw - 5 * sw - 4 * sg) / 2;
  seq.forEach((sq, i) => {
    const x = sx0 + (4 - i) * (sw + sg);
    s.addShape('rect', {
      x,
      y: by + 0.72,
      w: sw,
      h: 0.62,
      fill: { color: BG2 },
      line: { color: i === 2 ? ACCENT : PRIMARY, width: i === 2 ? 1.25 : 0.75 },
    });
    T(s, sq[0], {
      x: x + 0.05,
      y: by + 0.72,
      w: sw - 0.1,
      h: 0.62,
      fontSize: 10.5,
      bold: true,
      align: 'center',
      valign: 'middle',
      lineSpacing: 13,
    });
    if (i < 4) arrowRTL(s, x, x - sg, by + 1.03, DIM, 1.25);
  });
  T(
    s,
    [
      { text: 'الأثر:  ', options: { bold: true, color: ACCENT } },
      {
        text: 'النموذج لم يعد مجرّد «مرجع معرفي» يوصف له العالم — بل فاعل يبحث، ينفّذ، ويقرأ نتائج أفعاله. هذه هي البوّابة العملية الأولى لعالم الوكلاء.',
        options: { color: MUTED },
      },
    ],
    { x: bx + 0.25, y: by + 1.62, w: bw - 0.5, h: 0.7, fontSize: 11.5, lineSpacing: 16 },
  );
  src(
    s,
    'المصادر: Schick et al. Toolformer (arXiv:2302.04761)؛ OpenAI Function Calling (Jun 2023)؛ Anthropic MCP (Nov 25, 2024)',
  );
  s.addNotes(
    'MCP لحظة مفصلية: قبلها كانت كل أداة تكامل خاص بمزود النموذج. بعدها أصبحت الأدوات «إضافات» قياسية تعمل مع أي عميل يدعم البروتوكول — مايكروسوفت وGoogle وغيرها تبنّوه خلال ٢٠٢٥.',
  );
}

// ========== شريحة 12: هندسة الحزام — ما هو؟ ==========
{
  const s = pres.addSlide();
  bgFill(s);
  header(s, 'هندسة الحزام: ما هو «الحزام»؟', 'كل ما يحيط بالنموذج ويحدد نجاحه أو فشله — الحزام هو المنتج', 2, 12);
  const cx = 3.3,
    cy = 4.1;
  const rings = [
    { r: 2.15, color: LIGHT },
    { r: 1.68, color: PRIMARY },
    { r: 1.21, color: PRIMARY },
    { r: 0.74, color: ACCENT },
  ];
  rings.forEach((rg, i) => {
    s.addShape('ellipse', {
      x: cx - rg.r,
      y: cy - rg.r,
      w: rg.r * 2,
      h: rg.r * 2,
      fill: { color: i === 3 ? BG2 : BG3 },
      line: { color: rg.color, width: i === 3 ? 1.5 : 0.75, transparency: i === 3 ? 0 : 40 },
    });
  });
  T(s, 'النموذج', {
    x: cx - 0.74,
    y: cy - 0.24,
    w: 1.48,
    h: 0.5,
    fontSize: 13.5,
    bold: true,
    align: 'center',
    valign: 'middle',
    lineSpacing: 16,
  });
  T(s, 'حلقة الوكيل', {
    x: cx - 0.85,
    y: cy - 1.06,
    w: 1.7,
    h: 0.28,
    fontSize: 10,
    bold: true,
    color: ACCENT,
    align: 'center',
    lineSpacing: 12,
  });
  T(s, 'واجهة الأدوات', {
    x: cx - 0.85,
    y: cy - 1.58,
    w: 1.7,
    h: 0.28,
    fontSize: 10,
    color: PRIMARY,
    align: 'center',
    lineSpacing: 12,
  });
  T(s, 'إدارة السياق', {
    x: cx - 0.85,
    y: cy - 2.08,
    w: 1.7,
    h: 0.28,
    fontSize: 10,
    color: PRIMARY,
    align: 'center',
    lineSpacing: 12,
  });
  T(s, 'الصلاحيات والتحكم', {
    x: cx - 1.1,
    y: cy - 2.55,
    w: 2.2,
    h: 0.28,
    fontSize: 10,
    color: LIGHT,
    align: 'center',
    lineSpacing: 12,
  });
  T(s, 'النموذج في المركز — والحزام يحيط به من كل جانب', {
    x: 0.7,
    y: 6.55,
    w: 5.2,
    h: 0.3,
    fontSize: 10.5,
    color: MUTED,
    align: 'center',
    lineSpacing: 13,
  });
  card(s, 6.2, 1.6, 6.5, 5.0, { fill: BG2 });
  T(s, 'تعريف', { x: 6.5, y: 1.85, w: 5.9, h: 0.35, fontSize: 13, bold: true, color: LIGHT, lineSpacing: 16 });
  T(
    s,
    '«هندسة الحزام هي تصميم السقالة المحيطة بوكيل ذكاء اصطناعي — إيصال السياق، واجهات الأدوات، مخططات العمل، حلقات التحقق، أنظمة الذاكرة، والصناديق المعزولة — وهي ما يحدد نجاح الوكيل أو فشله».',
    { x: 6.5, y: 2.2, w: 5.9, h: 1.3, fontSize: 12, color: TEXT, lineSpacing: 17 },
  );
  T(s, '— OpenAI، منشور «Harness Engineering» الرسمي (فبراير ٢٠٢٦)', {
    x: 6.5,
    y: 3.5,
    w: 5.9,
    h: 0.3,
    fontSize: 10.5,
    color: ACCENT,
    lineSpacing: 13,
  });
  const comps = [
    ['حلقة الوكيل', 'يفكّر → يفعل → يلاحظ → يكرّر حتى إنجاز المهمة'],
    ['واجهة الأدوات', 'MCP وأدوات مخصصة: بحث، شيفرة، ملفات، متصفح'],
    ['إدارة السياق والضغط', 'ملء النافذة بالصحيح، ثم ضغطها عند التضخم'],
    ['الصلاحيات والتحكم', 'أبواب موافقة، عزل، حدود إنفاق — «الحزام» الأمني'],
  ];
  comps.forEach((c2, i) => {
    const yy = 4.05 + i * 0.62;
    slide_dot(s, i === 3 ? LIGHT : i === 0 ? ACCENT : PRIMARY, 12.35, yy + 0.09);
    T(
      s,
      [
        { text: c2[0] + '  —  ', options: { bold: true, color: TEXT } },
        { text: c2[1], options: { color: MUTED } },
      ],
      { x: 6.5, y: yy, w: 5.75, h: 0.55, fontSize: 10.5, lineSpacing: 14 },
    );
  });
  src(
    s,
    'المصادر: OpenAI «Harness Engineering» (Feb 2026)؛ SWE-agent «Agent-Computer Interfaces» (Princeton, 2024)؛ awesome-harness-engineering (Mar 2026)',
  );
  s.addNotes(
    'أفضل تعريف مختصر: النموذج هو المحرك، والحزام هو السيارة بأكملها — من الدواسة إلى الفرامل إلى حزام الأمان. مصطلح «الوكيل ليس النموذج» جوهر هذه المرحلة.',
  );
}

// ========== شريحة 13: تطوّر أُطُر الوكلاء ==========
{
  const s = pres.addSlide();
  bgFill(s);
  header(s, 'تطوّر أُطُر الوكلاء — خمس محطات', 'من أول حلقة وكيل مفتوحة المصدر إلى حزام مفتوح يعيش على جهازك', 2, 13);
  const stages = [
    {
      t: 'AutoGPT',
      d: '٢٠٢٣',
      n: 'أول عرض حي للوكيل المستقل: هدفٌ → تخطيط → تنفيذ — إثبات مفهوم مرتجف',
      tag: 'إثبات المفهوم',
    },
    {
      t: 'أُطر السلاسل',
      d: '٢٠٢٣ – ٢٠٢٤',
      n: 'LangChain وLlamaIndex: مكوّنات جاهزة للسلاسل والأدوات — لكن انضمام منخفض',
      tag: 'مكوّنات قابلة للتركيب',
    },
    {
      t: 'تقييس الأدوات',
      d: '٢٠٢٤ – ٢٠٢٥',
      n: 'MCP وACP: أدوات موحّدة تعمل مع أي عميل — انفجار منظومة الأدوات',
      tag: 'معايير مفتوحة',
    },
    {
      t: 'وكلاء الطرفية',
      d: '٢٠٢٥',
      n: 'Claude Code (فبراير)، Codex CLI (أبريل)، Gemini CLI (يونيو): الحزام نفسه يصبح منتجاً',
      tag: 'الحزام منتجاً',
    },
    {
      t: 'الحزام المفتوح',
      d: '٢٠٢٦',
      n: 'OpenClaw: مساعد مفتوح المصدر يعمل على جهازك ويتقاسمك قنواتك اليومية',
      tag: 'ملكية المستخدم',
    },
  ];
  const bw2 = 2.35,
    gap2 = 0.13,
    x0 = (W - 5 * bw2 - 4 * gap2) / 2,
    bh2 = 3.5,
    y0 = 2.0;
  stages.forEach((st, i) => {
    const x = x0 + (4 - i) * (bw2 + gap2);
    const hot = i === 4;
    card(s, x, y0, bw2, bh2, { fill: BG2, lineColor: hot ? LIGHT : null });
    s.addShape('roundRect', {
      x: x + bw2 / 2 - 0.55,
      y: y0 + 0.22,
      w: 1.1,
      h: 0.4,
      rectRadius: 0.05,
      fill: { color: hot ? LIGHT : PRIMARY, transparency: 85 },
    });
    T(s, st.d, {
      x: x + bw2 / 2 - 0.55,
      y: y0 + 0.22,
      w: 1.1,
      h: 0.4,
      fontSize: 9.5,
      bold: true,
      color: hot ? LIGHT : PRIMARY,
      align: 'center',
      valign: 'middle',
      lineSpacing: 11,
    });
    T(s, st.t, {
      x: x + 0.1,
      y: y0 + 0.75,
      w: bw2 - 0.2,
      h: 0.65,
      fontSize: 13.5,
      bold: true,
      align: 'center',
      lineSpacing: 16,
    });
    T(s, st.n, {
      x: x + 0.16,
      y: y0 + 1.42,
      w: bw2 - 0.32,
      h: 1.6,
      fontSize: 9.5,
      color: MUTED,
      align: 'center',
      lineSpacing: 13,
    });
    T(s, st.tag, {
      x: x + 0.1,
      y: y0 + 3.05,
      w: bw2 - 0.2,
      h: 0.32,
      fontSize: 9.5,
      bold: true,
      color: hot ? LIGHT : PRIMARY,
      align: 'center',
      lineSpacing: 12,
    });
    if (i < 4) arrowRTL(s, x, x - gap2, y0 + bh2 / 2, DIM, 1.25);
  });
  card(s, 0.6, 5.85, 12.13, 0.95, { fill: BG3, radius: 0.06 });
  T(
    s,
    [
      { text: 'القاسم المشترك عبر المحطات الخمس:  ', options: { bold: true, color: LIGHT } },
      {
        text: 'كل جيل نقل «الوكالة» خطوة نحو المستخدم — من مختبرات المطورين (٢٠٢٣) إلى الطرفية (٢٠٢٥) إلى جيب المستخدم وقنواته اليومية (٢٠٢٦).',
        options: { color: TEXT },
      },
    ],
    { x: 0.85, y: 5.85, w: 11.6, h: 0.95, fontSize: 12, valign: 'middle', lineSpacing: 16 },
  );
  src(
    s,
    'المصادر: AutoGPT GitHub؛ LangChain docs؛ Anthropic (Nov 2024)؛ Zed ACP (Jun 2025)؛ إعلانات ٢٠٢٥؛ Wikipedia/OpenClaw (2026)',
    7.1,
  );
  s.addNotes(
    'خمس محطات في ثلاث سنوات فقط. لاحظوا تسارع الإيقاع: بين أول إطار وبين تقييس الأدوات عامان، وبين التقييس وبين حزام على جهاز المستخدم أقل من عام.',
  );
}

// ========== شريحة 14: دراسة حالة — AutoGPT ==========
{
  const s = pres.addSlide();
  bgFill(s);
  header(s, 'دراسة حالة (١): AutoGPT', 'مارس ٢٠٢٣ — أول وكيل مستقل يصل إلى الجمهور', 2, 14);
  card(s, 9.05, 1.6, 3.68, 5.15, { fill: BG2, lineColor: ACCENT });
  T(s, '١٨٧ ألف', {
    x: 9.05,
    y: 1.95,
    w: 3.68,
    h: 0.8,
    fontSize: 40,
    bold: true,
    color: ACCENT,
    align: 'center',
    lineSpacing: 44,
  });
  T(s, 'نجمة على GitHub — سبتمبر ٢٠٢٦', {
    x: 9.25,
    y: 2.8,
    w: 3.28,
    h: 0.35,
    fontSize: 10.5,
    color: MUTED,
    align: 'center',
    lineSpacing: 13,
  });
  T(s, 'أعلى مستودعات الترند بعد إطلاقه أسابيع', {
    x: 9.25,
    y: 3.2,
    w: 3.28,
    h: 0.55,
    fontSize: 10,
    color: DIM,
    align: 'center',
    lineSpacing: 12.5,
  });
  T(
    s,
    '«هدف واحد بلا أوامر خطوة بخطوة: خطّط، فكّر، نفّذ، انتقد نفسك، كرّر» — تواران بروس ريتشاردز (Significant Gravitas)، مارس ٢٠٢٣',
    { x: 9.25, y: 4.3, w: 3.28, h: 1.6, fontSize: 10.5, color: MUTED, lineSpacing: 14 },
  );
  card(s, 0.6, 1.6, 8.2, 5.15, { fill: BG3, radius: 0.07 });
  T(s, 'حلقة الوكيل الأولى كما نفّذها AutoGPT', {
    x: 0.9,
    y: 1.8,
    w: 7.6,
    h: 0.35,
    fontSize: 12.5,
    bold: true,
    color: PRIMARY,
    lineSpacing: 15,
  });
  const loop = [
    ['هدف المستخدم', '«ابحث عن أفضل الصفقات» — سطر واحد'],
    ['تخطيط وتفكير', 'تفكيك الهدف إلى مهام فرعية متسلسلة (حتى ٥)'],
    ['تنفيذ بأدوات', 'بحث ويب، ملفات، «ذاكرة» ملفات قصيرة'],
    ['نقد ذاتي', 'النموذج يقيّم خرجه ويصحّح مساره'],
  ];
  loop.forEach((r, i) => {
    const yy = 2.3 + i * 0.72;
    const x = 5.3 - (i % 2) * 0.5;
    s.addShape('rect', {
      x,
      y: yy,
      w: 3.3,
      h: 0.62,
      fill: { color: BG2 },
      line: { color: i === 3 ? ACCENT : PRIMARY, width: 0.75 },
    });
    T(s, r[0], { x: x + 0.15, y: yy + 0.04, w: 3.0, h: 0.3, fontSize: 11, bold: true, lineSpacing: 13 });
    T(s, r[1], { x: x + 0.15, y: yy + 0.33, w: 3.0, h: 0.28, fontSize: 9, color: MUTED, lineSpacing: 11 });
    if (i < 3) arrowDown(s, x + 1.65, yy + 0.62, 0.1, DIM);
  });
  T(s, '↺', { x: 4.25, y: 3.1, w: 0.5, h: 0.5, fontSize: 24, color: ACCENT, align: 'center', lineSpacing: 26 });
  T(s, 'تكرار ذاتي حتى «اكتمال الهدف» أو استنفاد الميزانية', {
    x: 0.95,
    y: 5.22,
    w: 7.5,
    h: 0.28,
    fontSize: 10,
    color: DIM,
    align: 'center',
    lineSpacing: 12,
  });
  T(s, 'لماذا توقفت التجربة؟', {
    x: 0.9,
    y: 5.6,
    w: 3.0,
    h: 0.3,
    fontSize: 11.5,
    bold: true,
    color: ACCENT,
    lineSpacing: 14,
  });
  const lims = [
    'حلقات لا نهائية: ينسى ما فعله — نافذة السياق المحدودة أطاحت به',
    'تكلفة: كل خطوة استدعاء API مكتمل — فاتورة تصاعدية',
    'موثوقية: يثق بنقد ذاته — خطأ واحد يتراكم عبر السلسلة',
  ];
  lims.forEach((l, i) =>
    T(s, '– ' + l, { x: 0.9, y: 5.92 + i * 0.26, w: 7.55, h: 0.24, fontSize: 9.5, color: MUTED, lineSpacing: 12 }),
  );
  src(
    s,
    'المصادر: Wikipedia/AutoGPT (Mar 30, 2023)؛ GitHub API — Significant-Gravitas/AutoGPT (سبتمبر ٢٠٢٦)؛ ملاحظات Karpathy عن الحلقات',
    7.14,
  );
  s.addNotes(
    'AutoGPT برهن أن الفكرة ممكنة وأن التشغيل اليومي صعب — قيمته التاريخية أنه فتح الباب: كل الأنظمة اللاحقة كانت إجابات على إخفاقاته الثلاثة: الذاكرة، التكلفة، والموثوقية.',
  );
}

// ========== شريحة 15: دراسة حالة — OpenClaw + ACP ==========
{
  const s = pres.addSlide();
  bgFill(s);
  header(
    s,
    'دراسة حالة (٢): OpenClaw و ACP',
    '٢٠٢٦: الحزام ينتقل إلى أجهزة المستخدمين، والبروتوكولات توحّد الوكلاء',
    2,
    15,
  );
  card(s, 6.85, 1.6, 5.88, 4.95, { fill: BG2, lineColor: LIGHT });
  T(s, 'OpenClaw — المساعد الشخصي المفتوح', {
    x: 7.1,
    y: 1.8,
    w: 5.35,
    h: 0.4,
    fontSize: 14,
    bold: true,
    color: LIGHT,
    lineSpacing: 17,
  });
  T(s, 'بيتر شتاينرغر — نوفمبر ٢٠٢٥ / الاسم الحالي منذ ٣٠ يناير ٢٠٢٦', {
    x: 7.1,
    y: 2.2,
    w: 5.35,
    h: 0.32,
    fontSize: 9.5,
    color: MUTED,
    lineSpacing: 12,
  });
  const oc = [
    'يعمل على جهازك أنت — لا سحابة وسيطة: macOS / Linux / Windows',
    'يلتقيك في قنواتك: واتساب، تيليجرام، ديسكورد، إشارة',
    'ذاكرة دائمة ومهارات SKILL.md قابلة للتوسعة شعبياً',
    '388,737 نجمة على GitHub (سبتمبر ٢٠٢٦) — أسرع نمو بتاريخ المنصة',
  ];
  oc.forEach((t, i) => {
    const yy = 2.75 + i * 0.56;
    slide_dot(s, LIGHT, 12.2, yy + 0.08);
    T(s, t, { x: 7.1, y: yy, w: 5.0, h: 0.5, fontSize: 10.5, color: TEXT, lineSpacing: 14 });
  });
  card(s, 7.1, 5.1, 5.35, 1.15, { fill: BG3, radius: 0.05 });
  T(
    s,
    [
      { text: 'جرس الإنذار:  ', options: { bold: true, color: ACCENT } },
      {
        text: 'حقن أوامر عبر المهارات، Sandbox معطّل افتراضياً، مخزن أسرار غير مشفّر — Cisco وMicrosoft حذّرا، والصين قيّدته رسمياً (مارس ٢٠٢٦).',
        options: { color: MUTED },
      },
    ],
    { x: 7.3, y: 5.1, w: 4.95, h: 1.15, fontSize: 10.5, valign: 'middle', lineSpacing: 14 },
  );
  card(s, 0.6, 1.6, 6.0, 4.95, { fill: BG2 });
  T(s, 'ACP — بروتوكول عميل الوكيل', {
    x: 0.85,
    y: 1.8,
    w: 5.5,
    h: 0.4,
    fontSize: 14,
    bold: true,
    color: PRIMARY,
    lineSpacing: 17,
  });
  T(s, 'Zed Industries — يونيو ٢٠٢٥ · مفتوح المصدر (Apache 2.0)', {
    x: 0.85,
    y: 2.2,
    w: 5.5,
    h: 0.32,
    fontSize: 9.5,
    color: MUTED,
    lineSpacing: 12,
  });
  const acp = [
    'المهمة: معيار موحّد يربط «أي محرر» بـ«أي وكيل برمجي»',
    'JSON-RPC: حوار عادي بين المحرر والوكيل — محادثة، عمليات ملفات، إذن',
    'حوار غير متزامن بتعريفات صريحة — لا «قارئ أرقام سحري»',
    'MCP للأدوات · ACP للعملاء: قطعتان متكاملتان في منظومة واحدة',
  ];
  acp.forEach((t, i) => {
    const yy = 2.75 + i * 0.56;
    slide_dot(s, PRIMARY, 6.15, yy + 0.08);
    T(s, t, { x: 0.85, y: yy, w: 5.15, h: 0.5, fontSize: 10.5, color: TEXT, lineSpacing: 14 });
  });
  card(s, 0.85, 5.1, 5.5, 1.15, { fill: BG3, radius: 0.05 });
  T(
    s,
    [
      { text: 'لماذا يهم؟  ', options: { bold: true, color: PRIMARY } },
      {
        text: 'تقسيم العمل الواضح يقطع الجدل: MCP يوصل الوكيل بالأدوات، وACP يوصل العميل (محررك) بالوكيل.',
        options: { color: MUTED },
      },
    ],
    { x: 1.05, y: 5.1, w: 5.1, h: 1.15, fontSize: 10.5, valign: 'middle', lineSpacing: 14 },
  );
  src(
    s,
    'المصادر: Wikipedia/OpenClaw (Sep 2026)؛ GitHub API openclaw/openclaw (388,737 نجمة)؛ Zed Industries/ACP — سبتمبر ٢٠٢٦',
    7.14,
  );
  s.addNotes(
    'الرسالة: النجوم الهائلة تعكس شهية هائلة للحزام المفتوح — لكنها تكشف أن الأمان جزء من الهندسة لا إضافة لاحقة. وACP يمثل الموجة التالية: تقييس واجهة «العميل» بعد تقييس الأدوات.',
  );
}

// ========== شريحة 16: مصفوفة المقارنة ==========
{
  const s = pres.addSlide();
  bgFill(s);
  header(
    s,
    'مصفوفة المقارنة: المراحل الثلاث وجهاً لوجه',
    'ما نبرمجه، وما نكسبه، وما يحدّنا — في جدول واحد',
    undefined,
    16,
  );
  const rows = [
    ['الوحدة الأساسية', 'نصّ الأمر', 'نافذة السياق', 'الحزام (النظام المحيط)'],
    ['دور النموذج', 'مُختبَر بالصياغة', 'معالج يستهلك مدخلات مُدارة', 'محرك داخل هيكل مصمم'],
    ['ما نبرمجه', 'كيف نَسأل', 'ماذا نُدخل', 'ما الذي يُحيط بالنموذج'],
    [
      'التقنيات والأمثلة',
      'Zero/Few-shot · CoT · ReAct · الأدوار',
      'RAG · الذاكرة · Tool Use · MCP',
      'حلقة الوكيل · الصلاحيات · المهارات',
    ],
    ['حدود المرحلة', 'لا ذاكرة ولا أدوات ولا تحديث', 'إدارة التكلفة والضجيج والحالة', 'الأمان والثقة والتحكم'],
    ['العصر الزمني', '٢٠٢٠ – ٢٠٢٣', '٢٠٢٤ – ٢٠٢٥', '٢٠٢٥ – ٢٠٢٦'],
  ];
  const colW = [2.5, 3.21, 3.21, 3.21];
  const rowH = [0.62, 0.62, 0.62, 0.82, 0.62, 0.52];
  const x0 = 0.6,
    y0 = 1.75;
  const heads = [
    { t: 'هندسة الأوامر', c: ACCENT },
    { t: 'هندسة السياق', c: PRIMARY },
    { t: 'هندسة الحزام', c: LIGHT },
  ];
  const colX = [x0 + colW[0] + 2 * colW[1], x0 + colW[0] + 1 * colW[1], x0 + colW[0]];
  heads.forEach((h2, i) => {
    s.addShape('rect', {
      x: colX[i],
      y: y0,
      w: colW[1] - 0.06,
      h: 0.5,
      fill: { color: h2.c, transparency: 85 },
      line: { color: h2.c, width: 1 },
    });
    T(s, h2.t, {
      x: colX[i],
      y: y0,
      w: colW[1] - 0.06,
      h: 0.5,
      fontSize: 13,
      bold: true,
      color: h2.c,
      align: 'center',
      valign: 'middle',
      lineSpacing: 15,
    });
  });
  s.addShape('rect', { x: x0, y: y0, w: colW[0] - 0.06, h: 0.5, fill: { color: BG3 } });
  T(s, 'وجه المقارنة', {
    x: x0,
    y: y0,
    w: colW[0] - 0.06,
    h: 0.5,
    fontSize: 12,
    bold: true,
    color: MUTED,
    align: 'center',
    valign: 'middle',
    lineSpacing: 14,
  });
  let yy = y0 + 0.58;
  rows.forEach((r, ri) => {
    s.addShape('rect', { x: x0, y: yy, w: colW[0] - 0.06, h: rowH[ri] - 0.06, fill: { color: BG2 } });
    T(s, r[0], {
      x: x0 + 0.15,
      y: yy,
      w: colW[0] - 0.36,
      h: rowH[ri] - 0.06,
      fontSize: 11,
      bold: true,
      color: TEXT,
      valign: 'middle',
      lineSpacing: 14,
    });
    for (let i = 0; i < 3; i++) {
      const hot = ri === 5;
      s.addShape('rect', {
        x: colX[i],
        y: yy,
        w: colW[1] - 0.06,
        h: rowH[ri] - 0.06,
        fill: { color: hot ? heads[i].c : BG2, transparency: hot ? 88 : 0 },
        line: { color: DIM, width: 0.5 },
      });
      T(s, r[1 + i], {
        x: colX[i] + 0.12,
        y: yy,
        w: colW[1] - 0.3,
        h: rowH[ri] - 0.06,
        fontSize: 10.5,
        color: hot ? heads[i].c : TEXT,
        align: 'center',
        valign: 'middle',
        lineSpacing: 13.5,
      });
    }
    yy += rowH[ri];
  });
  src(s, 'خلاصة تحليلية للعرض — الأطر الزمنية تقريبية والتداخل بين المراحل طبيعي', 7.12);
  s.addNotes(
    'استخدموا الصف الأخير (حدود كل مرحلة) كمفتاح نقاش: كل حدّ في عمود ما هو باب الدخول للعمود التالي. لا مرحلة «تغلبت» — بل تراكمت.',
  );
}

// ========== شريحة 17: الخاتمة ==========
{
  const s = pres.addSlide();
  bgFill(s);
  nodeGrid(s, {
    pts: [
      [1.2, 1.3],
      [2.4, 2.6],
      [1.1, 3.9],
      [2.5, 5.2],
      [1.5, 6.5],
      [3.5, 1.0],
      [3.8, 3.4],
      [3.1, 5.9],
      [12.1, 1.1],
      [11.2, 2.5],
      [12.4, 3.8],
      [11.1, 5.1],
      [12.0, 6.4],
      [10.2, 1.5],
      [10.0, 3.5],
      [10.5, 6.0],
      [5.2, 6.9],
      [8.3, 6.95],
    ],
    lines: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [5, 6],
      [6, 7],
      [8, 9],
      [9, 10],
      [10, 11],
      [11, 12],
      [13, 14],
      [14, 15],
      [5, 13],
      [16, 7],
      [17, 15],
      [0, 5],
      [8, 13],
    ],
  });
  T(s, 'الخلاصة', {
    x: 1.67,
    y: 1.35,
    w: 10,
    h: 0.45,
    fontSize: 16,
    align: 'center',
    color: ACCENT,
    charSpacing: 2,
    lineSpacing: 19,
  });
  T(s, 'الوكيل ليس النموذج — الوكيل هو النظام كله', {
    x: 0.77,
    y: 1.85,
    w: 11.79,
    h: 0.62,
    fontSize: 36,
    bold: true,
    align: 'center',
    lineSpacing: 42,
  });
  T(s, 'ثلاث موجات ودرس واحد: ما نبرمجه يتعمّق في النظام مع كل موجة', {
    x: 2.27,
    y: 2.72,
    w: 8.8,
    h: 0.45,
    fontSize: 14,
    align: 'center',
    color: MUTED,
    lineSpacing: 18,
  });
  const takes = [
    {
      t: 'المرحلة ١ · هندسة الأوامر',
      d: 'أتقنّا السؤال — واكتشفنا أن سؤالاً مثالياً لا يصنع ذاكرة ولا أدوات',
      c: ACCENT,
    },
    {
      t: 'المرحلة ٢ · هندسة السياق',
      d: 'أدركنا أن الميزة في المدخلات — فبنينا RAG وذاكرة وأدوات موحّدة عبر MCP',
      c: PRIMARY,
    },
    {
      t: 'المرحلة ٣ · هندسة الحزام',
      d: 'التنافس اليوم على السقالة كلها: الحلقة، الصلاحيات، الذاكرة، الأمان — الحزام هو المنتج',
      c: LIGHT,
    },
  ];
  takes.forEach((tk, i) => {
    const w2 = 3.75,
      gap2 = 0.29,
      x = (W - 3 * w2 - 2 * gap2) / 2 + (2 - i) * (w2 + gap2);
    card(s, x, 3.85, w2, 1.9, { fill: BG2 });
    T(s, tk.t, {
      x: x + 0.22,
      y: 4.05,
      w: w2 - 0.44,
      h: 0.35,
      fontSize: 12.5,
      bold: true,
      color: tk.c,
      lineSpacing: 15,
    });
    T(s, tk.d, { x: x + 0.22, y: 4.45, w: w2 - 0.44, h: 1.2, fontSize: 10.5, color: TEXT, lineSpacing: 14 });
    if (i < 2) arrowRTL(s, x, x - gap2, 4.8, DIM, 1.25);
  });
  T(s, 'شكراً لكم — أسئلتكم موضع ترحيب', {
    x: 4.17,
    y: 6.25,
    w: 5,
    h: 0.4,
    fontSize: 15,
    bold: true,
    align: 'center',
    color: ACCENT,
    lineSpacing: 18,
  });
  T(s, 'إعداد: فريق OmniRAG — سبتمبر ٢٠٢٦', {
    x: 4.17,
    y: 6.75,
    w: 5,
    h: 0.3,
    fontSize: 10.5,
    align: 'center',
    color: DIM,
    lineSpacing: 13,
  });
  s.addNotes(
    'اختموا بالرسالة الجوهرية: كل موجة لم تُلغِ سابقتها — الأمر الجيد ما زال ضرورياً داخل الحزام، والسياق ما زال قلب الوكيل. ما تغيّر هو «أين يقضي المهندس وقته». افتحوا النقاش: أي حدود المرحلة الثالثة ستُغلق أولاً — الأمان أم الثقة؟',
  );
}

// ---------- التوليد ----------
pres
  .writeFile({ fileName: path.join(__dirname, 'Evolution-of-AI-Agents-AR.pptx') })
  .then(() => console.log('OK: Evolution-of-AI-Agents-AR.pptx'))
  .catch((e) => {
    console.error('FAIL:', e);
    process.exit(1);
  });
