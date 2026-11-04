const { PrismaClient } = require('@prisma/client');

const globalForPrisma = globalThis;
const prisma = globalForPrisma.__grabngoPrisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']
});
if (process.env.NODE_ENV !== 'production') globalForPrisma.__grabngoPrisma = prisma;

module.exports = prisma;
