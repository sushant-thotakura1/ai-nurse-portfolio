-- AlterTable
ALTER TABLE "patients" ALTER COLUMN "preferred_locale" DROP DEFAULT,
ALTER COLUMN "preferred_locale" SET DATA TYPE TEXT,
ALTER COLUMN "preferred_locale" DROP NOT NULL;
