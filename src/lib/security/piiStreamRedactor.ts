// Buffered PII redactor for streamed LLM output.
//
// The non-streaming chat/completions route runs the H9 PIIRedactor hook over
// the entire response as one string. The streaming chat/stream route emits the
// response delta-by-delta, which would otherwise bypass H9 entirely and ship
// raw emails/phone numbers to the client. This redactor applies the same email
// and phone patterns as H9 while streaming, but is robust to PII patterns that
// are split across text deltas.

// ---- Final-stage pattern set (mirrors H9 in src/lib/harness/hook-harness.ts) ----
const EMAIL_REDACT_G = /[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+/g;
const PHONE_REDACT_G = /(\+?\d{1,4}[\s-.]?)?\(?\d{3}\)?[\s-.]?\d{3}[\s-.]?\d{4}/g;

// ---- Streaming-stage pattern set ----
// During streaming we only redact a PII pattern when the next character IN the
// buffer proves the pattern has fully terminated (i.e., is not a character that
// the regex would have absorbed). Without this look-ahead, "user@example.com"
// could be redacted prematurely while "com" is still arriving over multiple
// chunks, and the trailing characters that "should have" been part of the match
// would leak to the next chunk un-redacted. Email TLD is `[a-zA-Z0-9._-]+`,
// phone ends in `\d{4}; we require a non-extension char to follow.
const EMAIL_STREAM_G = /[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+(?=[^a-zA-Z0-9._-])/g;
const PHONE_STREAM_G = /(\+?\d{1,4}[\s-.]?)?\(?\d{3}\)?[\s-.]?\d{3}[\s-.]?\d{4}(?=[^\d\s().+-])/g;

// Hold back this many trailing characters from emission. The largest PII
// pattern we recognize is an email (≤254 chars per RFC 3696); the hold-back
// ensures an in-flight PII pattern sitting at the tail of the buffer is not
// emitted before its terminating character arrives in a subsequent chunk.
const TAIL_HOLD_BACK = 256;

export interface PIIStreamRedactor {
  /** Append a streamed chunk and return any text safe to emit now. */
  push(chunk: string): string;
  /** Finalize the stream and return any remaining (redacted) text. */
  end(): string;
  /** Whether at least one PII pattern was redacted over the lifetime. */
  didRedact(): boolean;
}

export function createPIIStreamRedactor(): PIIStreamRedactor {
  let pendingTail = '';
  let redactedCount = 0;

  const redactStreaming = (text: string): string =>
    text.replace(EMAIL_STREAM_G, '[REDACTED:EMAIL]').replace(PHONE_STREAM_G, '[REDACTED:PHONE]');

  const redactFinal = (text: string): string =>
    text.replace(EMAIL_REDACT_G, '[REDACTED:EMAIL]').replace(PHONE_REDACT_G, '[REDACTED:PHONE]');

  return {
    push(chunk: string): string {
      pendingTail += chunk;
      // Redact any PII patterns that have fully terminated within pendingTail.
      const before = pendingTail;
      pendingTail = redactStreaming(pendingTail);
      if (pendingTail !== before) redactedCount += 1;
      // Emit text past the hold-back threshold; the tail is kept back so an
      // un-terminated PII pattern at the tail can never reach the client yet.
      if (pendingTail.length <= TAIL_HOLD_BACK) {
        return '';
      }
      const emitEnd = pendingTail.length - TAIL_HOLD_BACK;
      const emitText = pendingTail.slice(0, emitEnd);
      pendingTail = pendingTail.slice(emitEnd);
      return emitText;
    },
    end(): string {
      const before = pendingTail;
      const tail = redactFinal(pendingTail);
      if (tail !== before) redactedCount += 1;
      pendingTail = '';
      return tail;
    },
    didRedact(): boolean {
      return redactedCount > 0;
    },
  };
}
