-- CreateEnum
CREATE TYPE "TeacherChangeRequestStatus" AS ENUM ('OPEN', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "TeacherChangeRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "studentId" TEXT NOT NULL,
    "fromTeacherId" TEXT,
    "toTeacherId" TEXT NOT NULL,
    "status" "TeacherChangeRequestStatus" NOT NULL DEFAULT 'OPEN',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByTeacherId" TEXT,
    "message" TEXT,

    CONSTRAINT "TeacherChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeacherChangeRequest_studentId_idx" ON "TeacherChangeRequest"("studentId");

-- CreateIndex
CREATE INDEX "TeacherChangeRequest_toTeacherId_idx" ON "TeacherChangeRequest"("toTeacherId");

-- CreateIndex
CREATE INDEX "TeacherChangeRequest_status_idx" ON "TeacherChangeRequest"("status");

-- CreateIndex
CREATE INDEX "TeacherChangeRequest_studentId_status_idx" ON "TeacherChangeRequest"("studentId", "status");

-- AddForeignKey
ALTER TABLE "TeacherChangeRequest" ADD CONSTRAINT "TeacherChangeRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherChangeRequest" ADD CONSTRAINT "TeacherChangeRequest_fromTeacherId_fkey" FOREIGN KEY ("fromTeacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherChangeRequest" ADD CONSTRAINT "TeacherChangeRequest_toTeacherId_fkey" FOREIGN KEY ("toTeacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherChangeRequest" ADD CONSTRAINT "TeacherChangeRequest_resolvedByTeacherId_fkey" FOREIGN KEY ("resolvedByTeacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
