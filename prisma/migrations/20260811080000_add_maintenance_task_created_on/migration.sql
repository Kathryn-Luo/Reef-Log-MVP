-- AlterTable
ALTER TABLE "MaintenanceTask" ADD COLUMN "createdOn" DATE;

-- 既有任務只有 UTC createdAt，沒有建立當下的使用者時區，因此無法精準還原當地日曆日。
-- 以各列自己的 UTC 日期做可證明的保守回填；不可使用 CURRENT_DATE、startOn 或假設固定時區。
UPDATE "MaintenanceTask"
SET "createdOn" = "createdAt"::date
WHERE "createdOn" IS NULL;
