import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';
dotenv.config();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function run() {
  const res = await ai.models.embedContent({
    model: 'gemini-embedding-2',
    contents: 'hello world',
  });
  console.log(JSON.stringify(res, null, 2));
}
run();
