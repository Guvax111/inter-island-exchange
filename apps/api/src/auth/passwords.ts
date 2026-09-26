import { Algorithm, hash, verify } from '@node-rs/argon2';

// OWASP-recommended argon2id parameters (19 MiB, 2 iterations, 1 lane).
const OPTIONS = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password: string) => hash(password, OPTIONS);
export const verifyPassword = (passwordHash: string, password: string) => verify(passwordHash, password);

/** Pre-computed hash so unknown-email logins take as long as real ones. */
let dummyHash: Promise<string> | undefined;
export const dummyPasswordHash = () => (dummyHash ??= hashPassword('not-a-real-password-placeholder'));
