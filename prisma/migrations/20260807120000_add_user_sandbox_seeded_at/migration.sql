-- AlterTable
ALTER TABLE "User" ADD COLUMN "sandboxSeededAt" TIMESTAMP(3);

-- 既有使用者一律視為「沙盒已備妥」：他們的沙盒在訪客登入當下就複製完了（issue #66），
-- Google 使用者則本來就沒有沙盒要複製。
--
-- 這一句不能省。留 null 的話，他們下次進站會被判定為「還欠一份沙盒」，
-- POST /api/guest-sandbox 於是再複製一份，缸與生物直接變兩倍。
UPDATE "User" SET "sandboxSeededAt" = "createdAt" WHERE "sandboxSeededAt" IS NULL;
