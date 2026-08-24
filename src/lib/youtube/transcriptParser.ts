import { YoutubeTranscript } from 'youtube-transcript';
// @ts-expect-error — youtube-captions-scraper ships no bundled types
import { getSubtitles } from 'youtube-captions-scraper';
import ytdl from '@distube/ytdl-core';
import { transcribeWithGroqWhisper } from '../services/unstructuredService';

/**
 * Extracts standard 11-character YouTube video ID from various URL formats.
 */
function extractVideoId(url: string): string | null {
  if (!url) return null;
  const regExp = /^.*(?:youtu\.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.trim().match(regExp);
  return match && match[1].length === 11 ? match[1] : null;
}

/**
 * Extracts a JSON variable assignment from YouTube page HTML.
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

/**
 * Parses caption tracks directly from YouTube player initial response JSON.
 */
function extractCaptionsFromHtml(html: string, targetLang: string = 'ar'): any {
  try {
    const playerResponse = extractJsonFromHtml(html, 'ytInitialPlayerResponse');
    if (!playerResponse) return null;

    const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captionTracks || !Array.isArray(captionTracks) || captionTracks.length === 0) return null;

    let selectedTrack = captionTracks.find((track: any) => track.languageCode === targetLang);
    if (!selectedTrack) selectedTrack = captionTracks.find((track: any) => track.languageCode?.startsWith(targetLang));
    if (!selectedTrack) selectedTrack = captionTracks.find((track: any) => track.languageCode === 'en');
    if (!selectedTrack) selectedTrack = captionTracks.find((track: any) => track.languageCode?.startsWith('en'));
    if (!selectedTrack) selectedTrack = captionTracks[0];

    return selectedTrack;
  } catch (e) {
    return null;
  }
}

/**
 * Fetches and parses raw XML captions from YouTube's caption track URL.
 */
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
      text = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');
      if (text) {
        const totalSecs = Math.floor(parseFloat(match[1]));
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        captions.push(`[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}] ${text}`);
      }
    }
    return captions.length > 0 ? captions.join('\n') : null;
  } catch (e) {
    return null;
  }
}

/**
 * Strategy 1: Professional youtube-transcript dependency
 */
async function fetchWithYoutubeTranscriptPackage(
  videoId: string,
  lang: string,
): Promise<{ text: string; method: string } | null> {
  try {
    if (lang) {
      try {
        const res = await YoutubeTranscript.fetchTranscript(videoId, { lang });
        if (res && res.length > 0) {
          const formatted = res
            .map((item) => {
              const totalSecs = Math.floor(item.offset / 1000);
              const mins = Math.floor(totalSecs / 60);
              const secs = totalSecs % 60;
              const timeStr = `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
              const cleanText = item.text
                .replace(/&amp;/g, '&')
                .replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"')
                .trim();
              return `${timeStr} ${cleanText}`;
            })
            .join('\n');
          return { text: formatted, method: `youtube-transcript (${lang})` };
        }
      } catch (errLang) {
        // Fallback if target lang fails
      }
    }

    try {
      const res = await YoutubeTranscript.fetchTranscript(videoId);
      if (res && res.length > 0) {
        const formatted = res
          .map((item) => {
            const totalSecs = Math.floor(item.offset / 1000);
            const mins = Math.floor(totalSecs / 60);
            const secs = totalSecs % 60;
            const timeStr = `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
            const cleanText = item.text
              .replace(/&amp;/g, '&')
              .replace(/&#39;/g, "'")
              .replace(/&quot;/g, '"')
              .trim();
            return `${timeStr} ${cleanText}`;
          })
          .join('\n');
        return { text: formatted, method: 'youtube-transcript (default)' };
      }
    } catch (errDef) {
      // Fallback if default fails
    }

    if (lang !== 'en') {
      try {
        const res = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
        if (res && res.length > 0) {
          const formatted = res
            .map((item) => {
              const totalSecs = Math.floor(item.offset / 1000);
              const mins = Math.floor(totalSecs / 60);
              const secs = totalSecs % 60;
              const timeStr = `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
              const cleanText = item.text
                .replace(/&amp;/g, '&')
                .replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"')
                .trim();
              return `${timeStr} ${cleanText}`;
            })
            .join('\n');
          return { text: formatted, method: 'youtube-transcript (en)' };
        }
      } catch (errEn) {
        // Ignored
      }
    }
  } catch (e) {
    // Strategy 1 failed
  }
  return null;
}

/**
 * Strategy 2: youtube-captions-scraper dependency
 */
async function fetchWithCaptionsScraper(
  videoId: string,
  lang: string,
): Promise<{ text: string; method: string } | null> {
  try {
    const langsToTry = [lang, 'ar', 'en'].filter((v, i, a) => v && a.indexOf(v) === i);
    for (const l of langsToTry) {
      try {
        const captions = await getSubtitles({ videoID: videoId, lang: l });
        if (captions && captions.length > 0) {
          const formatted = captions
            .map((c: any) => {
              const totalSecs = Math.floor(parseFloat(c.start));
              const mins = Math.floor(totalSecs / 60);
              const secs = totalSecs % 60;
              const timeStr = `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
              const cleanText = (c.text || '')
                .replace(/&amp;/g, '&')
                .replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"')
                .trim();
              return `${timeStr} ${cleanText}`;
            })
            .join('\n');
          return { text: formatted, method: `youtube-captions-scraper (${l})` };
        }
      } catch (err) {
        // Try next language
      }
    }
  } catch (e) {
    // Strategy 2 failed
  }
  return null;
}

/**
 * Typed extraction failure. Carries a machine-readable `code` so API routes
 * can map it to the right HTTP status WITHOUT substring-matching Arabic
 * message text (the old `'صحيح'.includes()` heuristic).
 */
export class TranscriptExtractionError extends Error {
  code: string;
  constructor(message: string, code: string = 'TRANSCRIPT_UNAVAILABLE') {
    super(message);
    this.name = 'TranscriptExtractionError';
    this.code = code;
  }
}

/**
 * Downloads audio stream of a YouTube video as a Buffer.
 */
async function downloadYoutubeAudio(videoId: string): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  console.log(`[YouTube Downloader] Starting audio-only stream download for video ID: ${videoId}...`);

  const stream = ytdl(url, {
    filter: 'audioonly',
    quality: 'lowestaudio',
  });

  const chunks: any[] = [];
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      stream.destroy();
      reject(new Error('YouTube audio download timed out after 35 seconds'));
    }, 35000);

    stream.on('data', (chunk) => {
      chunks.push(chunk);
    });

    stream.on('end', () => {
      clearTimeout(timeout);
      const buffer = Buffer.concat(chunks);
      console.log(
        `[YouTube Downloader] Audio download complete! Buffer size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`,
      );
      resolve({
        buffer,
        fileName: `${videoId}.m4a`,
        mimeType: 'audio/mp4',
      });
    });

    stream.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Main YouTube Transcript extraction processor.
 *
 * Extraction ladder (real sources only, in order of reliability):
 *   1. `youtube-transcript` package captions
 *   2. `youtube-captions-scraper` captions
 *   3. YouTube Player-Response XML caption track
 *   4. Groq Whisper transcription of the downloaded audio (needs GROQ_API_KEY)
 *
 * When NONE of them yields text the function THROWS a
 * {@link TranscriptExtractionError} — it never generates an AI-invented
 * "transcript" from the video title/description, because fabricated text
 * indexed as ground truth poisons retrieval and misleads users.
 */
export async function processYoutubeTranscript(url: string, lang: string = 'ar') {
  if (!url) {
    throw new TranscriptExtractionError('يرجى تقديم رابط فيديو يوتيوب صحيح (YouTube Video URL)', 'INVALID_URL');
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new TranscriptExtractionError(
      'رابط فيديو يوتيوب غير صالح. يُرجى استخدام تنسيق مثل: https://www.youtube.com/watch?v=VIDEO_ID',
      'INVALID_URL',
    );
  }

  const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
  let videoTitle = `فيديو يوتيوب (${videoId})`;
  let channelName = 'YouTube Video';
  let durationStr = 'غير محدد';
  let videoDescription = '';
  const thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  let transcriptText = '';
  let extractionMethod = 'none';
  let fetchedHtml = '';

  // 1. Fetch metadata from YouTube page
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
      const titleMatch = fetchedHtml.match(/<title>(.*?)<\/title>/i) || fetchedHtml.match(/"title":"(.*?)"/);
      if (titleMatch && titleMatch[1]) {
        videoTitle = titleMatch[1].replace(' - YouTube', '').trim();
      }
      const channelMatch = fetchedHtml.match(/"author":"(.*?)"/) || fetchedHtml.match(/"ownerChannelName":"(.*?)"/);
      if (channelMatch && channelMatch[1]) {
        channelName = channelMatch[1].trim();
      }

      const playerResponse = extractJsonFromHtml(fetchedHtml, 'ytInitialPlayerResponse');
      if (playerResponse && playerResponse.videoDetails) {
        videoTitle = playerResponse.videoDetails.title || videoTitle;
        channelName = playerResponse.videoDetails.author || channelName;
        videoDescription = playerResponse.videoDetails.shortDescription || '';
        const lengthSecs = parseInt(playerResponse.videoDetails.lengthSeconds || '0');
        if (lengthSecs > 0) {
          const m = Math.floor(lengthSecs / 60);
          const s = lengthSecs % 60;
          durationStr = `${m}:${s.toString().padStart(2, '0')}`;
        }
      }

      if (!videoDescription) {
        const descMatch = fetchedHtml.match(/<meta name="description" content="(.*?)"/i);
        if (descMatch && descMatch[1]) {
          videoDescription = descMatch[1].trim();
        }
      }
    }
  } catch (e) {
    console.warn('Warning: Could not fetch YouTube HTML metadata:', e);
  }

  // 2. Strategy 1: Try native youtube-transcript package first (fast, exact timestamps, not blocked by bot checks)
  if (!transcriptText) {
    const res1 = await fetchWithYoutubeTranscriptPackage(videoId, lang);
    if (res1 && res1.text && res1.text.trim().length > 0) {
      transcriptText = res1.text;
      extractionMethod = res1.method;
    }
  }

  // 3. Strategy 2: Try youtube-captions-scraper package if Strategy 1 failed
  if (!transcriptText) {
    const res2 = await fetchWithCaptionsScraper(videoId, lang);
    if (res2 && res2.text && res2.text.trim().length > 0) {
      transcriptText = res2.text;
      extractionMethod = res2.method;
    }
  }

  // 4. Strategy 3: Try HTML Player Response XML track parsing if Strategy 1 & 2 failed
  if (!transcriptText && fetchedHtml) {
    const track = extractCaptionsFromHtml(fetchedHtml, lang);
    if (track && track.baseUrl) {
      const parsedTranscript = await fetchAndParseXmlCaptions(track.baseUrl);
      if (parsedTranscript && parsedTranscript.trim().length > 0) {
        transcriptText = parsedTranscript;
        extractionMethod = 'YouTube Player XML Captions';
      }
    }
  }

  // 5. Strategy 4: Try Groq Whisper-3 Audio Extraction if native captions were not present and GROQ_API_KEY is configured
  const groqKey = process.env.GROQ_API_KEY;
  if (!transcriptText && groqKey) {
    try {
      const audioResult = await downloadYoutubeAudio(videoId);

      if (audioResult && audioResult.buffer && audioResult.buffer.length > 0) {
        if (audioResult.buffer.length > 25 * 1024 * 1024) {
          console.log(
            `[YouTube Transcription] Audio size ${(audioResult.buffer.length / 1024 / 1024).toFixed(2)}MB exceeds Whisper 25MB limit.`,
          );
        } else {
          const whisperResult = await transcribeWithGroqWhisper(
            audioResult.buffer,
            audioResult.fileName,
            audioResult.mimeType,
            groqKey,
          );
          if (whisperResult && whisperResult.success && whisperResult.text) {
            transcriptText = whisperResult.text;
            extractionMethod = 'Groq Whisper-3 (Audio Transcription ⚡)';
          }
        }
      }
    } catch (whisperError: any) {
      // Audio stream may be blocked by YouTube bot-detection in data-center IPs; silently proceed to AI Transcript Engine
      console.log(
        '[YouTube Transcription] Audio stream not directly extractable on this host, utilizing AI Transcription Engine...',
      );
    }
  }

  // 5. Honest failure: no captions and no transcribable audio available.
  // The previous fallback "generated a realistic timestamped transcript" with
  // Gemini and fabricated [mm:ss] stamps over the video description — that
  // invented text was then indexed as ground truth. We refuse instead.
  if (!transcriptText || transcriptText.trim().length === 0) {
    throw new TranscriptExtractionError(
      'لا يحتوي هذا الفيديو على ترجمات متاحة، وتعذر تنزيل الصوت للتفريغ الآلي. تأكد من أن الفيديو يدعم الترجمة (CC) أو فعّل مفتاح GROQ_API_KEY للتفريغ الصوتي.',
      'TRANSCRIPT_UNAVAILABLE',
    );
  }

  const words = transcriptText.trim().split(/\s+/).length;

  return {
    success: true,
    videoId,
    title: videoTitle,
    channel: channelName,
    duration: durationStr,
    thumbnail,
    videoUrl: targetUrl,
    transcript: transcriptText,
    wordCount: words,
    extractionMethod,
    extractedAt: new Date().toISOString(),
  };
}
