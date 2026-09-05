# مكتبة برومبتات الذكاء الاصطناعي — OmniRAG AI Media Prompts

مكتبة متكاملة من البرومبتات الجاهزة لتوليد صور وفيديوهات إعلانية لمنصة OmniRAG. مصممة لتعمل مع أحدث مولدات الصور (Midjourney v7، Imagen 3، Flux 1.1 Pro، DALL-E 3) ومولدات الفيديو (Sora، Veo 3، Runway Gen-4، Kling 2).

> **قاعدة ذهبية:** البرومبتات بالإنجليزية تُنتج نتائج أدق وأثبت في كل الأدوات حالياً. استخدم الترجمة العربية لفهم المحتوى، والنسخة الإنجليزية للتوليد الفعلي.

---

## 1. الهوية البصرية الموحّدة (Brand Visual System)

قبل أي برومبت، ثبّت هذه المتغيرات لتضمن اتساق كل المواد:

| العنصر               | القيمة                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| **الألوان الأساسية** | أزرق حبر عميق `#0B1F3A`، سماوي تقني `#00D4FF`، أبيض ثلجي `#F5F7FA`                              |
| **اللون الثانوي**    | ذهبي مطفأ `#C9A959` (للّمسات الفاخرة)                                                           |
| **النمط العام**      | Futuristic minimalism — خطوط نظيفة، شفافية زجاجية (glassmorphism)، عمق ثلاثي الأبعاد خفيف       |
| **الشخصية البصرية**  | التقاء المعرفة العربية التقليدية (مخطوطات، خط عربي) بالتقنية الحديثة (شبكات عصبية، تدفق بيانات) |
| **استبعادات دائمة**  | لا ستوك جنريكي، لا روبوتات كليشيهية، لا عيون زرقاء متوهجة (AI clichés)                          |

**برومبت الهوية الأساسية (يُدمج في كل صورة):**

```
Style guide: futuristic minimalism, deep ink blue (#0B1F3A) background,
cyan tech accents (#00D4FF), frosted glass surfaces, soft volumetric lighting,
high-end enterprise SaaS aesthetic, clean geometric composition, 8K render quality
```

---

## 2. برومبتات الصور الإعلانية (Static Ads)

### 2.1 الصورة الرئيسية للإطلاق — «بطل الهوية» (Hero Shot)

```
A majestic cinematic still: an ancient Arabic manuscript transforming into
streams of glowing cyan light particles that flow upward and crystallize into
a modern holographic knowledge graph above it. Deep ink blue void background.
Golden Arabic calligraphy fragments float mid-transformation. A subtle
spherical vector field visualization glows at the center connecting
documents to an AI core. Photorealistic with subtle 3D render elements.
Mood: knowledge awakening. 16:9, --ar 16:9 --v 7 --style raw
```

**الفكرة:** مخطوط عربي قديم يتحول إلى رسم بياني معرفي متوهج — يربط التراث المعرفي العربي بالذكاء الاصطناعي الحديث.

### 2.2 إعلان «الاستشهادات الموثوقة»

```
Close-up macro shot: a digital document page with glowing highlighted
passages, each highlight connected by a thin luminous cyan line to a
floating citation card showing a page number and confidence score.
Split-screen feel: left side classical paper texture, right side dark
holographic interface. Depth of field on the citation card.
--ar 1:1 --style raw
```

**الاستخدام:** LinkedIn + X — يشرح ميزة الاستشهادات صفحة-بصفحة بصرياً دون كلمة واحدة.

### 2.3 إعلان «البحث الهجين RRF»

```
Isometric 3D illustration: two rivers of light (one electric cyan
representing "vector search", one warm amber representing "lexical search")
flowing from opposite sides and merging into a single powerful beam through
a prismatic fusion core labeled abstractly with concentric rings.
Below the fusion point, search results appear as floating ranked cards
with descending glow intensity. Dark navy background, minimal grid floor.
--ar 16:9 --v 7
```

**الفكرة:** نهران ضوئيان (متجهي + معجمي) يندمجان عبر منشور — ترميز بصري أنيق لخوارزمية RRF.

### 2.4 إعلان «الأمان المؤسسي»

```
Cinematic shot: a transparent crystalline shield hovering over a network
of document icons, repelling dark fragmented arrows (labeled only visually
with broken code symbols). The shield has subtle hexagonal microstructure.
Background: enterprise server room bokeh in deep blue.
Light refraction through the shield creates rainbow edges.
Mood: impenetrable elegance. --ar 1:1 --style raw
```

### 2.5 إعلان «تعدد المستأجرين»

```
Aerial view of an elegant futuristic cityscape: multiple illuminated towers,
each a different soft pastel color, all connected to a single glowing
central infrastructure base. Each tower is visually isolated by
translucent glass walls. One tower is highlighted with a zoom ring.
Style: architectural viz meets UI design. --ar 16:9 --v 7
```

**الفكرة:** أبراج معزولة بصرياً لكنها تتشارك بنية تحتية واحدة — يشرح Multi-Tenancy في ثانية.

### 2.6 إعلان «دعم العربية الأصيل»

```
Elegant split composition: left half shows fluid Arabic calligraphy of
the word «معرفة» (knowledge) being written by light itself; right half
shows the same light particles forming neural network nodes.
The calligraphy strokes seamlessly become circuit traces.
Warm gold and deep blue palette. Minimal, museum-grade aesthetic.
--ar 1:1 --style raw
```

### 2.7 غلاف Open Graph للمشاركة (1200×630)

```
Wide banner: abstract geometric composition of overlapping translucent
panels representing UI windows, with one panel clearly showing a chat
interface with Arabic text bubbles and glowing citation markers.
Deep blue gradient background with subtle grid. Product name space
reserved on the left third (negative space for text overlay).
--ar 1200:630 --style raw
```

---

## 3. برومبتات الفيديو الإعلاني (Motion Ads)

### 3.1 الفيديو الرئيسي — إعلان الإطلاق (30 ثانية)

**منصة التوليد الموصى بها:** Veo 3 أو Sora (بجودة sinematic).

```
A 30-second cinematic product film, Arabic tech aesthetic:
[0-5s] Extreme close-up of aged Arabic manuscript pages, dust particles
       floating in golden window light. Camera slowly pushes in.
[5-10s] The ink letters begin to glow cyan, lift off the page, and
        transform into luminous data particles streaming upward.
[10-15s] The particles assemble into a holographic modern dashboard —
         a chat interface with Arabic messages and glowing source citations
         that pulse when the camera passes them.
[15-20s] Rapid montage: documents uploading, a hybrid search visualization
         (two light streams fusing), a shield deflecting red threat
         fragments, multiple tenant towers lighting up.
[20-25s] Pull back to reveal the whole system as an elegant glowing orb
         held in two hands — control and ownership.
[25-30s] Orb dissolves to clean product logo on deep ink blue background.
         End card space for tagline.
Style: premium tech commercial, shallow depth of field, warm-to-cold
lighting transition, 24fps cinematic motion blur.
```

### 3.2 مقطع «كيف يعمل RAG عندنا» — 45 ثانية تثقيفي (TikTok/Reels)

```
Vertical 9:16 educational motion graphic, dark mode UI aesthetic:
[0-3s] Hook frame: oversized bold question text placeholder in Arabic
       with pulsing cursor. Background: blurred code.
[3-10s] A user query bubble flies in, splits into two paths:
        Path A (cyan) — geometric vectors orbiting a neural sphere.
        Path B (amber) — alphabetical index cards flipping rapidly.
[10-20s] Both streams hit a circular fusion engine; rank bars animate
         reordering results; the top result card enlarges with a
         citation badge appearing.
[20-30s] The answer text types out with inline citation markers
         glowing softly.
[30-40s] Security layer: transparent shield wraps the pipeline;
         a malicious prompt fragment bounces off it showing a brief
         "blocked" glyph.
[40-45s] End frame: system diagram simplified to 3 icons + logo,
         subtle "learn more" arrow pulsing.
Style: clean kinetic typography, smooth easing, particle microdetails,
professional motion design language.
```

### 3.3 فيديو «يوم مهندس يستخدم OmniRAG» — 60 ثانية (YouTube/LinkedIn)

```
60-second narrative product video, human-centered, realistic style:
[0-8s] Morning light. An engineer at a minimalist desk opens a laptop;
       screen glows with a calm dark-blue dashboard (blurred to feel
       like real software, not generic UI).
[8-15s] Hands upload a stack of PDF reports; a progress ring completes
        with a satisfying micro-animation and soft chime feel (visual only).
[15-25s] The engineer types a complex Arabic question; the camera
         orbit-reveals the answer streaming in with citations
         auto-attaching like sticky notes of light.
[25-35s] Over-the-shoulder shot: clicking a citation opens the exact
         source page, highlight sweeping over the relevant paragraph.
[35-45s] Quick cuts: settings panel with model selection, team members
         joining with role badges, API key creation with one click.
[45-55s] The engineer leans back, satisfied. Screen reflection shows
         the system humming — sync jobs finishing, health dashboard green.
[55-60s] Logo + minimal end card.
Style: warm natural light, shallow depth of field, authentic office
atmosphere, no sci-fi holograms — grounded realism.
```

### 3.4 فيديو «الأمان أولاً» — 20 ثانية (X/LinkedIn B2B)

```
20-second security-focused motion piece, high-contrast cinematic:
[0-4s] A vault door of frosted glass rotates open revealing a glowing
       knowledge core.
[4-9s] Three threat icons approach (injection needle, siphon pipe,
       ID-mask silhouette) — each shatters against an invisible barrier
       with a soft shockwave.
[9-14s] Inside the vault: data streams pass through a scanning lattice
        that visibly redacts identity sparkles (PII) mid-flow.
[14-18s] A ledger book stamps each event with a wax-seal-like glyph
         (audit log metaphor).
[18-20s] Vault door closes; embossed minimal logo forms on its surface.
Style: minimal, expensive-feeling, mostly dark with precise cyan accents.
```

---

## 4. برومبتات المحتوى المتكرر (مقالات/سلاسل أسبوعية)

### 4.1 غلاف مقال تثقيفي (X/LinkedIn)

```
Minimalist editorial cover: a single elegant metaphor visual —
e.g., a library of floating translucent books reorganizing themselves
into a precise answered question mark made of light.
Muted palette with one strong cyan accent. Ample negative space
for Arabic headline overlay. Flat illustration meets 3D softness.
--ar 16:9
```

### 4.2 خلفيات التقديم للبودكاست/الويبينار

```
Abstract ambient background: slow-flowing data streams forming
topological contour lines across a deep navy canvas, tiny Arabic
letter fragments embedded as micro-patterns, extremely subtle.
Designed for text overlay. --ar 16:9 --style raw
```

---

## 5. أفضل الممارسات التنفيذية

1. **التنويع المنهجي (A/B):** ولّد 3 نُسخ لكل مفهوم رئيسي ببرومبت واحد متغير في: (أ) اللون المهيمن، (ب) زاوية الكاميرا، (ج) كثافة التفاصيل. اختر الأفضل بناءً على CTR التجريبي.
2. **النصوص العربية في الصور:** المولدات الحالية تُنتج عربية غير موثوقة — ولّد الصورة بمساحة سلبية فارغة، وأضف النص العربي لاحقاً عبر Figma/Canva.
3. **الاتساق عبر تثبيت البذرة:** في Midjourney استخدم `--seed` ثابتاً لسلسلة إعلانات واحدة؛ في Flux/Imagen أعد استخدام وصف الإضاءة والخلفية حرفياً.
4. **الفيديو:** أنشئ أولاً 3 لقطات مفتاحية (keyframes) كصور، ثم حرّكها بـ Kling/Runway (image-to-video) لضبط البصرية قبل الالتزام بتوليد 60 ثانية كاملة.
5. **الحقوق:** تحقق من ترخيص أداة التوليد للاستخدام التجاري قبل نشر أي مادة مدفوعة.
6. **الصدق البصري:** لا تعرض واجهات خيالية لم يسبق ظهورها في المنتج الفعلي — المجاز (metaphor) مقبول، والادعاء الوظيفي الزائف ممنوع (راجع [حوكمة الادعاءات](02-product-marketing.md#8-التحقق-من-النزاهة-التسويقية-claims-governance)).

---

## 6. قوالب جاهزة للتخصيص السريع

| الاستخدام             | القالب                                   |
| --------------------- | ---------------------------------------- |
| إعلان ميزة جديدة      | `2.2` أو `2.6` + سطر نصي فوق مساحة سلبية |
| منشور إصدار (Release) | `2.7` Open Graph + مقتطف `3.4` كـ teaser |
| خلفية مقال            | `4.1` أو `4.2`                           |
| فيديو حملة كبرى       | `3.1` كاملاً                             |
| حملة LinkedIn B2B     | `3.4` + `2.4` + `2.5`                    |

---

## انظر أيضاً

- [الملف التعريفي للنظام](01-system-profile.md)
- [استراتيجية التسويق](02-product-marketing.md)
- [خطة الشبكات الاجتماعية](03-social-media-plan.md)
