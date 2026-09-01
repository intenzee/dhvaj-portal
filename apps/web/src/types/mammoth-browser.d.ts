declare module 'mammoth/mammoth.browser' {
  interface ConvertResult {
    value: string;
    messages: unknown[];
  }
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<ConvertResult>;
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<ConvertResult>;
}
