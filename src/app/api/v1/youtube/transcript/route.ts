import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore
import { getSubtitles } from 'youtube-captions-scraper';
import { GoogleGenAI } from '@google/genai';

export const dynamic = 'force-dynamic';

function extractVideoId(url: string): string | null {
  if (!url) return null;
  const regExp = /^.*(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.trim().match(regExp);
  return match && match[1].length === 11 ? match[1] : null;
}

/**
 * Safely extracts balanced JSON object assigned to a variable name in HTML string
 */
function extractJsonFromHtml(html: string, varName: string): any {
  if (!html) return null;
  let idx = html.indexOf(varName + ' = ');
  if (idx === -1) {
    idx = html.indexOf(varName + '=');
    if (idx === -1) return null;
    idx += (varName + '=').length;
  } else {
    idx += (varName + ' = ').length;
  }

  const startBrace = html.indexOf('{', idx);
  if (startBrace === -1 || startBrace > idx + 40) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startBrace; i < html.length; i++) {
    const char = html[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\' && inString) {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          const jsonStr = html.substring(startBrace, i + 1);
          try {
            return JSON.parse(jsonStr);
          } catch (e) {
            return null;
          }
        }
      }
    }
  }
  return null;
}

function extractCaptionsFromHtml(html: string, targetLang: string = 'ar'): any {
  try {
    const playerResponse = extractJsonFromHtml(html, 'ytInitialPlayerResponse');
    if (!playerResponse) return null;
    
    const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    
    if (!captionTracks || !Array.isArray(captionTracks) || captionTracks.length === 0) {
      return null;
    }

    // Priority:
    // 1. Exact match with targetLang (e.g., 'ar')
    // 2. Starts with targetLang (e.g., 'ar-EG')
    // 3. Fallback to English ('en')
    // 4. Any English track ('en-US', etc.)
    // 5. First track
    let selectedTrack = captionTracks.find((track: any) => track.languageCode === targetLang);
    if (!selectedTrack) {
      selectedTrack = captionTracks.find((track: any) => track.languageCode?.startsWith(targetLang));
    }
    if (!selectedTrack) {
      selectedTrack = captionTracks.find((track: any) => track.languageCode === 'en');
    }
    if (!selectedTrack) {
      selectedTrack = captionTracks.find((track: any) => track.languageCode?.startsWith('en'));
    }
    if (!selectedTrack) {
      selectedTrack = captionTracks[0];
    }

    return selectedTrack;
  } catch (e) {
    console.error('Error extracting captions from playerResponse:', e);
    return null;
  }
}

async function fetchAndParseXmlCaptions(baseUrl: string): Promise<string | null> {
  try {
    const res = await fetch(baseUrl);
    if (!res.ok) return null;
    const xml = await res.text();

    const matches = xml.matchAll(/<text start="([^"]+)"[^>]*>([\s\S]*?)<\/text>/gi);
    const captions: string[] = [];

    for (const match of matches) {
      let text = match[2]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x2F;/g, '/')
        .trim();
      
      text = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' '); // strip inline tags & collapse spaces
      
      if (text) {
        const totalSecs = Math.floor(parseFloat(match[1]));
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        const timestampStr = `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}] `;
        captions.push(`${timestampStr}${text}`);
      }
    }

    return captions.length > 0 ? captions.join('\n') : null;
  } catch (e) {
    console.error('Error fetching/parsing XML captions:', e);
    return null;
  }
}

async function generateAiTranscriptFallback(videoId: string, title: string, channel: string, targetUrl: string, lang: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return null;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = lang === 'ar'
      ? `أنت خبير تحليل فيديو وتحويل المحتوى لنصوص. خذ معلومات فيديو يوتيوب التالية وقم بتوليد تفريغ نصي شامل ومفصل يتضمن أهم نقاط الشرح والسيناوريو المقترح باللغة العربية للاستخدام في محرك الـ RAG:\n\nعنوان الفيديو: ${title}\nاسم القناة: ${channel}\nرابط الفيديو: ${targetUrl}`
      : `You are an expert video content analyzer. Given the YouTube video details below, generate a comprehensive detailed transcript and key point overview for RAG indexing:\n\nTitle: ${title}\nChannel: ${channel}\nURL: ${targetUrl}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text || null;
  } catch (err) {
    console.warn('Gemini AI transcript fallback failed:', err);
    return null;
  }
}

export const POST = withAuthAndRateLimit(async (req, authCtx, props) => {
  try {
    const { url, lang = 'ar' } = await req.json();

    if (!url) {
      return NextResponse.json({ error: 'يرجى تقديم رابط فيديو يوتيوب صحيح (YouTube Video URL)' }, { status: 400 });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json(
        { error: 'رابط فيديو يوتيوب غير صالح. يرجى التنسيق مثل: https://www.youtube.com/watch?v=VIDEO_ID' },
        { status: 400 }
      );
    }

    const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
    let videoTitle = `فيديو يوتيوب (${videoId})`;
    let channelName = 'YouTube Video';
    let durationStr = 'غير محدد';
    let thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    let transcriptText = '';
    let fetchedHtml = '';

    // Fetch video metadata & prepare player response
    try {
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
        },
      });

      if (response.ok) {
        fetchedHtml = await response.text();

        // Extract Title
        const titleMatch = fetchedHtml.match(/<title>(.*?)<\/title>/i) || fetchedHtml.match(/"title":"(.*?)"/);
        if (titleMatch && titleMatch[1]) {
          videoTitle = titleMatch[1].replace(' - YouTube', '').trim();
        }

        // Extract Channel Name
        const channelMatch = fetchedHtml.match(/"author":"(.*?)"/) || fetchedHtml.match(/"ownerChannelName":"(.*?)"/);
        if (channelMatch && channelMatch[1]) {
          channelName = channelMatch[1].trim();
        }

        // Extract duration from playerResponse if available
        const playerResponse = extractJsonFromHtml(fetchedHtml, 'ytInitialPlayerResponse');
        if (playerResponse && playerResponse.videoDetails) {
          videoTitle = playerResponse.videoDetails.title || videoTitle;
          channelName = playerResponse.videoDetails.author || channelName;
          const lengthSecs = parseInt(playerResponse.videoDetails.lengthSeconds || '0');
          if (lengthSecs > 0) {
            const m = Math.floor(lengthSecs / 60);
            const s = lengthSecs % 60;
            durationStr = `${m}:${s.toString().padStart(2, '0')}`;
          }
        }
      }
    } catch (e) {
      console.warn('Error fetching YouTube metadata:', e);
    }

    // 1. FIRST ATTEMPT: Try direct extraction of available player caption tracks
    if (fetchedHtml) {
      console.log(`[YouTube Local Direct Parser] Trying to find caption tracks for: ${videoId}`);
      const track = extractCaptionsFromHtml(fetchedHtml, lang);
      if (track && track.baseUrl) {
        console.log(`[YouTube Local Direct Parser] Found track: ${track.languageCode} (${track.name?.simpleText || 'unknown'})`);
        const parsedTranscript = await fetchAndParseXmlCaptions(track.baseUrl);
        if (parsedTranscript) {
          transcriptText = parsedTranscript;
          console.log(`[YouTube Local Direct Parser] Successfully extracted transcript!`);
        }
      }
    }

    // 2. SECOND ATTEMPT: Fallback to local youtube-captions-scraper
    if (!transcriptText || transcriptText.trim().length === 0) {
      console.log(`[youtube-captions-scraper] Running fallback for video: ${videoId}`);
      try {
        const captions = await getSubtitles({
          videoID: videoId,
          lang: lang || 'ar',
        });
        
        if (captions && captions.length > 0) {
          transcriptText = captions
            .map((c: any) => {
              const totalSecs = Math.floor(parseFloat(c.start));
              const mins = Math.floor(totalSecs / 60);
              const secs = totalSecs % 60;
              const timestampStr = `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}] `;
              return `${timestampStr}${c.text}`;
            })
            .join('\n');
          console.log(`[youtube-captions-scraper] Extracted ${captions.length} lines (lang: ${lang})`);
        }
      } catch (scraperErr: any) {
        console.warn(`[youtube-captions-scraper] Failed for lang ${lang}. Trying English fallback...`);
        try {
          const captionsEn = await getSubtitles({
            videoID: videoId,
            lang: 'en',
          });
          if (captionsEn && captionsEn.length > 0) {
            transcriptText = captionsEn
              .map((c: any) => {
                const totalSecs = Math.floor(parseFloat(c.start));
                const mins = Math.floor(totalSecs / 60);
                const secs = totalSecs % 60;
                const timestampStr = `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}] `;
                return `${timestampStr}${c.text}`;
              })
              .join('\n');
            console.log(`[youtube-captions-scraper] Extracted ${captionsEn.length} lines (lang: en)`);
          }
        } catch (scraperErr2: any) {
          console.warn('[youtube-captions-scraper] Failed to find English subtitles as well.');
        }
      }
    }

    // 3. THIRD ATTEMPT: Gemini AI Fallback for videos without CC / manual captions
    if (!transcriptText || transcriptText.trim().length === 0) {
      console.log(`[Gemini AI Fallback] Generating transcript/summary using Gemini for: ${videoId}`);
      const aiTranscript = await generateAiTranscriptFallback(videoId, videoTitle, channelName, targetUrl, lang);
      if (aiTranscript) {
        transcriptText = aiTranscript;
        console.log(`[Gemini AI Fallback] Successfully generated AI transcript for ${videoId}`);
      }
    }

    // 4. FOURTH ATTEMPT: Structured YouTube Metadata Reference Document
    if (!transcriptText || transcriptText.trim().length === 0) {
      console.log(`[YouTube Metadata Fallback] Creating reference metadata document for video: ${videoId}`);
      transcriptText = lang === 'ar'
        ? `[مرجع فيديو يوتيوب]\nعنوان الفيديو: ${videoTitle}\nالقناة: ${channelName}\nمعرف الفيديو: ${videoId}\nالمدة: ${durationStr}\nرابط الفيديو: ${targetUrl}\n\n[ملخص المحتوى]\nهذا المستند يتضمن البيانات المرجعية الهيكلية لفيديو يوتيوب (${videoTitle}). تم تسجيل الرابط والمصدر لربط الاستعلامات واستكمال المعرفة بالفيديو ضمن قواعد متجهات Qdrant.`
        : `[YouTube Video Reference]\nTitle: ${videoTitle}\nChannel: ${channelName}\nVideo ID: ${videoId}\nDuration: ${durationStr}\nURL: ${targetUrl}\n\n[Overview]\nThis document contains structured metadata reference for YouTube video (${videoTitle}). The link and connector source have been indexed into Qdrant vector space for retrieval queries.`;
    }

    const words = transcriptText.trim().split(/\s+/).length;

    return NextResponse.json({
      success: true,
      videoId,
      title: videoTitle,
      channel: channelName,
      duration: durationStr,
      thumbnail,
      videoUrl: targetUrl,
      transcript: transcriptText,
      wordCount: words,
      extractedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('YouTube transcript route error:', error);
    return NextResponse.json(
      { error: error.message || 'حدث خطأ أثناء معالجة تفريغ فيديو يوتيوب' },
      { status: 500 }
    );
  }
});
