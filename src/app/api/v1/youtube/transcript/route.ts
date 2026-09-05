import { createLogger } from '@/lib/logging/logger';

const log = createLogger('AppApiV1YoutubeTranscript');

import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextResponse } from 'next/server';
import { processYoutubeTranscript, TranscriptExtractionError } from '@/lib/youtube/transcriptParser';
import { guardPermission } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

// The audio-transcription fallback (download + Gemini Files API upload +
// processing + generation) can take several minutes on long videos.
export const maxDuration = 300;

export const POST = withAuthAndRateLimit(async (req, authCtx, props) => {
  try {
    const denied = await guardPermission(authCtx, 'sources:write');
    if (denied) return denied;

    const { url, lang = 'ar' } = await req.json();

    const result = await processYoutubeTranscript(url, lang);
    return NextResponse.json(result);
  } catch (error: any) {
    log.error('YouTube transcript route error:', error);

    // Typed extraction failures carry a machine-readable code — no fragile
    // substring matching on Arabic message text.
    if (error instanceof TranscriptExtractionError) {
      const status = error.code === 'INVALID_URL' ? 400 : 422;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }

    return NextResponse.json(
      { error: 'حدث خطأ أثناء معالجة تفريغ فيديو يوتيوب', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
});
