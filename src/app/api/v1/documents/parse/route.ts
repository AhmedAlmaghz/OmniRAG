import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export const dynamic = 'force-dynamic';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

export async function POST(req: NextRequest) {
  try {
    const { fileName, fileData, mimeType, model: requestedModel } = await req.json();

    if (!fileData) {
      return NextResponse.json({ error: 'محتوى الملف مطلوب' }, { status: 400 });
    }

    let parseModel = requestedModel;
    if (!parseModel) {
      const customConfigHeader = req.headers.get('x-ai-model-config');
      if (customConfigHeader) {
        try {
          const parsed = JSON.parse(customConfigHeader);
          parseModel = parsed.documentParseModel;
        } catch {}
      }
    }
    if (!parseModel) {
      parseModel = 'gemini-3.6-flash';
    }

    let extractedText = '';

    const isPdf = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      // Clean base64 prefix if present
      const cleanBase64 = fileData.replace(/^data:application\/pdf;base64,/, '');

      const response = await ai.models.generateContent({
        model: parseModel,
        contents: [
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: cleanBase64,
            },
          },
          'Extract and transcribe the full text content from this document. Preserve the logical document layout, headings, tables, paragraphs, list items, and order. If the content is in Arabic, extract it carefully with perfect Arabic spelling and punctuation without any scrambled characters or errors. Output only the extracted document text directly.',
        ],
      });

      extractedText = response.text || '';
    } else {
      // Decode standard text/md files, or send binary to Gemini
      const isText = mimeType.startsWith('text/') || 
                     fileName.toLowerCase().endsWith('.txt') || 
                     fileName.toLowerCase().endsWith('.md') || 
                     fileName.toLowerCase().endsWith('.json') ||
                     fileName.toLowerCase().endsWith('.csv');

      if (isText) {
        const cleanBase64 = fileData.split(',')[1] || fileData;
        extractedText = Buffer.from(cleanBase64, 'base64').toString('utf-8');
      } else {
        // Fallback for other binary formats (DOCX, etc.) using Gemini
        const cleanBase64 = fileData.split(',')[1] || fileData;
        const response = await ai.models.generateContent({
          model: parseModel,
          contents: [
            {
              inlineData: {
                mimeType: mimeType || 'application/octet-stream',
                data: cleanBase64,
              },
            },
            'Extract and transcribe all readable text from this file. Output only the extracted document text directly.',
          ],
        });
        extractedText = response.text || '';
      }
    }

    return NextResponse.json({ text: extractedText });
  } catch (error: any) {
    console.error('Error parsing document with Gemini:', error);
    return NextResponse.json({ error: error.message || 'فشل استخراج النص من المستند' }, { status: 500 });
  }
}
