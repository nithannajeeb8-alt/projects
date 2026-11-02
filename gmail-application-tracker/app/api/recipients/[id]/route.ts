import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, unauthorized } from "@/lib/auth";
import { z } from "zod";
const update=z.object({subject:z.string().trim().min(1).max(180).optional(),body:z.string().trim().min(1).max(12000).optional(),status:z.enum(["DRAFT","APPROVED","OPT_OUT"]).optional()});
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}) { const userId=await requireUser(); if (!userId) return unauthorized(); const recipient=await db.recipient.findFirst({where:{id:(await params).id,campaign:{userId}}}); if (!recipient) return NextResponse.json({error:"Not found"},{status:404}); const parsed=update.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({error:parsed.error.flatten()},{status:400}); if (recipient.status === "SENT" || recipient.status === "OPT_OUT") return NextResponse.json({error:"Sent and opt-out entries cannot be edited or re-approved"},{status:409}); const item=await db.recipient.update({where:{id:recipient.id},data:{...parsed.data,approvedAt:parsed.data.status === "APPROVED" ? new Date() : undefined}}); return NextResponse.json(item); }
