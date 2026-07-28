-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "WaterParameter" AS ENUM ('KH', 'CA', 'MG', 'NO3', 'PO4', 'SALINITY');

-- CreateEnum
CREATE TYPE "CreatureCategory" AS ENUM ('FISH', 'CORAL', 'OTHER');

-- CreateEnum
CREATE TYPE "CreatureStatus" AS ENUM ('ALIVE', 'SICK', 'DEAD');

-- CreateEnum
CREATE TYPE "DeathCause" AS ENUM ('DISEASE', 'WATER_QUALITY', 'PREDATION', 'JUMPED', 'STARVATION', 'UNKNOWN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tank" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sizeSpec" TEXT,
    "volumeLiters" INTEGER,
    "setupType" TEXT,
    "colorHex" TEXT,
    "startedOn" DATE,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaterLog" (
    "id" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaterLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaterReading" (
    "id" TEXT NOT NULL,
    "waterLogId" TEXT NOT NULL,
    "parameter" "WaterParameter" NOT NULL,
    "value" DECIMAL(10,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaterReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaterParameterTarget" (
    "id" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "parameter" "WaterParameter" NOT NULL,
    "minValue" DECIMAL(10,4) NOT NULL,
    "maxValue" DECIMAL(10,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaterParameterTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Creature" (
    "id" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scientificName" TEXT,
    "category" "CreatureCategory" NOT NULL,
    "subCategory" TEXT,
    "photoUrl" TEXT,
    "addedOn" DATE NOT NULL,
    "price" DECIMAL(10,2),
    "status" "CreatureStatus" NOT NULL DEFAULT 'ALIVE',
    "observedSickOn" DATE,
    "ailment" TEXT,
    "diedOn" DATE,
    "causeOfDeath" "DeathCause",
    "deathNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Creature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceTask" (
    "id" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intervalDays" INTEGER NOT NULL,
    "startOn" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceCompletion" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedOn" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Tank_userId_displayOrder_idx" ON "Tank"("userId", "displayOrder");

-- CreateIndex
CREATE INDEX "WaterLog_tankId_measuredAt_idx" ON "WaterLog"("tankId", "measuredAt");

-- CreateIndex
CREATE UNIQUE INDEX "WaterReading_waterLogId_parameter_key" ON "WaterReading"("waterLogId", "parameter");

-- CreateIndex
CREATE UNIQUE INDEX "WaterParameterTarget_tankId_parameter_key" ON "WaterParameterTarget"("tankId", "parameter");

-- CreateIndex
CREATE INDEX "Creature_tankId_status_idx" ON "Creature"("tankId", "status");

-- CreateIndex
CREATE INDEX "Creature_tankId_category_idx" ON "Creature"("tankId", "category");

-- CreateIndex
CREATE INDEX "MaintenanceTask_tankId_isActive_displayOrder_idx" ON "MaintenanceTask"("tankId", "isActive", "displayOrder");

-- CreateIndex
CREATE INDEX "MaintenanceCompletion_taskId_completedAt_idx" ON "MaintenanceCompletion"("taskId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceCompletion_taskId_completedOn_key" ON "MaintenanceCompletion"("taskId", "completedOn");

-- AddForeignKey
ALTER TABLE "Tank" ADD CONSTRAINT "Tank_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaterLog" ADD CONSTRAINT "WaterLog_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "Tank"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaterReading" ADD CONSTRAINT "WaterReading_waterLogId_fkey" FOREIGN KEY ("waterLogId") REFERENCES "WaterLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaterParameterTarget" ADD CONSTRAINT "WaterParameterTarget_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "Tank"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creature" ADD CONSTRAINT "Creature_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "Tank"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceTask" ADD CONSTRAINT "MaintenanceTask_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "Tank"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceCompletion" ADD CONSTRAINT "MaintenanceCompletion_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "MaintenanceTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

