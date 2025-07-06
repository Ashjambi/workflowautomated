/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, Fragment } from 'preact';
import { html } from 'htm/preact';
import { signal, effect } from '@preact/signals';
import { GoogleGenAI } from '@google/genai';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Configure the PDF.js worker. This is required for the library to work correctly.
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.mjs`;

// === Helper Functions ===
/**
 * Extracts a JSON string from a text that might contain markdown fences or other text.
 * @param {string} text The text to parse.
 * @returns {string} The extracted JSON string.
 */
const extractJsonFromText = (text) => {
    if (!text) return '';
    const trimmedText = text.trim();
    
    // First, try to find a markdown block
    const fenceMatch = trimmedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/s);
    if (fenceMatch && fenceMatch[1]) {
        return fenceMatch[1].trim();
    }
    
    // If no markdown block, find the first '{' or '[' and the last '}' or ']'
    const firstBracket = trimmedText.indexOf('[');
    const firstBrace = trimmedText.indexOf('{');

    let startIndex = -1;
    if (firstBracket !== -1 && firstBrace !== -1) {
        startIndex = Math.min(firstBracket, firstBrace);
    } else if (firstBracket !== -1) {
        startIndex = firstBracket;
    } else {
        startIndex = firstBrace;
    }

    if (startIndex === -1) {
        return trimmedText; // Return original text if no JSON-like characters found
    }

    const lastBracket = trimmedText.lastIndexOf(']');
    const lastBrace = trimmedText.lastIndexOf('}');
    const endIndex = Math.max(lastBracket, lastBrace);

    if (endIndex > startIndex) {
        return trimmedText.substring(startIndex, endIndex + 1);
    }
    
    return trimmedText; // Return original text as a fallback
};

/**
 * Triggers a file download in the browser.
 * @param {string} filename The desired name of the file.
 * @param {string} content The content of the file.
 * @param {string} mimeType The MIME type of the file.
 */
const downloadFile = (filename, content, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

// === Global Signals ===
const activeTab = signal('generate'); // 'generate' | 'qa' | 'chat' | 'quiz' | 'optimize'
const theme = signal('light'); // 'light' | 'dark'

// --- Generation Tab Signals ---
const userInput = signal('');
const pdfText = signal('');
const pdfFileName = signal('');
const flowchartSvg = signal('');
const summaryData = signal(null); // Will hold { summary: string, steps: array }
const tableOfContents = signal(null); // Will hold the extracted ToC array
const status = signal('idle'); // 'idle' | 'parsing' | 'generating' | 'success' | 'error' | 'quota_error'
const loadingMessage = signal('');
const errorMessage = signal('');
const documentSource = signal(''); // Holds the definitive document source for all features
const isListening = signal(false); // For speech recognition

// --- Q&A Tab Signals ---
const qaStatus = signal('idle'); // 'idle' | 'generating' | 'success' | 'error'
const topQuestions = signal([]); // { question: string, answer: string }[]

// --- Chat Tab Signals ---
const chatHistory = signal([]); // { role: 'user' | 'model', content: string }[]
const chatInput = signal('');
const isChatting = signal(false);
const isNodeQuery = signal(false); // Flag to indicate if chat was initiated from a node click

// --- Quiz Tab Signals ---
const quizStatus = signal('idle'); // 'idle' | 'generating' | 'active' | 'finished' | 'error'
const quizQuestions = signal([]);
const currentQuestionIndex = signal(0);
const userAnswers = signal([]);
const quizError = signal('');

// --- Optimization Tab Signals ---
const optimizationStatus = signal('idle'); // 'idle' | 'generating' | 'success' | 'error'
const optimizationSuggestions = signal([]);

const APP_STATE_KEY = 'workflowAutomatorState';

const SAMPLE_SVG_DATA = `<svg width="300" height="480" viewBox="0 0 300 480" xmlns="http://www.w3.org/2000/svg" font-family="'Tajawal', Tahoma, sans-serif">
    <defs>
        <marker id="arrowhead-sample" markerWidth="10" markerHeight="7" refX="0" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#28a745"></polygon>
        </marker>
    </defs>
    <!-- Node 1 -->
    <g>
        <rect x="40" y="20" width="220" height="70" rx="8" ry="8" fill="#ffffff" stroke="#28a745" stroke-width="2"></rect>
        <foreignObject x="40" y="20" width="220" height="70">
            <div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing: border-box; padding: 10px 15px; color: #343a40; font-family: 'Tajawal', Tahoma, sans-serif; font-size: 14px; line-height: 1.6; text-align: center; word-wrap: break-word; overflow-wrap: break-word; height: 100%; display: flex; justify-content: center; align-items: center;">
                الخطوة الأولى: تحديد المتطلبات
            </div>
        </foreignObject>
        <text x="150" y="110" font-size="12px" fill="#6c757d" text-anchor="middle">(مثال توضيحي)</text>
    </g>
    <!-- Arrow 1 -->
    <path d="M 150 125 V 155" stroke="#28a745" stroke-width="2" marker-end="url(#arrowhead-sample)"></path>
    <!-- Node 2 -->
    <g>
        <rect x="40" y="165" width="220" height="70" rx="8" ry="8" fill="#ffffff" stroke="#28a745" stroke-width="2"></rect>
        <foreignObject x="40" y="165" width="220" height="70">
            <div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing: border-box; padding: 10px 15px; color: #343a40; font-family: 'Tajawal', Tahoma, sans-serif; font-size: 14px; line-height: 1.6; text-align: center; word-wrap: break-word; overflow-wrap: break-word; height: 100%; display: flex; justify-content: center; align-items: center;">
                الخطوة الثانية: التصميم والتخطيط
            </div>
        </foreignObject>
        <text x="150" y="255" font-size="12px" fill="#6c757d" text-anchor="middle">(مثال توضيحي)</text>
    </g>
    <!-- Arrow 2 -->
    <path d="M 150 270 V 300" stroke="#28a745" stroke-width="2" marker-end="url(#arrowhead-sample)"></path>
    <!-- Node 3 -->
    <g>
        <rect x="40" y="310" width="220" height="70" rx="8" ry="8" fill="#ffffff" stroke="#28a745" stroke-width="2"></rect>
        <foreignObject x="40" y="310" width="220" height="70">
            <div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing: border-box; padding: 10px 15px; color: #343a40; font-family: 'Tajawal', Tahoma, sans-serif; font-size: 14px; line-height: 1.6; text-align: center; word-wrap: break-word; overflow-wrap: break-word; height: 100%; display: flex; justify-content: center; align-items: center;">
                الخطوة الثالثة: التنفيذ والنشر
            </div>
        </foreignObject>
        <text x="150" y="400" font-size="12px" fill="#6c757d" text-anchor="middle">(مثال توضيحي)</text>
    </g>
</svg>`;

const SAMPLE_DOCUMENT_TEXT = `
[Source: Page 1]
**إجراء طلب إجازة سنوية**

يهدف هذا الإجراء إلى توضيح الخطوات الرسمية لتقديم طلب إجازة سنوية للموظفين وضمان معالجته بكفاءة.

**الخطوات:**

1.  **تقديم الطلب عبر النظام:** يقوم الموظف بتسجيل الدخول إلى نظام الموارد البشرية الإلكتروني. يتوجه بعد ذلك إلى قسم "الإجازات" ويختار "طلب إجازة جديد". يجب على الموظف تعبئة جميع الحقول المطلوبة بدقة، بما في ذلك تحديد تاريخ بداية الإجازة ونهايتها.

2.  **موافقة المدير المباشر:** بعد تقديم الطلب، يتم إرسال إشعار تلقائي إلى المدير المباشر للموظف. يقوم المدير بمراجعة الطلب، مع الأخذ في الاعتبار جدول عمل الفريق وأرصدة الإجازات المتاحة للموظف. يمكن للمدير الموافقة على الطلب، أو رفضه مع ذكر السبب، أو إعادته للموظف للتعديل.

3.  **اعتماد إدارة الموارد البشرية:** في حال موافقة المدير المباشر، ينتقل الطلب تلقائيًا إلى قسم الموارد البشرية. تقوم الإدارة بالتحقق النهائي من رصيد إجازات الموظف والتأكد من عدم تعارض الإجازة مع سياسات الشركة. بعد التحقق، تقوم إدارة الموارد البشرية باعتماد الطلب بشكل نهائي.

4.  **تأكيد نهائي وإشعار الموظف:** بمجرد اعتماد الطلب من قبل الموارد البشرية، يتم إرسال بريد إلكتروني تلقائي للموظف لتأكيد الموافقة على إجازته. يتم تحديث رصيد إجازات الموظف في النظام بشكل فوري.
`;

const TocComponent = ({ toc, onItemClick }) => {
  if (!toc || toc.length === 0) return null;

  return html`
    <div class="toc-section">
      <h3>فهرس المحتويات</h3>
      <p>انقر على قسم لبدء التحليل وإنشاء المخطط الانسيابي له.</p>
      <ul>
        ${toc.map(item => html`
          <li 
            onClick=${() => onItemClick(item)}
            style=${{ paddingRight: `${(item.level > 1 ? (item.level -1) * 20 : 0) + 16}px` }}
            title="تحليل القسم: ${item.title}"
          >
            <span class="toc-title">${item.title}</span>
            <span class="toc-page">ص ${item.page}</span>
          </li>
        `)}
      </ul>
    </div>
  `;
};

// Main App Component
const App = () => {

  const extractTextFromPdf = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;
    let fullText = '';

    for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        fullText += `[Source: Page ${i}]\n`;

        if (textContent.items.length === 0) {
            fullText += '\n\n';
            continue;
        }

        const lines = textContent.items.reduce((acc, item) => {
            if (!item.str || item.str.trim() === '') return acc;
            const y = Math.round(item.transform[5]);
            if (!acc[y]) acc[y] = [];
            acc[y].push(item);
            return acc;
        }, {});

        const sortedLines = Object.keys(lines)
            .map(Number)
            .sort((a, b) => b - a);

        let pageText = '';
        for (const y of sortedLines) {
            lines[y].sort((a, b) => b.transform[4] - a.transform[4]);

            let lineText = lines[y].reduce((line, currentItem, index, arr) => {
                let text = currentItem.str;
                if (/[\u0600-\u06FF]/.test(text) && !/[a-zA-Z]/.test(text)) {
                    text = text.split('').reverse().join('');
                }
                line += text;
                
                if (index < arr.length - 1) {
                    const nextItem = arr[index + 1];
                    const leftEdgeOfCurrent = currentItem.transform[4];
                    const rightEdgeOfNext = nextItem.transform[4] + nextItem.width;
                    
                    const spaceThreshold = currentItem.height * 0.25; 
                    if (leftEdgeOfCurrent > rightEdgeOfNext + spaceThreshold) {
                        line += ' ';
                    }
                }
                return line;
            }, '');
            pageText += lineText + '\n';
        }
        fullText += pageText + '\n';
    }
    return fullText;
  };

  /**
   * Reads a file and returns its base64 encoded representation for the Gemini API.
   * @param {File} file The file to read.
   * @returns {Promise<object>} A promise that resolves with the generative part object.
   */
    const fileToGenerativePart = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                // Get the base64 string, remove the data URI prefix
                const base64Data = reader.result.split(',')[1];
                resolve({
                    inlineData: {
                        mimeType: file.type,
                        data: base64Data
                    }
                });
            };
            reader.onerror = (err) => reject(err);
            reader.readAsDataURL(file);
        });
    };

    const extractTextFromImage = async (file) => {
        const imagePart = await fileToGenerativePart(file);
        const prompt = "استخرج كل النصوص الموجودة في هذه الصورة باللغة العربية. حافظ على التنسيق والفقرات قدر الإمكان.";
        
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-preview-04-17',
            contents: { parts: [imagePart, {text: prompt}] },
            config: { thinkingConfig: { thinkingBudget: 0 } },
        });

        return response.text;
    };

  const extractTocFromText = async (documentText) => {
    if (!documentText) return null;

    const prompt = `
أنت خبير في تحليل المستندات والتعرف على بنيتها، متخصص في المستندات العربية. مهمتك هي استخراج جدول المحتويات (ToC) من نص المستند المقدم.

**تعليمات حاسمة:**
1.  قم بتحليل النص المقدم لتحديد جدول المحتويات. ستكون العناوين باللغة العربية.
2.  انتبه جيدًا لعلامات \`[Source: Page X]\` لتحديد رقم الصفحة بشكل صحيح لكل إدخال في جدول المحتويات.
3.  يجب أن يكون إخراجك مصفوفة JSON واحدة وصالحة. لا تقم بتضمين أي نص أو شروحات أو علامات markdown أخرى.
4.  يجب أن يحتوي كل كائن في المصفوفة على: \`title\` (سلسلة نصية باللغة العربية)، و \`page\` (رقم)، و \`level\` (رقم يشير إلى التسلسل الهرمي، افتراضيًا 1).
5.  **مثال على تنسيق الإخراج المطلوب:** \`[ { "title": "الفصل الأول: المقدمة", "page": 5, "level": 1 } ]\`

---
**بيانات الإدخال (نص المستند بالعربية):**
${documentText}
---
قم بإنشاء مصفوفة JSON فقط. إذا لم يتم العثور على جدول محتويات، قم بإرجاع مصفوفة فارغة \`[]\`.`;
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-preview-04-17',
            contents: prompt,
            config: { responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
        });
        
        const jsonText = extractJsonFromText(response.text);
        const toc = JSON.parse(jsonText);
        return (Array.isArray(toc) && toc.length > 0) ? toc : null;
    } catch (e) {
        console.warn("Could not extract Table of Contents:", e);
        return null;
    }
  };
    
  const generateTopQuestions = async (documentContext, sectionContext) => {
    const prompt = `أنت مساعد ذكاء اصطناعي متخصص في استخلاص المعلومات الأساسية من النصوص. مهمتك هي إنشاء قائمة بالأسئلة والأجوبة الأكثر أهمية بناءً على القسم المحدد من النص المقدم.

**تعليمات صارمة:**
1.  **ركز فقط** على المحتوى المتعلق بالقسم: **"${sectionContext}"**. تجاهل الأقسام الأخرى من المستند إذا كان هناك قسم محدد.
2.  قم بإنشاء 5 أسئلة وجواب كحد أقصى.
3.  يجب أن تكون الأسئلة مباشرة وذات صلة بالمحتوى الأساسي للقسم المحدد.
4.  يجب أن تكون الإجابات موجزة ودقيقة ومستخلصة مباشرة من النص.
5.  المخرج النهائي **يجب** أن يكون مصفوفة JSON صالحة فقط. لا تقم بتضمين أي نص أو شروحات أو علامات markdown.
6.  يجب أن يتبع كل كائن في المصفوفة هذا الهيكل بالضبط: \`{ "question": "...", "answer": "..." }\`.
7.  يجب أن تكون جميع الأسئلة والأجوبة باللغة العربية.

---
**القسم المستهدف للتحليل:** ${sectionContext}
---
**النص المصدر الكامل (للسياق):**
${documentContext}
---
الآن، قم بإنشاء مصفوفة JSON فقط بناءً على القسم المحدد.`;

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-04-17',
        contents: prompt,
        config: { responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
    });

    const jsonText = extractJsonFromText(response.text);
    const qaData = JSON.parse(jsonText);
    if (!Array.isArray(qaData)) {
        throw new Error("لم يتم إنشاء بيانات أسئلة وأجوبة صالحة.");
    }
    return qaData;
  };

  const handleGenerate = async (sectionTitle = '') => {
    const contextFromInput = userInput.value.trim();
    const contextFromPdf = pdfText.value.trim();

    if (!contextFromInput && !contextFromPdf) return;
    
    let userQuery, documentContext;

    if (contextFromPdf) {
        documentContext = contextFromPdf;
        userQuery = contextFromInput; // Can be an empty string
    } else {
        documentContext = contextFromInput;
        userQuery = ''; // The whole input is the document, so no specific query
    }

    if (!documentContext) return;
    documentSource.value = documentContext; // Set the global source for other tabs

    const effectiveQuery = userQuery || "لخص العملية الرئيسية الموضحة في هذا المستند بالكامل.";

    const promptForAnalysis = `
أنت مساعد ذكاء اصطناعي خبير في تحليل الإجراءات والنصوص الإدارية، ومخرجك **يجب أن يكون دائماً باللغة العربية الفصحى**.
**مهمتك الأساسية**: تحليل طلب المستخدم والنص المصدر المقدم لإنتاج كائن JSON واحد صالح. هذا الكائن يجب أن يحتوي على مفتاحين أساسيين:
1.  \`summary\`: **ملخص تنفيذي**: يجب أن يكون هذا فقرة نثرية متماسكة وموجزة باللغة العربية، تقدم نظرة شاملة وعامة على العملية الموصوفة. **لا تقم بسرد الخطوات هنا**، بل قدم ملخصًا سرديًا.
2.  \`steps\`: **خطوات العملية**: يجب أن يكون هذا مصفوفة من الكائنات، حيث يمثل كل كائن **مرحلة عمل رئيسية ومكتملة**.
    *   **قاعدة حاسمة**: **لا تقم بتقسيم إجراء واحد إلى خطوات متعددة**. على سبيل المثال، إذا كان النص يصف "تعبئة النموذج ثم تقديمه"، فيجب أن يكون هذا خطوة واحدة بعنوان "تعبئة وتقديم النموذج"، وليس خطوتين منفصلتين. ادمج الأفعال المتسلسلة التي تشكل إجراءً واحدًا.
    *   كل كائن خطوة يجب أن يحتوي على:
        *   \`stepNumber\` (رقم).
        *   \`description\` (**عنوان الخطوة**): **نص موجز جدًا ومكثف** يلخص جوهر المرحلة. يجب أن يكون هذا العنوان مصممًا للعرض داخل صندوق في مخطط انسيابي، مع العلم أن المستخدم يمكنه النقر للحصول على التفاصيل. **ركز على الفعل الأساسي والنتيجة**. مثال جيد: "تقديم طلب الإجازة". مثال سيء: "يقوم الموظف أولاً بفتح النظام ثم يذهب إلى قسم الإجازات ويملأ الحقول المطلوبة ثم يضغط على زر الإرسال".
        *   \`page\` (رقم الصفحة المأخوذ من علامة \`[Source: Page X]\` في النص المصدر).

**قواعد حاسمة لا يمكن تجاوزها:**
1.  **اللغة العربية حصرًا**: كل النصوص المولدة، بما في ذلك \`summary\` و \`description\` لكل خطوة، يجب أن تكون باللغة العربية.
2.  **استخلاص رقم الصفحة**: لكل خطوة في مصفوفة \`steps\`، من الضروري تحديد رقم الصفحة بدقة من أقرب علامة \`[Source: Page X]\` تسبق الخطوة في النص المصدر.
3.  **تنسيق JSON نقي**: المخرج النهائي يجب أن يكون كائن JSON صالح تمامًا. لا تضف أي تعليقات، مقدمات، خواتيم، أو علامات markdown مثل \`\`\`json. فقط كائن JSON.

---
**طلب المستخدم:** ${effectiveQuery}
**المستند المصدر:** ${documentContext}
---
الآن، قم بإنشاء كائن JSON باللغة العربية فقط بناءً على التعليمات الصارمة أعلاه.`;

    const promptForSvgGeneration = (planStepsJson) => `
أنت فنان SVG خبير ومصمم جرافيك، متخصص في إنشاء مخططات انسيابية جمالية وواضحة وتفاعلية باللغة العربية. مهمتك هي تحويل بيانات JSON المقدمة إلى كود SVG واحد، جميل، ووظيفي.

**المهمة:** قم بإنشاء كتلة كود SVG واحدة وصالحة. لا تقم بتضمين أي نصوص أخرى أو تفسيرات أو علامات markdown خارج كود SVG.

**تعليمات التصميم والجودة (قواعد صارمة):**
1.  **التفاعل (Interaction)**:
    *   يجب أن تكون كل مجموعة عقدة (node group) قابلة للنقر. قم بتغليف كل عقدة (المستطيل والنص والاستشهاد) في عنصر \`<g>\`.
    *   **أضف السمة \`id="node-\${step.stepNumber}"\`** إلى كل عنصر \`<g>\`. استخدم رقم الخطوة من بيانات JSON.
    *   **أضف السمة \`class="clickable-node"\`** إلى كل عنصر \`<g>\`.
2.  **النمط الجمالي المحدّث (Aesthetics)**:
    *   **الألوان**: اللون الأساسي هو \`#28a745\`.
    *   **التعريفات (\`<defs>\`)**: قم بتنشاء قسم \`<defs>\` قوي يحتوي على:
        *   **رأس السهم**: \`<marker id="arrowhead" markerWidth="10" markerHeight="7" refX="0" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="#28a745"></polygon></marker>\`.
        *   **فلتر الظل**: \`<filter id="dropShadow" height="130%"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="rgba(0,0,0,0.1)"/></filter>\`.
        *   **نمط التحويم**: \`<style>.clickable-node { cursor: pointer; } g.clickable-node > rect { transition: stroke 0.2s ease, stroke-width 0.2s ease; } g.clickable-node:hover > rect { stroke-width: 3px; stroke: #218838; }</style>\`. هذا يوفر تغذية راجعة بصرية ثابتة عند التحويم، مما يمنع الاهتزاز ويجعل النقر سهلاً.
    *   **العقد (Nodes)**:
        *   طبق الفلتر \`filter="url(#dropShadow)"\` على كل مجموعة عقدة \`<g>\`.
        *   استخدم مستطيلات (\`<rect>\`) بزوايا دائرية كبيرة (\`rx="12" ry="12"\`).
        *   **التعبئة**: استخدم خلفية بيضاء نقية (\`fill="#ffffff"\`).
        *   **الإطار**: استخدم اللون الأساسي \`#28a745\` و \`stroke-width="2"\`.
3.  **عرض النص العربي (Arabic Text Rendering)**:
    *   **إلزامي**: استخدم \`<foreignObject>\` داخل كل مجموعة عقد (\`<g>\`) لضمان عرض النص العربي بشكل صحيح مع التفاف الكلمات.
    *   **النمط**: داخل \`div\`، استخدم \`font-family: 'Tajawal', Tahoma, sans-serif;\`, حجم خط \`14px\`, **وزن خط 500** (\`font-weight: 500\`)، ومحاذاة للنص في المنتصف. أضف حشوة كافية.
4.  **الأبعاد والتخطيط (Layout & Sizing)**:
    *   **عرض العقدة**: ثابت عند 220 بكسل.
    *   **ارتفاع العقدة**: ديناميكي ليناسب النص بشكل كامل.
    *   **التخطيط**: قم بتوسيط جميع العقد أفقيًا. حافظ على مسافة رأسية ثابتة (مثل 60-70 بكسل) بين العقد.
    *   **لوحة الرسم (SVG Canvas)**: اضبط أبعاد \`<svg>\` بدقة لتناسب المحتوى بالكامل.
5.  **الاستشهادات (Citations)**:
    *   أسفل كل عقدة، ضع عنصر \`<text>\` مع \`(المصدر: صفحة \${page})\` بلون رمادي فاتح (\`#6c757d\`) وحجم خط صغير (\`12px\`).

---
**بيانات الخطة (JSON مع محتوى عربي):**
${planStepsJson}
---
الآن، قم بإنشاء كود SVG فقط، مع الالتزام الصارم بجميع تعليمات التصميم والجودة والتفاعل المحدّثة.`;


    status.value = 'generating';
    qaStatus.value = 'idle';
    optimizationStatus.value = 'idle';
    topQuestions.value = [];
    flowchartSvg.value = '';
    errorMessage.value = '';
    summaryData.value = null;
    optimizationSuggestions.value = [];
    
    try {
      loadingMessage.value = 'المرحلة الأولى: تحليل المستند...';
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      const analysisResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-04-17',
        contents: promptForAnalysis,
        config: { responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
      });

      const planJsonText = extractJsonFromText(analysisResponse.text);
      const plan = JSON.parse(planJsonText);

      if (!plan.summary || !plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) {
        throw new Error("فشلت الخطة التي تم إنشاؤها في التحقق.");
      }
      summaryData.value = plan;

      loadingMessage.value = 'المرحلة الثانية: رسم المخطط الانسيابي...';
      const svgResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-04-17',
        contents: promptForSvgGeneration(JSON.stringify(plan.steps, null, 2)),
        config: { thinkingConfig: { thinkingBudget: 0 } },
      });

      let svgContent = svgResponse.text.trim();
      const svgMatch = svgContent.match(/<svg[\s\S]*?<\/svg>/);
      if (!svgMatch || !svgMatch[0]) throw new Error("المخرجات التي تم إنشاؤها لا تحتوي على SVG صالح.");
      
      flowchartSvg.value = svgMatch[0];

      loadingMessage.value = 'المرحلة الثالثة: استخلاص أهم الأسئلة...';
      qaStatus.value = 'generating';
      const qaContext = sectionTitle || (pdfFileName.value ? 'المستند بأكمله' : 'النص المقدم');
      const qaData = await generateTopQuestions(documentContext, qaContext);
      topQuestions.value = qaData;
      qaStatus.value = 'success';

      status.value = 'success';
    } catch(err) {
      console.error('Generation error:', err);
      qaStatus.value = 'error';
      if (err instanceof Error && (err.message.includes('quota') || err.message.includes('RESOURCE_EXHAUSTED'))) {
        errorMessage.value = 'عذرًا، الخدمة تواجه ضغطًا. هذا مثال توضيحي للمخطط. يرجى المحاولة مرة أخرى لاحقًا.';
        flowchartSvg.value = SAMPLE_SVG_DATA;
        status.value = 'quota_error';
      } else {
        errorMessage.value = err instanceof Error ? `فشل التحليل: ${err.message}` : 'حدث خطأ غير متوقع.';
        status.value = 'error';
      }
    } finally {
        loadingMessage.value = '';
    }
  };
  
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    handleClear();
    pdfFileName.value = file.name;
    e.target.value = ''; // Reset the file input
    status.value = 'parsing';
    
    try {
        let text = '';
        if (file.type === 'application/pdf') {
            loadingMessage.value = 'جاري قراءة ملف PDF...';
            text = await extractTextFromPdf(file);
        } else if (file.type.startsWith('image/')) {
            loadingMessage.value = 'جاري تحليل الصورة (OCR)...';
            text = await extractTextFromImage(file);
        } else {
            throw new Error('نوع ملف غير مدعوم. يرجى تحميل ملف PDF أو صورة.');
        }

        if (!text.trim()) throw new Error(`لم يتم العثور على نص في الملف: ${file.name}`);
        pdfText.value = text;
        documentSource.value = text;
        
        // Only try to extract ToC from PDFs
        if (file.type === 'application/pdf') {
            loadingMessage.value = 'جاري استخراج فهرس المحتويات...';
            tableOfContents.value = await extractTocFromText(text);
        } else {
            tableOfContents.value = null; // No ToC for images
        }
        
        status.value = 'idle';
    } catch (err) {
        console.error('File processing error:', err);
        errorMessage.value = err instanceof Error ? err.message : 'فشل في معالجة الملف.';
        status.value = 'error';
        pdfFileName.value = '';
    } finally {
        loadingMessage.value = '';
    }
  };

  const handleTocClick = (item) => {
    summaryData.value = null;
    flowchartSvg.value = '';
    errorMessage.value = '';
    userInput.value = `لخّص واعرض المخطط الانسيابي للقسم بعنوان "${item.title}"`;
    handleGenerate(item.title);
  };
    
  const handleTrySample = () => {
      handleClear();
      userInput.value = SAMPLE_DOCUMENT_TEXT;
      setTimeout(() => handleGenerate('إجراء طلب إجازة سنوية'), 100);
  };

  const handleClear = () => {
    // Generation tab
    userInput.value = '';
    pdfText.value = '';
    documentSource.value = '';
    pdfFileName.value = '';
    tableOfContents.value = null;
    flowchartSvg.value = '';
    errorMessage.value = '';
    summaryData.value = null;
    status.value = 'idle';
    loadingMessage.value = '';
    isListening.value = false;
    // Q&A tab
    qaStatus.value = 'idle';
    topQuestions.value = [];
    // Chat tab
    chatHistory.value = [];
    chatInput.value = '';
    isChatting.value = false;
    // Quiz tab
    quizStatus.value = 'idle';
    quizQuestions.value = [];
    currentQuestionIndex.value = 0;
    userAnswers.value = [];
    quizError.value = '';
    // Optimization tab
    optimizationStatus.value = 'idle';
    optimizationSuggestions.value = [];
    // Clear saved state from localStorage
    try {
        localStorage.removeItem(APP_STATE_KEY);
    } catch(e) {
        console.warn("Could not remove state from localStorage", e);
    }
  };
  
  const handleClearResults = () => {
    userInput.value = '';
    flowchartSvg.value = '';
    errorMessage.value = '';
    summaryData.value = null;
    status.value = 'idle';
    loadingMessage.value = '';
  };

  const handleSendMessage = async () => {
    const userMessage = chatInput.value.trim();
    if (!userMessage || isChatting.value || !documentSource.value) return;

    const newHistory = [...chatHistory.value, { role: 'user', content: userMessage }];
    chatHistory.value = newHistory; // Show user message
    chatInput.value = '';
    isChatting.value = true;
    
    // Add placeholder for model's streaming response
    chatHistory.value = [...newHistory, { role: 'model', content: '' }];

    // Check if this is a query from a flowchart node and reset the flag
    const nodeQuery = isNodeQuery.value;
    isNodeQuery.value = false;

    const nodeQueryInstruction = `أنت مساعد ذكاء اصطناعي. المستخدم يسأل عن تفاصيل خطوة محددة في عملية تم تلخيصها من المستند المصدر أدناه. مهمتك هي العثور على الأجزاء ذات الصلة في المستند المصدر التي تصف هذه الخطوة وتقديم شرح مفصل بناءً عليها. أجب باللغة العربية.`;
    const defaultInstruction = `أنت مساعد ذكاء اصطناعي. أجب على أسئلة المستخدم باللغة العربية بناءً على المستند المصدر المقدم **فقط**. إذا كانت الإجابة غير موجودة بشكل صريح في المستند، يجب أن تقول "المعلومات المطلوبة غير متوفرة في المستند."`;

    const systemInstruction = nodeQuery ? nodeQueryInstruction : defaultInstruction;

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        // Get history BEFORE the last user message for context
        const historyForChat = newHistory.slice(0, -1).map(msg => ({
            role: msg.role,
            parts: [{ text: msg.content }]
        }));

        const chat = ai.chats.create({
          model: 'gemini-2.5-flash-preview-04-17',
          // The Chat object can take a system instruction and the full document context.
          config: {
            systemInstruction: `${systemInstruction}\n\n---### **المستند المصدر**---\n${documentSource.value}`,
          },
          history: historyForChat,
        });

        const responseStream = await chat.sendMessageStream({message: userMessage});

        for await (const chunk of responseStream) {
            const currentHistory = chatHistory.value;
            const lastMessage = currentHistory[currentHistory.length - 1];
            // Ensure we are updating the model's message placeholder
            if (lastMessage && lastMessage.role === 'model') {
                lastMessage.content += chunk.text;
                // Trigger a re-render by creating a new array
                chatHistory.value = [...currentHistory];
            }
        }
    } catch (e) {
        console.error("Chat error:", e);
        const currentHistory = chatHistory.value;
        const lastMessage = currentHistory[currentHistory.length - 1];
        if (lastMessage && lastMessage.role === 'model') {
            lastMessage.content = "عذرًا، حدث خطأ أثناء محاولة الرد.";
            chatHistory.value = [...currentHistory];
        }
    } finally {
        isChatting.value = false;
    }
  };

  const startChatWithNode = (nodeText) => {
    if (!nodeText || !documentSource.value) return;

    const userMessage = `اشرح لي هذه الخطوة من المخطط بالتفصيل: "${nodeText}"`;
    activeTab.value = 'chat';

    isNodeQuery.value = true; // Set the flag before triggering send

    setTimeout(() => {
        chatInput.value = userMessage;
        handleSendMessage();
    }, 100);
  };
  
    const handleMicClick = () => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert('عذرًا، متصفحك لا يدعم ميزة التعرف على الكلام.');
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = 'ar-SA'; // Arabic - Saudi Arabia
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            isListening.value = true;
        };

        recognition.onresult = (event) => {
            const speechResult = event.results[0][0].transcript;
            userInput.value += (userInput.value ? ' ' : '') + speechResult;
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                alert('تم رفض إذن استخدام الميكروفون. يرجى تفعيله من إعدادات المتصفح.');
            }
        };

        recognition.onend = () => {
            isListening.value = false;
        };

        if (isListening.value) {
            recognition.stop();
        } else {
            recognition.start();
        }
    };


  return html`
    <div class="app-content">
      <header>
        <div class="header-main">
            <svg class="logo" width="140" height="70" viewBox="0 0 140 70" xmlns="http://www.w3.org/2000/svg">
                <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" class="logo-text">SGS</text>
            </svg>
            <${ThemeToggleButton} />
        </div>
        <div class="header-text">
            <h1>تحليل وتصميم خرائط العمليات آليًا</h1>
            <p>
                أداة ذكية لتحليل المستندات، واستخلاص الإجراءات، وتصميمها في مخططات انسيابية دقيقة، مع إمكانية الدردشة مع المستند لطرح استفسارات محددة.
            </p>
        </div>
      </header>

      <div class="tabs-container">
        <button 
          class="tab-button ${activeTab.value === 'generate' ? 'active' : ''}" 
          onClick=${() => activeTab.value = 'generate'}>
          تحليل وإنشاء
        </button>
        <button 
          class="tab-button ${activeTab.value === 'optimize' ? 'active' : ''}" 
          onClick=${() => activeTab.value = 'optimize'}
          disabled=${status.value !== 'success'}>
          تحسين الإجراء
        </button>
        <button 
          class="tab-button ${activeTab.value === 'qa' ? 'active' : ''}" 
          onClick=${() => activeTab.value = 'qa'}>
          أهم الأسئلة
        </button>
        <button 
          class="tab-button ${activeTab.value === 'chat' ? 'active' : ''}" 
          onClick=${() => activeTab.value = 'chat'}>
          دردشة مع المستند
        </button>
        <button 
          class="tab-button ${activeTab.value === 'quiz' ? 'active' : ''}" 
          onClick=${() => activeTab.value = 'quiz'}>
          اختبار سريع
        </button>
      </div>

      <div class="tab-content">
        ${activeTab.value === 'generate' && html`<${GenerationView} 
            handleGenerate=${handleGenerate}
            handleClearResults=${handleClearResults}
            handleFileChange=${handleFileChange}
            handleTocClick=${handleTocClick}
            handleTrySample=${handleTrySample}
            onChartNodeClick=${startChatWithNode}
            handleMicClick=${handleMicClick}
          />`}
        ${activeTab.value === 'optimize' && html`<${OptimizationView} />`}
        ${activeTab.value === 'qa' && html`<${QAView} />`}
        ${activeTab.value === 'chat' && html`<${ChatView}
            onSendMessage=${handleSendMessage}
           />`}
        ${activeTab.value === 'quiz' && html`<${QuizView} />`}
      </div>
    </div>
  `;
};

// --- Child Components ---

const ThemeToggleButton = () => {
    const isDark = theme.value === 'dark';

    const toggleTheme = () => {
        theme.value = isDark ? 'light' : 'dark';
    };

    const icon = isDark ? 
        html`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>` : 
        html`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;

    return html`
        <button class="theme-toggle" onClick=${toggleTheme} title=${`التبديل إلى الوضع ${isDark ? 'النهاري' : 'الليلي'}`}>
            ${icon}
        </button>
    `;
}

const GenerationView = ({ handleGenerate, handleClearResults, handleFileChange, handleTocClick, onChartNodeClick, handleTrySample, handleMicClick }) => {
  const isGenerating = ['parsing', 'generating'].includes(status.value);
  const isButtonDisabled = isGenerating || (!userInput.value.trim() && !pdfText.value.trim()) || isListening.value;
  const isClearDisabled = isGenerating || (!userInput.value.trim() && !flowchartSvg.value.trim() && !summaryData.value && !errorMessage.value) || isListening.value;
  const isMicDisabled = isGenerating;

  const getButtonText = () => {
    if (status.value === 'parsing') return 'جاري المعالجة...';
    if (status.value === 'generating') return 'جاري الإنشاء...';
    return 'إنشاء المخطط الانسيابي';
  };

  const getPlaceholderText = () => {
    if(isListening.value) return 'جاري الاستماع...';
    return pdfText.value ? 'اكتب طلبك هنا، أو اختر قسمًا من فهرس المحتويات.' : 'صف العملية الخاصة بك هنا أو قم بتحميل ملف أدناه';
  };
  
  const handleChartClick = (e) => {
    const node = e.target.closest('.clickable-node');
    if (node) {
        const foreignObjectDiv = node.querySelector('foreignObject > div');
        const nodeText = foreignObjectDiv ? foreignObjectDiv.textContent.trim() : null;
        if (nodeText && onChartNodeClick) {
            onChartNodeClick(nodeText);
        }
    }
  };

  const handleExportSvg = () => {
    if (!flowchartSvg.value) return;
    downloadFile('flowchart.svg', flowchartSvg.value, 'image/svg+xml');
  };

  const handleExportSummary = () => {
    if (!summaryData.value) return;
    const { summary, steps } = summaryData.value;
    let content = `ملخص تنفيذي:\n${summary}\n\n`;
    content += `الخطوات:\n`;
    steps.forEach(step => {
      content += `${step.stepNumber}. ${step.description} (المصدر: صفحة ${step.page})\n`;
    });
    downloadFile('summary.txt', content, 'text/plain;charset=utf-8');
  };

  const renderResult = () => {
    switch (status.value) {
      case 'parsing':
      case 'generating':
        return html`<div class="loader-container"><div class="loader"></div><p class="loading-text">${loadingMessage.value}</p></div>`;
      case 'quota_error':
        return html`<${Fragment}><div class="error info">${errorMessage.value}</div><div class="image-container" onClick=${handleChartClick} dangerouslySetInnerHTML=${{ __html: flowchartSvg.value }}></div></${Fragment}>`;
      case 'error':
        return html`<div class="error">${errorMessage.value}</div>`;
      case 'success':
        return html`<${Fragment}>
            ${summaryData.value?.summary && html`<div class="summary-section"><h3>ملخص تنفيذي</h3><p>${summaryData.value.summary}</p></div>`}
            <div class="image-container" onClick=${handleChartClick} dangerouslySetInnerHTML=${{ __html: flowchartSvg.value }}></div>
            <div class="export-container">
                ${flowchartSvg.value && html`<button onClick=${handleExportSvg} class="clear-btn">تصدير المخطط (SVG)</button>`}
                ${summaryData.value && html`<button onClick=${handleExportSummary} class="clear-btn">تصدير الملخص (TXT)</button>`}
            </div>
        </${Fragment}>`;
      default:
        return null;
    }
  };
  
  const micIcon = html`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512">
        <path d="M192 0C139 0 96 43 96 96V256c0 53 43 96 96 96s96-43 96-96V96c0-53-43-96-96-96zM64 216c0-13.3-10.7-24-24-24s-24 10.7-24 24v40c0 89.1 66.2 162.7 152 174.4V464H120c-13.3 0-24 10.7-24 24s10.7 24 24 24h144c13.3 0 24-10.7 24-24s-10.7-24-24-24H216V430.4c85.8-11.7 152-85.3 152-174.4V216c0-13.3-10.7-24-24-24s-24 10.7-24 24v40c0 70.7-57.3 128-128 128s-128-57.3-128-128V216z"/>
    </svg>`;

  return html`
    <div class="input-section">
      <textarea
        value=${userInput.value}
        onInput=${(e) => (userInput.value = e.target.value)}
        placeholder=${getPlaceholderText()}
        disabled=${isGenerating || isListening.value}
      ></textarea>
      <div class="button-container">
          <button onClick=${() => handleGenerate()} disabled=${isButtonDisabled}>${getButtonText()}</button>
          <button onClick=${handleClearResults} class="clear-btn" disabled=${isClearDisabled}>مسح المحتوى</button>
          <input type="file" id="file-upload" accept=".pdf,image/*" onChange=${handleFileChange} style=${{display: 'none'}} disabled=${isGenerating || isListening.value} />
          <label for="file-upload" class=${`upload-btn ${isGenerating || isListening.value ? 'disabled' : ''}`}>تحميل ملف (PDF/صورة)</label>
          <button onClick=${handleMicClick} class=${`mic-btn ${isListening.value ? 'listening' : ''}`} disabled=${isMicDisabled} title="استخدم الإدخال الصوتي">
            ${micIcon}
          </button>
          <button onClick=${handleTrySample} class="clear-btn" disabled=${isGenerating || isListening.value}>جرّب مثالاً</button>
          ${pdfFileName.value && html`<span class="file-name">ملف: ${pdfFileName.value}</span>`}
      </div>
    </div>
    ${tableOfContents.value && html`<${TocComponent} toc=${tableOfContents.value} onItemClick=${handleTocClick} />`}
    <div class="result-section">${renderResult()}</div>
  `;
};

const QAView = () => {
    const handleExportQA = () => {
        if (!topQuestions.value || topQuestions.value.length === 0) return;
        const jsonContent = JSON.stringify(topQuestions.value, null, 2);
        downloadFile('questions_and_answers.json', jsonContent, 'application/json;charset=utf-8');
    };

    if (!documentSource.value) {
        return html`
            <div class="disabled-view">
                <h3>أهم الأسئلة والأجوبة</h3>
                <p>يرجى تحليل مستند أو قسم في تبويب "تحليل وإنشاء" أولاً لعرض الأسئلة والأجوبة المتعلقة به.</p>
            </div>
        `;
    }

    if (qaStatus.value === 'generating') {
        return html`
            <div class="qa-view">
                <div class="loader-container">
                    <div class="loader"></div>
                    <p class="loading-text">جاري استخلاص الأسئلة والأجوبة...</p>
                </div>
            </div>`;
    }

    if (qaStatus.value === 'error') {
        return html`
            <div class="qa-view">
                <div class="error">فشل في استخلاص الأسئلة. يرجى المحاولة مرة أخرى.</div>
            </div>`;
    }

    if (qaStatus.value === 'success' && topQuestions.value.length > 0) {
        return html`
            <div class="qa-view">
                <h3>أهم الأسئلة والأجوبة</h3>
                <p>هذه قائمة بالأسئلة الأكثر شيوعًا وإجاباتها بناءً على المحتوى الذي قمت بتحليله.</p>
                <div class="qa-list">
                    ${topQuestions.value.map(item => html`
                        <div class="qa-item">
                            <h4 class="qa-question">${item.question}</h4>
                            <p class="qa-answer">${item.answer}</p>
                        </div>
                    `)}
                </div>
                 <div class="export-container">
                    <button onClick=${handleExportQA} class="clear-btn">تصدير الأسئلة والأجوبة (JSON)</button>
                </div>
            </div>
        `;
    }

    return html`
        <div class="disabled-view">
            <h3>أهم الأسئلة والأجوبة</h3>
            <p>بعد تحليل المستند، ستظهر هنا قائمة بالأسئلة والأجوبة الأكثر أهمية. إذا لم تظهر أي أسئلة، فقد يعني ذلك أن المحتوى لم يكن كافياً لإنشائها.</p>
        </div>
    `;
};

const ChatView = ({ onSendMessage }) => {
    // Effect to scroll to the bottom of the chat history when a new message is added.
    effect(() => {
        if (chatHistory.value.length) {
            const historyElement = document.querySelector('.chat-history');
            if(historyElement) {
                historyElement.scrollTop = historyElement.scrollHeight;
            }
        }
    });

    if (!documentSource.value) {
        return html`
            <div class="disabled-view">
                <h3>الدردشة مع المستند</h3>
                <p>يرجى تحميل ملف أو إدخال نص في تبويب "تحليل وإنشاء" أولاً لتفعيل الدردشة.</p>
            </div>
        `;
    }

    return html`
        <div class="chat-view">
            <div class="chat-history">
                ${chatHistory.value.map(msg => html`
                    <div class="chat-message ${msg.role}">
                        <div class="message-content" dangerouslySetInnerHTML=${{ __html: msg.content.replace(/\n/g, '<br />') }}></div>
                    </div>
                `)}
                ${isChatting.value && chatHistory.value[chatHistory.value.length - 1]?.role === 'model' && html`
                    <div class="chat-message model">
                        <div class="message-content loader-dots" style=${{display: chatHistory.value[chatHistory.value.length-1].content ? 'none' : 'block' }}>
                            <span></span><span></span><span></span>
                        </div>
                    </div>
                `}
            </div>
            <form class="chat-input-form" onSubmit=${(e) => { e.preventDefault(); onSendMessage(); }}>
                <textarea
                    value=${chatInput.value}
                    onInput=${(e) => (chatInput.value = e.target.value)}
                    placeholder="اطرح سؤالاً حول المستند..."
                    disabled=${isChatting.value}
                    onKeyDown=${(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            onSendMessage();
                        }
                    }}
                ></textarea>
                <button type="submit" disabled=${isChatting.value || !chatInput.value.trim()}>إرسال</button>
            </form>
        </div>
    `;
};

const QuizView = () => {

    const handleStartQuiz = async () => {
        if (!documentSource.value) return;
        quizStatus.value = 'generating';
        quizError.value = '';
        
        const prompt = `You are an AI assistant tasked with creating a quiz.
**TASK:** Based *only* on the provided document text, generate an array of 10 multiple-choice questions.
**CRITICAL RULES:**
1.  Output must be a single, valid JSON array. Do not include any other text, explanations, or markdown.
2.  Each object in the array must have this exact structure: \`{ "question": "...", "options": ["...", "...", "...", "..."], "correctAnswer": "..." }\`.
3.  The \`correctAnswer\` value must be one of the strings from the \`options\` array.
4.  Questions must be diverse and cover different parts of the document.
5.  All questions must be in Arabic.
---
**Source Document:**
${documentSource.value}
---
Generate ONLY the JSON array.`;

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-preview-04-17',
                contents: prompt,
                config: { responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
            });

            const jsonText = extractJsonFromText(response.text);
            const questions = JSON.parse(jsonText);
            
            if (!Array.isArray(questions) || questions.length === 0) {
                throw new Error("لم يتم إنشاء أسئلة صالحة.");
            }
            quizQuestions.value = questions;
            currentQuestionIndex.value = 0;
            userAnswers.value = [];
            quizStatus.value = 'active';

        } catch (e) {
            console.error("Quiz generation error:", e);
            quizError.value = "عذرًا، فشل إنشاء الاختبار. يرجى المحاولة مرة أخرى.";
            quizStatus.value = 'error';
        }
    };
    
    const handleAnswerSelect = (answer) => {
        userAnswers.value = [...userAnswers.value, answer];
        if (currentQuestionIndex.value < quizQuestions.value.length - 1) {
            currentQuestionIndex.value++;
        } else {
            quizStatus.value = 'finished';
        }
    };

    const handleResetQuiz = () => {
        quizStatus.value = 'idle';
        quizQuestions.value = [];
        currentQuestionIndex.value = 0;
        userAnswers.value = [];
        quizError.value = '';
    };

    const handleExportResults = () => {
        const score = userAnswers.value.reduce((total, answer, index) => {
            return answer === quizQuestions.value[index].correctAnswer ? total + 1 : total;
        }, 0);

        let content = `نتائج الاختبار\n`;
        content += `====================\n`;
        content += `النتيجة النهائية: ${score} / ${quizQuestions.value.length}\n\n`;

        quizQuestions.value.forEach((q, index) => {
            const userAnswer = userAnswers.value[index];
            const isCorrect = userAnswer === q.correctAnswer;
            content += `------------------------------------\n`;
            content += `السؤال ${index + 1}: ${q.question}\n`;
            content += `> إجابتك: ${userAnswer} ${isCorrect ? '✅ (صحيحة)' : '❌ (خاطئة)'}\n`;
            if (!isCorrect) {
                content += `> الإجابة الصحيحة: ${q.correctAnswer}\n`;
            }
            content += '\n';
        });

        downloadFile('quiz_results.txt', content, 'text/plain;charset=utf-8');
    };


    // Render logic based on quizStatus
    if (!documentSource.value) {
        return html`
            <div class="disabled-view">
                <h3>اختبار سريع</h3>
                <p>يرجى تحميل ملف أو إدخال نص في تبويب "تحليل وإنشاء" أولاً لتفعيل الاختبار.</p>
            </div>
        `;
    }

    if (quizStatus.value === 'error') {
        return html`
            <div class="quiz-view">
                <div class="error">${quizError.value}</div>
                <button onClick=${handleResetQuiz} style=${{marginTop: '1rem'}}>حاول مجددًا</button>
            </div>
        `;
    }

    if (quizStatus.value === 'generating') {
        return html`
            <div class="quiz-view">
                <div class="loader-container">
                    <div class="loader"></div>
                    <p class="loading-text">جاري إعداد الاختبار من المستند...</p>
                </div>
            </div>
        `;
    }

    if (quizStatus.value === 'active' && quizQuestions.value.length > 0) {
        const currentQuestion = quizQuestions.value[currentQuestionIndex.value];
        return html`
            <div class="quiz-question-container">
                <p class="quiz-progress">السؤال ${currentQuestionIndex.value + 1} من ${quizQuestions.value.length}</p>
                <h3 class="quiz-question-text">${currentQuestion.question}</h3>
                <div class="quiz-options">
                    ${currentQuestion.options.map(option => html`
                        <button class="quiz-option" onClick=${() => handleAnswerSelect(option)}>${option}</button>
                    `)}
                </div>
            </div>
        `;
    }
    
    if (quizStatus.value === 'finished') {
        const score = userAnswers.value.reduce((total, answer, index) => {
            return answer === quizQuestions.value[index].correctAnswer ? total + 1 : total;
        }, 0);

        return html`
            <div class="quiz-results-view">
                <h3>اكتمل الاختبار!</h3>
                <p class="score">النتيجة النهائية: ${score} / ${quizQuestions.value.length}</p>
                 <ul class="quiz-results-summary">
                    ${quizQuestions.value.map((q, index) => {
                        const userAnswer = userAnswers.value[index];
                        const isCorrect = userAnswer === q.correctAnswer;
                        return html`
                            <li class="quiz-result-item">
                                <p class="result-item-question">${index + 1}. ${q.question}</p>
                                <p>
                                    <span class="result-item-answer user-answer ${isCorrect ? 'correct' : 'incorrect'}">
                                        إجابتك: ${userAnswer}
                                    </span>
                                    ${!isCorrect && html`
                                        <span class="result-item-answer correct-answer">
                                            الإجابة الصحيحة: ${q.correctAnswer}
                                        </span>
                                    `}
                                </p>
                            </li>
                        `;
                    })}
                </ul>
                <div class="export-container">
                    <button onClick=${handleExportResults} class="clear-btn">تصدير النتائج (TXT)</button>
                    <button onClick=${handleResetQuiz}>إعادة الاختبار</button>
                </div>
            </div>
        `;
    }

    // Default 'idle' state
    return html`
        <div class="quiz-view">
            <h3>اختبر معلوماتك</h3>
            <p>انقر أدناه لبدء اختبار قصير مكون من 10 أسئلة تم إنشاؤها بواسطة الذكاء الاصطناعي بناءً على محتوى المستند الذي قمت بتحميله.</p>
            <button onClick=${handleStartQuiz}>بدء الاختبار</button>
        </div>
    `;
};

const OptimizationView = () => {

    const handleGenerateOptimizations = async () => {
        optimizationStatus.value = 'generating';
        optimizationSuggestions.value = [];

        const prompt = `
أنت مستشار خبير في تحسين العمليات الإدارية (Business Process Optimization). مهمتك هي تحليل الإجراء الموصوف وتقديم اقتراحات ملموسة لتحسينه.

**التعليمات الحاسمة:**
1.  قم بتحليل النص المصدر الكامل وخطوات العملية المستخلصة منه.
2.  حدد نقاط الضعف المحتملة، مثل:
    *   **نقاط الاختناق (Bottlenecks):** خطوات قد تسبب تأخيرًا.
    *   **الخطوات اليدوية (Manual Steps):** مهام يمكن أتمتتها.
    *   **الخطوات الزائدة عن الحاجة (Redundancies):** تكرار لا لزوم له.
    *   **فرص الدمج (Consolidation):** خطوات يمكن دمجها لزيادة الكفاءة.
3.  قم بإنشاء قائمة من 3 إلى 5 اقتراحات عملية وقابلة للتنفيذ.
4.  المخرج النهائي **يجب** أن يكون مصفوفة JSON صالحة فقط، باللغة العربية. لا تقم بتضمين أي نص أو شروحات أو علامات markdown.
5.  يجب أن يتبع كل كائن في المصفوفة هذا الهيكل بالضبط: \`{ "title": "عنوان الاقتراح", "suggestion": "شرح مفصل للاقتراح وكيفية تطبيقه." }\`.

---
**النص المصدر الكامل (للسياق):**
${documentSource.value}

**خطوات العملية المستخلصة:**
${JSON.stringify(summaryData.value?.steps, null, 2)}
---
الآن، قم بإنشاء مصفوفة JSON فقط تحتوي على اقتراحات التحسين باللغة العربية.`;
        
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-preview-04-17',
                contents: prompt,
                config: { responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
            });
            const jsonText = extractJsonFromText(response.text);
            const suggestions = JSON.parse(jsonText);
            
            if (!Array.isArray(suggestions) || suggestions.length === 0) {
                throw new Error("لم يتم إنشاء اقتراحات صالحة.");
            }
            optimizationSuggestions.value = suggestions;
            optimizationStatus.value = 'success';

        } catch (e) {
            console.error("Optimization generation error:", e);
            optimizationStatus.value = 'error';
        }
    };
    
    if (status.value !== 'success') {
        return html`
            <div class="disabled-view">
                <h3>تحسين الإجراء</h3>
                <p>يرجى تحليل مستند بنجاح في تبويب "تحليل وإنشاء" أولاً لتفعيل هذه الميزة.</p>
            </div>
        `;
    }

    if (optimizationStatus.value === 'generating') {
        return html`
            <div class="optimization-view">
                 <div class="loader-container">
                    <div class="loader"></div>
                    <p class="loading-text">جاري تحليل الإجراء وابتكار حلول تحسينية...</p>
                </div>
            </div>
        `;
    }

    if (optimizationStatus.value === 'error') {
        return html`
            <div class="optimization-view">
                <div class="error">عذرًا، فشل في إنشاء اقتراحات التحسين.</div>
                <button onClick=${handleGenerateOptimizations} style=${{marginTop: '1rem'}}>حاول مجددًا</button>
            </div>
        `;
    }
    
    if (optimizationStatus.value === 'success') {
        return html`
            <div class="optimization-view" style=${{textAlign: 'right'}}>
                <h3>اقتراحات لتحسين الإجراء</h3>
                <p style=${{textAlign: 'center'}}>بناءً على التحليل، إليك بعض الاقتراحات التي قد تساهم في زيادة كفاءة سير العمل.</p>
                <div class="optimization-list">
                    ${optimizationSuggestions.value.map(item => html`
                        <div class="optimization-item">
                            <h4 class="optimization-title">${item.title}</h4>
                            <p class="optimization-suggestion">${item.suggestion}</p>
                        </div>
                    `)}
                </div>
                <div class="export-container">
                    <button onClick=${handleGenerateOptimizations} class="clear-btn">إعادة إنشاء الاقتراحات</button>
                </div>
            </div>
        `;
    }

    // Default 'idle' state
    return html`
        <div class="optimization-view">
            <h3>تحسين الإجراءات بواسطة الذكاء الاصطناعي</h3>
            <p>هل تريد أن يصبح هذا الإجراء أفضل؟ انقر أدناه ليقوم الذكاء الاصطناعي بدور استشاري ويقترح عليك طرقًا لتحسين سير العمل وتحديد نقاط الضعف وفرص الأتمتة.</p>
            <button onClick=${handleGenerateOptimizations}>تحليل واقتراح تحسينات</button>
        </div>
    `;
};


const loadStateFromLocalStorage = () => {
    try {
        const savedStateJSON = localStorage.getItem(APP_STATE_KEY);
        if (savedStateJSON) {
            const savedState = JSON.parse(savedStateJSON);
            
            // Set theme first as it affects rendering
            const savedTheme = savedState.theme || 'light';
            theme.value = savedTheme;
            document.body.className = savedTheme === 'dark' ? 'dark-theme' : '';
            
            activeTab.value = savedState.activeTab ?? 'generate';
            userInput.value = savedState.userInput ?? '';
            pdfText.value = savedState.pdfText ?? '';
            pdfFileName.value = savedState.pdfFileName ?? '';
            flowchartSvg.value = savedState.flowchartSvg ?? '';
            summaryData.value = savedState.summaryData ?? null;
            tableOfContents.value = savedState.tableOfContents ?? null;
            documentSource.value = savedState.documentSource ?? '';
            topQuestions.value = savedState.topQuestions ?? [];
            chatHistory.value = savedState.chatHistory ?? [];
            quizQuestions.value = savedState.quizQuestions ?? [];
            optimizationSuggestions.value = savedState.optimizationSuggestions ?? [];

            // Set statuses based on loaded data
            if (documentSource.value) {
                if (summaryData.value) status.value = 'success';
                else status.value = 'idle';
                
                if (topQuestions.value.length > 0) qaStatus.value = 'success';
                else qaStatus.value = 'idle';
                
                if (quizQuestions.value.length > 0) quizStatus.value = 'idle';
                else quizStatus.value = 'idle';

                if (optimizationSuggestions.value.length > 0) optimizationStatus.value = 'success';
                else optimizationStatus.value = 'idle';
            }
        }
    } catch (e) {
        console.warn("Could not load or parse state from localStorage:", e);
        localStorage.removeItem(APP_STATE_KEY); // Clear potentially corrupted state
    }
};

const initializeApp = () => {
    loadStateFromLocalStorage();

    // Effect to auto-save state to localStorage whenever a relevant signal changes
    effect(() => {
        // Apply theme class to body
        document.body.className = theme.value === 'dark' ? 'dark-theme' : '';

        try {
            const stateToSave = {
                theme: theme.value,
                activeTab: activeTab.value,
                userInput: userInput.value,
                pdfText: pdfText.value,
                pdfFileName: pdfFileName.value,
                flowchartSvg: flowchartSvg.value,
                summaryData: summaryData.value,
                tableOfContents: tableOfContents.value,
                documentSource: documentSource.value,
                topQuestions: topQuestions.value,
                chatHistory: chatHistory.value,
                quizQuestions: quizQuestions.value,
                optimizationSuggestions: optimizationSuggestions.value,
            };
            localStorage.setItem(APP_STATE_KEY, JSON.stringify(stateToSave));
        } catch (e) {
            console.warn("Could not save state to localStorage:", e);
        }
    });

    const container = document.getElementById('app');
    if (container) {
      render(html`<${App} />`, container);
    } else {
      console.error('App container #app not found');
    }
};

initializeApp();
