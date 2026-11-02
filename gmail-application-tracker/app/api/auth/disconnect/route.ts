import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, unauthorized } from "@/lib/auth";
import { clearSession } from "@/lib/session";
import { deleteResume } from "@/lib/blob-store";
import { revokeGoogleAccess } from "@/lib/gmail";
export async function POST() { const userId=await requireUser(); if (!userId) return unauthorized(); const campaigns=await db.campaign.findMany({where:{userId},select:{resumeKey:true}}); await Promise.all(campaigns.flatMap(c=>c.resumeKey?[deleteResume(c.resumeKey)]:[])); await revokeGoogleAccess(userId); await db.user.delete({where:{id:userId}}); await clearSession(); return NextResponse.json({ok:true}); }
