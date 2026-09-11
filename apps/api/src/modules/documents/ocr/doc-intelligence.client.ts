import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AppConfigService } from '../../../config/config.module';

/** The text + key fields extracted from a document. */
export interface DocExtractionResult {
  text: string;
  fields: Record<string, string>;
}

/**
 * Minimal Azure Document Intelligence client for text/field extraction.
 *
 * Deliberately dependency-free (same posture as the Microsoft Graph client): it
 * calls the REST "analyze" long-running operation over `fetch` and polls the
 * returned Operation-Location until it completes. `prebuilt-read` returns the
 * document's text; `prebuilt-document`/layout additionally returns key-value
 * pairs used to pre-fill fields.
 *
 * Inert until DOC_AI_ENDPOINT + DOC_AI_KEY are configured; callers check
 * {@link configured} first and treat this as best-effort (never block an upload).
 */
@Injectable()
export class DocIntelligenceClient {
  constructor(private readonly config: AppConfigService) {}

  get configured(): boolean {
    return Boolean(this.config.get('DOC_AI_ENDPOINT') && this.config.get('DOC_AI_KEY'));
  }

  private endpoint(): string {
    return (this.config.get('DOC_AI_ENDPOINT') ?? '').replace(/\/$/, '');
  }

  /**
   * Run the configured prebuilt model over the given bytes and return the
   * extracted text and key fields. Throws {@link ServiceUnavailableException} on
   * any transport/timeout error so the caller can record a `failed` status.
   */
  async analyze(bytes: Buffer, contentType: string): Promise<DocExtractionResult> {
    const key = this.config.get('DOC_AI_KEY');
    if (!this.configured || !key) {
      throw new ServiceUnavailableException('Document Intelligence is not configured.');
    }
    const model = this.config.get('DOC_AI_MODEL');
    const apiVersion = this.config.get('DOC_AI_API_VERSION');
    const analyzeUrl =
      `${this.endpoint()}/documentintelligence/documentModels/${encodeURIComponent(model)}` +
      `:analyze?api-version=${encodeURIComponent(apiVersion)}`;

    const submit = await fetch(analyzeUrl, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'content-type': contentType || 'application/octet-stream',
      },
      body: new Uint8Array(bytes),
    });
    if (submit.status !== 202) {
      const detail = await submit.text().catch(() => '');
      throw new ServiceUnavailableException(
        `Document Intelligence analyze failed (${submit.status}). ${detail.slice(0, 200)}`,
      );
    }
    const opLocation = submit.headers.get('operation-location');
    if (!opLocation) {
      throw new ServiceUnavailableException(
        'Document Intelligence returned no operation location.',
      );
    }

    const deadline = Date.now() + this.config.get('DOC_AI_TIMEOUT_SECONDS') * 1000;
    // Poll the long-running operation until terminal or timeout.
    for (;;) {
      await sleep(1500);
      const poll = await fetch(opLocation, { headers: { 'Ocp-Apim-Subscription-Key': key } });
      if (!poll.ok) {
        const detail = await poll.text().catch(() => '');
        throw new ServiceUnavailableException(
          `Document Intelligence poll failed (${poll.status}). ${detail.slice(0, 200)}`,
        );
      }
      const json = (await poll.json()) as AnalyzeOperation;
      if (json.status === 'succeeded') return mapResult(json);
      if (json.status === 'failed') {
        throw new ServiceUnavailableException('Document Intelligence could not read the document.');
      }
      if (Date.now() > deadline) {
        throw new ServiceUnavailableException('Document Intelligence timed out.');
      }
    }
  }
}

interface AnalyzeOperation {
  status: 'notStarted' | 'running' | 'succeeded' | 'failed';
  analyzeResult?: {
    content?: string;
    keyValuePairs?: Array<{ key?: { content?: string }; value?: { content?: string } }>;
  };
}

function mapResult(op: AnalyzeOperation): DocExtractionResult {
  const text = op.analyzeResult?.content ?? '';
  const fields: Record<string, string> = {};
  for (const pair of op.analyzeResult?.keyValuePairs ?? []) {
    const k = pair.key?.content?.trim();
    const v = pair.value?.content?.trim();
    if (k && v) fields[k] = v;
  }
  return { text, fields };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
