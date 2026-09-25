-- AlterTable
ALTER TABLE "users" ADD COLUMN "conditions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
