import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;

function deriveKey(
  password: string,
  salt: Buffer,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      {
        N: COST,
        r: BLOCK_SIZE,
        p: PARALLELIZATION,
        maxmem: 64 * 1024 * 1024,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      },
    );
  });
}

export async function hashPassword(
  password: string,
): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);

  return [
    "scrypt",
    String(COST),
    String(BLOCK_SIZE),
    String(PARALLELIZATION),
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  try {
    const parts = encodedHash.split("$");

    if (parts.length !== 6 || parts[0] !== "scrypt") {
      return false;
    }

    const cost = Number(parts[1]);
    const blockSize = Number(parts[2]);
    const parallelization = Number(parts[3]);
    const salt = Buffer.from(parts[4], "base64url");
    const expectedKey = Buffer.from(parts[5], "base64url");

    if (
      cost !== COST ||
      blockSize !== BLOCK_SIZE ||
      parallelization !== PARALLELIZATION ||
      salt.length !== 16 ||
      expectedKey.length !== KEY_LENGTH
    ) {
      return false;
    }

    const actualKey = await deriveKey(password, salt);

    return timingSafeEqual(actualKey, expectedKey);
  } catch {
    return false;
  }
}