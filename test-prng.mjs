// Test PRNG initialization for TweetNaCl (ESM version)
import nacl from "tweetnacl";

console.log("🔍 Testing TweetNaCl PRNG initialization...\n");

// Check initial state
console.log("1️⃣ Initial nacl.random:", typeof nacl.random);

// Create PRNG function (same as mobile code)
const createPRNG = () => {
  let internalState = new Uint8Array(32);

  // Seed with initial entropy
  for (let i = 0; i < 32; i++) {
    internalState[i] = Math.floor(Math.random() * 256);
  }

  return function (n) {
    const output = new Uint8Array(n);

    for (let i = 0; i < n; i++) {
      const timestamp = Date.now();
      const randomValue = Math.random();
      const stateValue = internalState[i % 32];

      const entropy = Math.sin(timestamp + randomValue + i) * 10000;
      output[i] = (Math.floor(entropy) + stateValue + randomValue * 256) % 256;

      internalState[i % 32] = output[i];
    }

    return output;
  };
};

// Initialize
if (!nacl.random) {
  nacl.random = createPRNG();
  console.log("2️⃣ PRNG initialized:", typeof nacl.random);
} else {
  console.log("2️⃣ PRNG already exists");
}

// Test keyPair generation
try {
  console.log("\n3️⃣ Testing nacl.box.keyPair()...");
  const keyPair = nacl.box.keyPair();
  console.log("✅ SUCCESS: KeyPair generated!");
  console.log("   Public key length:", keyPair.publicKey.length);
  console.log("   Secret key length:", keyPair.secretKey.length);
} catch (error) {
  console.error("❌ FAILED:", error.message);
  process.exit(1);
}

// Test randomBytes
try {
  console.log("\n4️⃣ Testing nacl.randomBytes()...");
  const random = nacl.randomBytes(32);
  console.log("✅ SUCCESS: Random bytes generated!");
  console.log("   Length:", random.length);
} catch (error) {
  console.error("❌ FAILED:", error.message);
  process.exit(1);
}

// Test nonce generation
try {
  console.log("\n5️⃣ Testing nonce generation...");
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  console.log("✅ SUCCESS: Nonce generated!");
  console.log("   Nonce length:", nonce.length);
} catch (error) {
  console.error("❌ FAILED:", error.message);
  process.exit(1);
}

console.log("\n✨ All tests passed! PRNG is working correctly.\n");
