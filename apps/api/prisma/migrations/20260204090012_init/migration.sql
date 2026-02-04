-- CreateEnum
CREATE TYPE "Language" AS ENUM ('KO', 'JA', 'EN');

-- CreateEnum
CREATE TYPE "Market" AS ENUM ('US', 'JP', 'KR');

-- CreateEnum
CREATE TYPE "CardVariant" AS ENUM ('NORMAL', 'HOLOFOIL', 'REVERSE_HOLOFOIL', 'FULL_ART', 'ALT_ART', 'SECRET', 'PROMO', 'OTHER');

-- CreateEnum
CREATE TYPE "ExternalProvider" AS ENUM ('POKEMONTCG', 'TCGPLAYER', 'RAKUTEN', 'NAVER');

-- CreateEnum
CREATE TYPE "PriceType" AS ENUM ('LISTING', 'AGGREGATED', 'SOLD');

-- CreateTable
CREATE TABLE "CardIdentity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "language" "Language" NOT NULL,
    "setCode" TEXT NOT NULL,
    "setName" TEXT,
    "collectorNumber" TEXT NOT NULL,
    "collectorTotal" INTEGER,
    "variant" "CardVariant" NOT NULL,
    "rarity" TEXT,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalProductMap" (
    "id" TEXT NOT NULL,
    "cardIdentityId" TEXT NOT NULL,
    "provider" "ExternalProvider" NOT NULL,
    "market" "Market" NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalUrl" TEXT,
    "matchMethod" TEXT,
    "matchConfidence" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalProductMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceSnapshot" (
    "id" TEXT NOT NULL,
    "externalProductMapId" TEXT NOT NULL,
    "market" "Market" NOT NULL,
    "currency" TEXT NOT NULL,
    "source" "ExternalProvider" NOT NULL,
    "priceType" "PriceType" NOT NULL,
    "low" DOUBLE PRECISION,
    "high" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,

    CONSTRAINT "PriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardIdentity_nameNormalized_idx" ON "CardIdentity"("nameNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "CardIdentity_language_setCode_collectorNumber_variant_key" ON "CardIdentity"("language", "setCode", "collectorNumber", "variant");

-- CreateIndex
CREATE INDEX "ExternalProductMap_cardIdentityId_provider_market_idx" ON "ExternalProductMap"("cardIdentityId", "provider", "market");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalProductMap_provider_externalId_key" ON "ExternalProductMap"("provider", "externalId");

-- CreateIndex
CREATE INDEX "PriceSnapshot_externalProductMapId_capturedAt_idx" ON "PriceSnapshot"("externalProductMapId", "capturedAt" DESC);

-- AddForeignKey
ALTER TABLE "ExternalProductMap" ADD CONSTRAINT "ExternalProductMap_cardIdentityId_fkey" FOREIGN KEY ("cardIdentityId") REFERENCES "CardIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_externalProductMapId_fkey" FOREIGN KEY ("externalProductMapId") REFERENCES "ExternalProductMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;
