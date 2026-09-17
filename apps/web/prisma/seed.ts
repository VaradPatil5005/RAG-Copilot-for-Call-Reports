import { PrismaClient } from "@prisma/client";
import * as argon2 from "@node-rs/argon2";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding Tathyx AI RBAC users and institutional organizations...");

  // 1. Create Default Organizations
  const apexOrg = await prisma.organization.upsert({
    where: { id: "org-apex-capital" },
    update: {},
    create: {
      id: "org-apex-capital",
      name: "Apex Credit Capital",
      plan: "enterprise",
    },
  });

  const tathyxHQ = await prisma.organization.upsert({
    where: { id: "org-tathyx-global" },
    update: {},
    create: {
      id: "org-tathyx-global",
      name: "Tathyx Global Operations",
      plan: "institutional_core",
    },
  });

  // Password hash for all sample accounts (all adhere to 12+ char institutional criteria)
  const customerPasswordHash = await argon2.hash("TathyxCustomer2026!");
  const analystPasswordHash = await argon2.hash("TathyxAnalyst2026!");
  const adminPasswordHash = await argon2.hash("TathyxAdmin2026!");
  const superAdminPasswordHash = await argon2.hash("TathyxSuperAdmin2026!");

  // 2. Seed Users across all 4 roles
  const users = [
    {
      id: "user-customer-01",
      email: "customer@tathyx.ai",
      name: "Client Portfolio Manager",
      passwordHash: customerPasswordHash,
      phone: "+919800000001",
      phoneVerified: true,
      role: "customer",
      status: "active",
      orgId: apexOrg.id,
    },
    {
      id: "user-analyst-01",
      email: "analyst@tathyx.ai",
      name: "Senior Credit Analyst",
      passwordHash: analystPasswordHash,
      phone: "+919800000002",
      phoneVerified: true,
      role: "analyst",
      status: "active",
      orgId: apexOrg.id,
    },
    {
      id: "user-admin-01",
      email: "admin@tathyx.ai",
      name: "Apex Org Risk Admin",
      passwordHash: adminPasswordHash,
      phone: "+919800000003",
      phoneVerified: true,
      role: "admin",
      status: "active",
      orgId: apexOrg.id,
    },
    {
      id: "user-superadmin-01",
      email: "superadmin@tathyx.ai",
      name: "Tathyx Platform Lead",
      passwordHash: superAdminPasswordHash,
      phone: "+919800000004",
      phoneVerified: true,
      role: "super_admin",
      status: "active",
      orgId: tathyxHQ.id,
    },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        role: u.role,
        status: u.status,
        phoneVerified: u.phoneVerified,
      },
      create: u,
    });
    console.log(`✅ Seeded ${u.role}: ${u.email}`);
  }

  console.log("\n============================================================");
  console.log("🎉 TATHYX AI RBAC TEST CREDENTIALS READY");
  console.log("------------------------------------------------------------");
  console.log("1. Customer:   customer@tathyx.ai   | TathyxCustomer2026!");
  console.log("2. Analyst:    analyst@tathyx.ai    | TathyxAnalyst2026!");
  console.log("3. Admin:      admin@tathyx.ai      | TathyxAdmin2026!");
  console.log("4. SuperAdmin: superadmin@tathyx.ai | TathyxSuperAdmin2026!");
  console.log("============================================================\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
