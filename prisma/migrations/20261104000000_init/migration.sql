CREATE TYPE "UserRole" AS ENUM ('STUDENT', 'VENDOR', 'ADMIN');

CREATE TABLE "User" (
  "id" TEXT NOT NULL, "role" "UserRole" NOT NULL, "email" TEXT NOT NULL,
  "name" TEXT NOT NULL, "studentRoll" TEXT, "outletId" TEXT,
  "passwordSalt" TEXT, "passwordHash" TEXT, "disabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_studentRoll_key" ON "User"("studentRoll");
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE INDEX "User_outletId_idx" ON "User"("outletId");

CREATE TABLE "Outlet" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "subtitle" TEXT NOT NULL DEFAULT '',
  "campus" TEXT NOT NULL DEFAULT 'IIT Patna', "location" TEXT NOT NULL, "tokenPrefix" TEXT NOT NULL,
  "contacts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reviewCount" INTEGER NOT NULL DEFAULT 0, "basePrepTime" INTEGER NOT NULL DEFAULT 12,
  "isAcceptingOrders" BOOLEAN NOT NULL DEFAULT false, "freeDelivery" BOOLEAN NOT NULL DEFAULT false,
  "icon" TEXT NOT NULL DEFAULT '🍽️', "accentColor" TEXT NOT NULL DEFAULT '#10b981',
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "tokenCounter" INTEGER NOT NULL DEFAULT 100,
  "surgeMinutes" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Outlet_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Outlet_isAcceptingOrders_idx" ON "Outlet"("isAcceptingOrders");

CREATE TABLE "MenuCategory" (
  "id" TEXT NOT NULL, "outletId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MenuCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MenuCategory_outletId_name_key" ON "MenuCategory"("outletId", "name");
CREATE INDEX "MenuCategory_outletId_sortOrder_idx" ON "MenuCategory"("outletId", "sortOrder");

CREATE TABLE "MenuItem" (
  "id" TEXT NOT NULL, "outletId" TEXT NOT NULL, "categoryId" TEXT NOT NULL,
  "name" TEXT NOT NULL, "description" TEXT, "price" INTEGER,
  "isVeg" BOOLEAN NOT NULL DEFAULT true, "isAvailable" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MenuItem_outletId_name_key" ON "MenuItem"("outletId", "name");
CREATE INDEX "MenuItem_outletId_isAvailable_idx" ON "MenuItem"("outletId", "isAvailable");
CREATE INDEX "MenuItem_categoryId_idx" ON "MenuItem"("categoryId");

CREATE TABLE "MenuItemVariant" (
  "id" TEXT NOT NULL, "menuItemId" TEXT NOT NULL, "label" TEXT NOT NULL, "price" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MenuItemVariant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MenuItemVariant_menuItemId_label_key" ON "MenuItemVariant"("menuItemId", "label");

CREATE TABLE "Order" (
  "id" TEXT NOT NULL, "token" TEXT NOT NULL, "pickupPinHash" TEXT,
  "pickupPinCiphertext" TEXT, "pickupPinIv" TEXT, "pickupPinAuthTag" TEXT,
  "outletId" TEXT NOT NULL, "studentName" TEXT NOT NULL, "studentRoll" TEXT NOT NULL,
  "studentPhone" TEXT NOT NULL DEFAULT '', "status" TEXT NOT NULL,
  "subtotal" INTEGER NOT NULL, "convenienceFee" INTEGER NOT NULL DEFAULT 0,
  "discount" INTEGER NOT NULL DEFAULT 0, "total" INTEGER NOT NULL,
  "hasPassApplied" BOOLEAN NOT NULL DEFAULT false, "paymentMethod" TEXT NOT NULL DEFAULT 'CASH_ON_PICKUP',
  "paymentStatus" TEXT NOT NULL DEFAULT 'DUE_ON_PICKUP', "academicBreakSlot" TEXT NOT NULL DEFAULT 'instant',
  "scheduledPickupTime" TIMESTAMP(3), "estimatedReadyAt" TIMESTAMP(3) NOT NULL,
  "estimatedMinutes" INTEGER NOT NULL, "placedAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL, "readyAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3),
  "notes" TEXT NOT NULL DEFAULT '', "queueSnapshot" JSONB, "itemsSnapshot" JSONB NOT NULL,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Order_token_key" ON "Order"("token");
CREATE INDEX "Order_outletId_status_placedAt_idx" ON "Order"("outletId", "status", "placedAt");
CREATE INDEX "Order_studentRoll_placedAt_idx" ON "Order"("studentRoll", "placedAt");
CREATE INDEX "Order_status_placedAt_idx" ON "Order"("status", "placedAt");

CREATE TABLE "OrderItem" (
  "id" TEXT NOT NULL, "orderId" TEXT NOT NULL, "menuItemId" TEXT,
  "name" TEXT NOT NULL, "variant" TEXT, "quantity" INTEGER NOT NULL,
  "unitPrice" INTEGER NOT NULL, "categoryId" TEXT,
  CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

CREATE TABLE "OrderStatusHistory" (
  "id" TEXT NOT NULL, "orderId" TEXT NOT NULL, "fromStatus" TEXT,
  "toStatus" TEXT NOT NULL, "actorRole" TEXT NOT NULL DEFAULT 'SYSTEM',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrderStatusHistory_orderId_createdAt_idx" ON "OrderStatusHistory"("orderId", "createdAt");

CREATE TABLE "Feedback" (
  "id" TEXT NOT NULL, "studentRoll" TEXT NOT NULL, "category" TEXT NOT NULL,
  "message" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Feedback_studentRoll_createdAt_idx" ON "Feedback"("studentRoll", "createdAt");

CREATE TABLE "Subscription" (
  "studentRoll" TEXT NOT NULL, "plan" TEXT NOT NULL, "activeUntil" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("studentRoll")
);

CREATE TABLE "OtpChallenge" (
  "email" TEXT NOT NULL, "name" TEXT NOT NULL, "studentRoll" TEXT NOT NULL,
  "otpHash" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0, "lastSentAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("email")
);
CREATE INDEX "OtpChallenge_expiresAt_idx" ON "OtpChallenge"("expiresAt");

CREATE TABLE "AuthRateLimit" (
  "key" TEXT NOT NULL, "count" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3), "lastEventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthRateLimit_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "AuthRateLimit_lockedUntil_idx" ON "AuthRateLimit"("lockedUntil");

ALTER TABLE "User" ADD CONSTRAINT "User_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MenuCategory" ADD CONSTRAINT "MenuCategory_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MenuCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MenuItemVariant" ADD CONSTRAINT "MenuItemVariant_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
