/**
 * Create or promote an admin account.
 *   npm run create-admin -- admin@example.com "StrongPassword123" "Admin Name"
 */
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";

const [email, password, name = "Administrator"] = process.argv.slice(2);
if (!email || !password || password.length < 8) {
  console.error('Usage: npm run create-admin -- <email> <password (8+ chars)> ["Name"]');
  process.exit(1);
}

const passwordHash = await bcrypt.hash(password, 12);
const user = await prisma.user.upsert({
  where: { email: email.toLowerCase() },
  create: { email: email.toLowerCase(), name, passwordHash, role: "ADMIN" },
  update: { role: "ADMIN", passwordHash },
});
console.log(`Admin ready: ${user.email}`);
await prisma.$disconnect();
