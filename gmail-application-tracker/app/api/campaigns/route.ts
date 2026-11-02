import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, unauthorized } from "@/lib/auth";
import { campaignInput } from "@/lib/validation";
export async function GET() { const userId=await requireUser(); if (!userId) return unauthorized(); return NextResponse.json(await db.campaign.findMany({where:{userId},include:{recipients:true},orderBy:{createdAt:"desc"}})); }
export async function POST(request:Request) { const userId=await requireUser(); if (!userId) return unauthorized(); const parsed=campaignInput.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({error:parsed.error.flatten()},{status:400}); const c=await db.campaign.create({data:{userId,name:parsed.data.name,profileJson:parsed.data.profile,subjectTemplate:parsed.data.subjectTemplate,bodyTemplate:parsed.data.bodyTemplate,aiOptIn:parsed.data.aiOptIn}}); return NextResponse.json(c,{status:201}); }
