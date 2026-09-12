import { hashPassword, comparePassword, hashPin, comparePin, generatePin } from '@/utils/password';

describe('password utils', () => {
  it('hashes a password and verifies the correct plaintext', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(hash).not.toBe('correct-horse-battery-staple');
    await expect(comparePassword('correct-horse-battery-staple', hash)).resolves.toBe(true);
  });

  it('rejects the wrong password against a hash', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    await expect(comparePassword('wrong-password', hash)).resolves.toBe(false);
  });

  it('hashes a valid 4-digit PIN and verifies it', async () => {
    const hash = await hashPin('0842');
    expect(hash).not.toBe('0842');
    await expect(comparePin('0842', hash)).resolves.toBe(true);
    await expect(comparePin('0000', hash)).resolves.toBe(false);
  });

  it('rejects a PIN that is not exactly 4 digits', async () => {
    await expect(hashPin('123')).rejects.toThrow('PIN must be exactly 4 digits');
    await expect(hashPin('12345')).rejects.toThrow('PIN must be exactly 4 digits');
    await expect(hashPin('abcd')).rejects.toThrow('PIN must be exactly 4 digits');
  });

  it('generates a 4-digit numeric PIN', () => {
    for (let i = 0; i < 20; i += 1) {
      const pin = generatePin();
      expect(pin).toMatch(/^\d{4}$/);
    }
  });
});
