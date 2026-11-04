import { sameKey, vapidKeyBytes } from '../push';

describe('web push keys', () => {
  it('reads a base64url VAPID key into bytes, padding or not', () => {
    // 0xfb 0xff 0xbf → "-_-_" in base64url ("+/+/" in base64).
    expect([...vapidKeyBytes('-_-_')]).toEqual([0xfb, 0xff, 0xbf]);
    expect([...vapidKeyBytes('AQID')]).toEqual([1, 2, 3]);
    expect([...vapidKeyBytes('AQIDBA')]).toEqual([1, 2, 3, 4]);
    expect(vapidKeyBytes('B' + 'A'.repeat(86)).length).toBe(65); // a P-256 public key
  });

  it('tells whether a subscription was made with the server’s current key', () => {
    const key = new Uint8Array([1, 2, 3]);
    expect(sameKey(new Uint8Array([1, 2, 3]).buffer, key)).toBe(true);
    expect(sameKey(new Uint8Array([1, 2, 4]).buffer, key)).toBe(false);
    expect(sameKey(new Uint8Array([1, 2]).buffer, key)).toBe(false);
    expect(sameKey(null, key)).toBe(false);
  });
});
