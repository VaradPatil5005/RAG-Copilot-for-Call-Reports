import * as argon2 from "@node-rs/argon2";
export * from "./password-rules";

/**
 * Hashes a plaintext password using Argon2id with memory-hard parameters.
 * (Server-side only)
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    memoryCost: 65536, // 64 MB memory
    timeCost: 3,       // 3 iterations
    parallelism: 4,    // 4 threads
  });
}

/**
 * Verifies a plaintext password against an Argon2id hash.
 * (Server-side only)
 */
export async function verifyPassword(
  hash: string,
  plain: string
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
