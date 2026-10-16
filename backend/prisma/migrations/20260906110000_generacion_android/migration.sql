-- Optional paired Android + Spring artifact. Existing generations remain Spring-only.
ALTER TABLE "generations" ADD COLUMN "mobileSha256" TEXT;
