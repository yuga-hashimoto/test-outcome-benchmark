import { InfrastructureError, RequestTimeoutError } from '@tob/core';
import { isRetryableStatus } from './http';
import type { JsonRequest } from './http';

/**
 * Minimal server-sent-events reader.
 *
 * Streaming exists here for one reason: time-to-first-token is only observable
 * on a streamed response. Everything else could be done with a single JSON
 * round trip.
 */
export const postSse = async (
  request: JsonRequest,
  onEvent: (event: { event: string | null; data: string }) => void,
): Promise<void> => {
  const timeoutSignal = AbortSignal.timeout(request.timeoutMs);
  const signal = AbortSignal.any([request.signal, timeoutSignal]);

  let response: Response;
  try {
    response = await fetch(request.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...request.headers },
      body: JSON.stringify(request.body),
      signal,
    });
  } catch (error) {
    if (timeoutSignal.aborted) throw new RequestTimeoutError(request.timeoutMs);
    if (request.signal.aborted) throw error;
    throw new InfrastructureError(
      `Network error streaming from ${request.url}: ${error instanceof Error ? error.message : String(error)}`,
      { code: 'NETWORK', cause: error },
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new InfrastructureError(
      `${response.status} ${response.statusText} from ${request.url}: ${body.slice(0, 500)}`,
      {
        status: response.status,
        code: String(response.status),
        retryable: isRetryableStatus(response.status),
      },
    );
  }

  if (response.body === null) {
    throw new InfrastructureError('Provider returned an empty stream', {
      code: 'EMPTY_STREAM',
    });
  }

  const decoder = new TextDecoder();
  let buffer = '';

  const flushBlock = (block: string): void => {
    let eventName: string | null = null;
    const dataLines: string[] = [];

    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }

    if (dataLines.length > 0) onEvent({ event: eventName, data: dataLines.join('\n') });
  };

  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });

      let separator = buffer.indexOf('\n\n');
      while (separator !== -1) {
        flushBlock(buffer.slice(0, separator));
        buffer = buffer.slice(separator + 2);
        separator = buffer.indexOf('\n\n');
      }
    }
  } catch (error) {
    if (timeoutSignal.aborted) throw new RequestTimeoutError(request.timeoutMs);
    if (request.signal.aborted) throw error;
    throw new InfrastructureError(
      `Stream interrupted: ${error instanceof Error ? error.message : String(error)}`,
      { code: 'STREAM_INTERRUPTED', cause: error },
    );
  }

  if (buffer.trim().length > 0) flushBlock(buffer);
};
