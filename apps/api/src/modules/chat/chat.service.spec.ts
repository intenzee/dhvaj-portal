import {
  chatAttachmentAllowed,
  chatPreview,
  chatTick,
  lastSeenLabel,
  type ChatMessage,
} from '@hsdg/contracts';
import { bytesMatchType, cleanFileName, fitsLive } from './chat.service';

describe('chat helpers', () => {
  it('shows one, two grey or two blue ticks', () => {
    expect(chatTick({ deliveredAt: null, readAt: null })).toBe('sent');
    expect(chatTick({ deliveredAt: '2026-11-05T10:00:00Z', readAt: null })).toBe('delivered');
    expect(chatTick({ deliveredAt: '2026-11-05T10:00:00Z', readAt: '2026-11-05T10:01:00Z' })).toBe(
      'read',
    );
  });

  it('says online, or last seen today / yesterday / on a date, in IST', () => {
    const now = new Date('2026-11-05T12:00:00Z'); // 17:30 IST
    expect(lastSeenLabel({ online: true, lastSeenAt: null }, now)).toBe('online');
    expect(lastSeenLabel({ online: false, lastSeenAt: null }, now)).toBe('');
    expect(lastSeenLabel({ online: false, lastSeenAt: '2026-11-05T08:35:00Z' }, now)).toBe(
      'last seen today at 2:05 pm',
    );
    expect(lastSeenLabel({ online: false, lastSeenAt: '2026-11-04T03:40:00Z' }, now)).toBe(
      'last seen yesterday at 9:10 am',
    );
    expect(lastSeenLabel({ online: false, lastSeenAt: '2026-11-03T12:30:00Z' }, now)).toBe(
      'last seen 3 Nov at 6:00 pm',
    );
    expect(lastSeenLabel({ online: false, lastSeenAt: '2025-12-31T20:00:00Z' }, now)).toBe(
      'last seen 1 Jan at 1:30 am',
    );
    expect(lastSeenLabel({ online: false, lastSeenAt: '2024-06-01T06:30:00Z' }, now)).toBe(
      'last seen 1 Jun 2024 at 12:00 pm',
    );
  });

  it('previews photos, voice notes and documents in the chat list', () => {
    const a = (kind: 'image' | 'voice' | 'document', extra = {}) => ({
      kind,
      fileName: 'Form 16.pdf',
      contentType: 'application/pdf',
      sizeBytes: 10,
      durationMs: null,
      ...extra,
    });
    expect(chatPreview({ body: 'hi', attachment: null })).toBe('hi');
    expect(chatPreview({ body: '', attachment: a('image') })).toBe('📷 Photo');
    expect(chatPreview({ body: 'Challan', attachment: a('image') })).toBe('📷 Challan');
    expect(chatPreview({ body: '', attachment: a('voice', { durationMs: 75_400 }) })).toBe(
      '🎤 Voice message (1:15)',
    );
    expect(chatPreview({ body: '', attachment: a('document') })).toBe('📄 Form 16.pdf');
  });

  it('takes each kind’s file types only, ignoring codec parameters', () => {
    expect(chatAttachmentAllowed('voice', 'audio/webm;codecs=opus')).toBe(true);
    expect(chatAttachmentAllowed('image', 'IMAGE/JPEG')).toBe(true);
    expect(chatAttachmentAllowed('document', 'application/pdf')).toBe(true);
    expect(chatAttachmentAllowed('image', 'application/pdf')).toBe(false);
    expect(chatAttachmentAllowed('document', 'application/x-msdownload')).toBe(false);
    expect(chatAttachmentAllowed('document', 'text/html')).toBe(false);
  });

  it('checks the first bytes of PDFs and images', () => {
    expect(bytesMatchType(Buffer.from('%PDF-1.7'), 'application/pdf')).toBe(true);
    expect(bytesMatchType(Buffer.from('<html>'), 'application/pdf')).toBe(false);
    expect(bytesMatchType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg')).toBe(true);
    expect(bytesMatchType(Buffer.from([0x89, 0x50]), 'image/png')).toBe(false);
    expect(bytesMatchType(Buffer.from('anything'), 'text/csv')).toBe(true);
  });

  it('keeps a file name to its last part, without characters that break a header', () => {
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    expect(cleanFileName('C:\\Users\\x\\Form "16".pdf')).toBe('Form _16_.pdf');
    expect(cleanFileName('a\r\nb.txt')).toBe('a__b.txt');
    expect(cleanFileName('   ')).toBe('file');
  });

  it('carries short messages in the live event, not long ones', () => {
    const m = (body: string): ChatMessage => ({
      id: 'x',
      conversationId: 'c',
      senderId: 's',
      mine: false,
      body,
      attachment: null,
      clientRef: null,
      createdAt: '',
      deliveredAt: null,
      readAt: null,
      tick: 'sent',
    });
    expect(fitsLive(m('hello'))).toBe(true);
    expect(fitsLive(m('क'.repeat(4000)))).toBe(false);
  });
});
