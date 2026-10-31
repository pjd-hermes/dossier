-- AlterTable
ALTER TABLE "AgentCandidate" ADD COLUMN "searchId" TEXT,
ADD COLUMN "searchName" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "AgentCandidate_searchId_idx" ON "AgentCandidate"("searchId");
